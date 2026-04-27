import time
import random
import logging
import re
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor
from core.llm_providers import llm_call
from utils.utils import YELLOW, BRIGHT_RED, RESET
from config.settings import settings
from config.pipeline_config import get_node_config
from utils.prompt_registry import get_prompt_registry

logger = logging.getLogger(__name__)

_WS_CONFIG = get_node_config("web_search")
_EP_CONFIG = get_node_config("entity_profiling")

SCRAPE_TIMEOUT_SECONDS = _WS_CONFIG["scrape_timeout"]
SCRAPE_MAX_RESPONSE_BYTES = _WS_CONFIG["http_content_limit"]
SCRAPE_MIN_TEXT_LENGTH = _WS_CONFIG["min_page_text_length"]
SCRAPE_MAX_TEXT_LENGTH = _WS_CONFIG["max_page_text_length"]
SCRAPE_MAX_WORKERS = _WS_CONFIG["scrape_workers"]
SCRAPE_TITLE_MAX_LENGTH = _WS_CONFIG["title_truncate_length"]
SKIP_EXTENSIONS = _WS_CONFIG["skip_extensions"]
SKIP_DOMAINS = _WS_CONFIG["skip_domains"]
SEARCH_LANGUAGE = _WS_CONFIG["search_language"]
SEARCH_COUNTRY = _WS_CONFIG["search_country"]
ACCEPT_LANGUAGE = _WS_CONFIG["accept_language"]
HTML_STRIP_TAGS = _WS_CONFIG["html_strip_tags"]
MIN_KEYWORD_LENGTH = _WS_CONFIG["min_keyword_length"]
KEYWORD_SPLIT_CHARS = _WS_CONFIG["keyword_split_chars"]
SCRAPE_MAX_RETRIES = _WS_CONFIG.get("scrape_max_retries", 1)
SCRAPE_RETRY_DELAY = _WS_CONFIG.get("scrape_retry_delay", 1.0)
SCRAPE_RETRY_STATUS_CODES = set(_WS_CONFIG.get("scrape_retry_status_codes", [429, 500, 502, 503, 504]))
SCRAPE_JITTER = _WS_CONFIG.get("scrape_jitter", 0.5)
SCRAPE_EXTRA_HEADERS = _WS_CONFIG.get("scrape_headers", {})

_USER_AGENTS = _WS_CONFIG.get("user_agents", [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
])


def _split_keywords(query):
    """Split query into keywords using configured split characters."""
    text = query
    for ch in KEYWORD_SPLIT_CHARS:
        text = text.replace(ch, ' ')
    return text.split()


def _generate_format_string_from_schema(schema):
    """Generate the JSON format string for LLM prompt from a JSON schema"""
    if 'properties' not in schema:
        raise ValueError("Schema must contain 'properties' field")

    format_items = []
    for prop_name, prop_def in schema['properties'].items():
        prop_type = prop_def.get('type', 'string')

        if prop_type == 'string':
            format_items.append(f'  "{prop_name}": "string"')
        elif prop_type == 'array':
            items_type = prop_def.get('items', {}).get('type', 'string')
            format_items.append(f'  "{prop_name}": ["array of strings"]')
        elif prop_type == 'object':
            format_items.append(f'  "{prop_name}": {{"object"}}')
        elif prop_type == 'number' or prop_type == 'integer':
            format_items.append(f'  "{prop_name}": {prop_type}')
        elif prop_type == 'boolean':
            format_items.append(f'  "{prop_name}": true/false')
        else:
            format_items.append(f'  "{prop_name}": "{prop_type}"')

    return "{\n" + ",\n".join(format_items) + "\n}"

def scrape_url(url, char_limit):
    """Scrape a URL with typed rejection reasons and configurable retry."""
    url_lower = url.lower()
    if any(ext in url_lower for ext in SKIP_EXTENSIONS):
        return {"_filtered": "skip_extension", "url": url}
    if any(domain in url_lower for domain in SKIP_DOMAINS):
        return {"_filtered": "skip_domain", "url": url}

    try:
        if SCRAPE_JITTER > 0:
            time.sleep(random.uniform(0, SCRAPE_JITTER))

        headers = {
            'User-Agent': random.choice(_USER_AGENTS),
            'Accept-Language': ACCEPT_LANGUAGE,
            **SCRAPE_EXTRA_HEADERS,
        }

        response = None
        for attempt in range(1 + SCRAPE_MAX_RETRIES):
            response = requests.get(url, timeout=SCRAPE_TIMEOUT_SECONDS, headers=headers)
            if response.status_code in SCRAPE_RETRY_STATUS_CODES and attempt < SCRAPE_MAX_RETRIES:
                time.sleep(SCRAPE_RETRY_DELAY)
                continue
            break

        if response.status_code != 200:
            return {"_filtered": f"http_{response.status_code}", "url": url}

        soup = BeautifulSoup(response.content[:SCRAPE_MAX_RESPONSE_BYTES], 'html.parser')
        for tag in soup(HTML_STRIP_TAGS):
            tag.decompose()

        text = re.sub(r'\s+', ' ', soup.get_text().strip())
        if len(text) < SCRAPE_MIN_TEXT_LENGTH:
            return {"_filtered": "too_short", "url": url}
        if len(text) > SCRAPE_MAX_TEXT_LENGTH:
            text = text[:SCRAPE_MAX_TEXT_LENGTH]

        title = soup.find('title')
        title = title.get_text().strip()[:SCRAPE_TITLE_MAX_LENGTH] if title else url.split('/')[-1]

        return {'title': title, 'content': text[:char_limit], 'url': url}

    except Exception as e:
        logger.debug("Scrape failed for %s: %s", url, e)
        return {"_scrape_error": str(e), "url": url}

def _brave_search(query, num_results, log=None, query_prefix="", query_suffix=""):
    """
    Brave Search API - Primary search method (requires API key)
    Free tier: 2,000 queries/month, 1 query/second
    Get key at: https://api-dashboard.search.brave.com/register
    Set in .env: BRAVE_SEARCH_API_KEY=your_key
    Toggle with: USE_BRAVE_API=true/false (default: true)
    """
    if not settings.use_brave_api:
        msg = "Brave Search disabled (USE_BRAVE_API=false)"
        logger.warning(msg)
        if log:
            log.append(msg)
        return []

    api_key = settings.brave_search_api_key
    if not api_key:
        msg = "Brave Search API key not configured (set BRAVE_SEARCH_API_KEY in .env)"
        logger.warning(msg)
        if log:
            log.append(msg)
        return []

    effective_query = f"{query_prefix} {query} {query_suffix}".strip()

    try:
        msg = f"Trying Brave Search API for: '{effective_query}'"
        logger.info(f"[WEB_SCRAPE] {msg}")
        if log:
            log.append(msg)

        headers = {
            'X-Subscription-Token': api_key,
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip'
        }

        brave_params = {
            'q': effective_query,
            'count': num_results,
            'search_lang': SEARCH_LANGUAGE,
            'country': SEARCH_COUNTRY,
            'spellcheck': _WS_CONFIG["spellcheck"],
        }
        if _WS_CONFIG["result_filter"]:
            brave_params['result_filter'] = _WS_CONFIG["result_filter"]
        if _WS_CONFIG["extra_snippets"]:
            brave_params['extra_snippets'] = True
        if _WS_CONFIG["freshness"]:
            brave_params['freshness'] = _WS_CONFIG["freshness"]

        response = requests.get(
            'https://api.search.brave.com/res/v1/web/search',
            params=brave_params,
            headers=headers,
            timeout=_WS_CONFIG["brave_api_timeout"]
        )

        if response.status_code == 200:
            data = response.json()
            results = data.get('web', {}).get('results', [])
            urls = [r['url'] for r in results if 'url' in r and r['url'].startswith('http')]

            msg = f"Brave Search found {len(urls)} URLs"
            logger.info(f"[WEB_SCRAPE] {msg}")
            if log:
                log.append(msg)

            return urls
        elif response.status_code == 429:
            msg = f"Brave Search rate limit exceeded (free tier: 2000/month, 1/sec)"
            logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] {msg}{RESET}")
            if log:
                log.append(msg)
        else:
            msg = f"Brave Search failed with status {response.status_code}"
            logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] {msg}{RESET}")
            if log:
                log.append(msg)

    except Exception as e:
        msg = f"Brave Search failed: {str(e)}"
        logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] {msg}{RESET}")
        if log:
            log.append(msg)

    return []


def _build_research_prompt(query, scraped_content, schema, raw_content_limit):
    """Build LLM prompt for entity profile extraction"""
    # Build combined text from scraped content or fallback
    if not scraped_content:
        keywords = [w.strip() for w in _split_keywords(query) if len(w.strip()) >= MIN_KEYWORD_LENGTH]
        fallback_context = f"Query contains terms: {', '.join(keywords[:_WS_CONFIG['fallback_keywords_limit']])}"
        combined_text = f"Research about: {query}\n\n{fallback_context}"
    else:
        combined_text = f"Research about: {query}\n\n" + "\n\n".join(
            [f"{i}. {item['title']}\n{item['content'][:_EP_CONFIG['per_site_content_limit']]}" for i, item in enumerate(scraped_content, 1)]
        )[:raw_content_limit]

    format_string = _generate_format_string_from_schema(schema)

    # Get prompt from registry (versioned)
    registry = get_prompt_registry()
    return registry.render_prompt(
        family=_EP_CONFIG["prompt_family"],
        version=_EP_CONFIG["prompt_version"],
        query=query,
        format_string=format_string,
        combined_text=combined_text
    )


def _build_debug_info(scraped_content, search_method, search_log, scrape_errors, query, max_sites, content_char_limit, raw_content_limit, query_prefix="", query_suffix="", skip_search=False, fetched_count=0, filter_reasons=None, num_results=0):
    """Build debug information dictionary"""
    method_params = {
        "query": query,
        "max_sites": max_sites,
        "content_char_limit": content_char_limit,
        "raw_content_limit": raw_content_limit,
        "query_prefix": query_prefix,
        "query_suffix": query_suffix,
    }

    warnings: list[dict] = []
    info: list[dict] = []

    def _web_stats(usable: int, fetched: int) -> dict:
        return {"min": max_sites, "usable": usable, "fetched": fetched, "requested": num_results}

    def _web_msg(stats: dict, detail: str = "") -> str:
        msg = f"{stats['min']} min, {stats['usable']} usable, {stats['fetched']} fetched, {stats['requested']} requested"
        return f"{msg} — {detail}" if detail else msg

    def _loss_detail(scrape_errors, _fr, _n_filtered) -> str:
        parts = []
        if _n_filtered:
            parts.append(f"{_n_filtered} filtered: {', '.join(f'{n}\u00d7{r}' for r, n in _fr.items())}")
        if scrape_errors:
            parts.append(f"{len(scrape_errors)} error{'s' if len(scrape_errors) != 1 else ''}")
        return "; ".join(parts)

    if scraped_content:
        sources_info = {
            "sources_fetched": [
                {'title': item['title'], 'url': item['url']} for item in scraped_content
            ],
            "search_method": search_method,
            "method_parameters": method_params,
        }
        _fr = filter_reasons or {}
        _n_filtered = sum(_fr.values())
        total = fetched_count or (len(scraped_content) + len(scrape_errors) + _n_filtered)
        stats = _web_stats(len(scraped_content), total)
        detail = _loss_detail(scrape_errors, _fr, _n_filtered)

        info.append({"step": "web_search", "code": "fetch_stats",
                     "message": _web_msg(stats, detail), "stats": stats})

        # Only warn when below threshold AND actual losses occurred
        if len(scraped_content) < max_sites and (scrape_errors or _fr):
            warnings.append({
                "step": "web_search", "code": "low_document_count",
                "message": _web_msg(stats, detail), "stats": stats,
                "details": scrape_errors, "filter_reasons": _fr,
            })
    elif skip_search:
        sources_info = {
            "status": "skipped",
            "note": "Web search disabled",
            "method_parameters": method_params,
        }
    else:
        sources_info = {
            "error": "web_scraping_failed",
            "search_attempts": search_log,
            "scrape_failures": len(scrape_errors),
            "fallback": "LLM knowledge only",
            "method_parameters": method_params,
        }
        _fr = filter_reasons or {}
        _n_filtered = sum(_fr.values())
        if scrape_errors or _n_filtered:
            total = fetched_count or (len(scrape_errors) + _n_filtered)
            stats = _web_stats(0, total)
            detail = _loss_detail(scrape_errors, _fr, _n_filtered)
            warnings.append({
                "step": "web_search", "code": "scrape_failed",
                "message": _web_msg(stats, detail), "stats": stats,
                "details": scrape_errors, "filter_reasons": _fr,
            })
        elif search_log:
            last_log = search_log[-1] if search_log else "unknown"
            warnings.append({
                "step": "web_search", "code": "search_failed",
                "message": f"No URLs found — {last_log}",
            })
        else:
            warnings.append({
                "step": "web_search", "code": "no_results",
                "message": "Web search returned no results",
            })

    return {
        "inputs": {"scraped_sources": sources_info},
        "warnings": warnings,
        "info": info,
    }

async def web_generate_entity_profile(query, ws_cfg, ep_cfg, schema, skip_search=False, warnings=None, scraped_content=None, usage_out=None):
    """Web search + entity profiling.

    Args:
        query: Input query string.
        ws_cfg: Web search node config dict (max_sites, num_results, content_char_limit, ...).
        ep_cfg: Entity profiling node config dict (temperature, max_tokens, model, prompt, ...).
        schema: Entity profile JSON schema.
        skip_search: If True, skip web search (LLM knowledge only).
        warnings: Mutable list to collect LLM retry warnings.
        scraped_content: Precomputed web content (skips scraping when provided).
        usage_out: Optional dict to receive the provider's token usage
            (``{"input": int, "output": int}``). Also mirrored into
            ``debug_info["llm_usage"]`` for callers that only read the debug
            dict.
    """
    if not schema:
        raise ValueError("Schema parameter is required.")

    max_sites = ws_cfg["max_sites"]
    num_results = ws_cfg["num_results"]
    content_char_limit = ws_cfg["content_char_limit"]
    query_prefix = ws_cfg.get("query_prefix", "")
    query_suffix = ws_cfg.get("query_suffix", "")
    raw_content_limit = ep_cfg["raw_content_limit"]

    search_log = []
    scrape_errors = []
    fetched = 0
    filter_reasons = {}
    search_method = "skipped"

    # Web search phase timing
    ws_start = time.time()
    if scraped_content is not None:
        # Precomputed web content — skip scraping entirely
        ws_elapsed = 0.0
        search_method = "precomputed"
        fetched = len(scraped_content)
        logger.info(f"[WEB_SCRAPE] Using {len(scraped_content)} precomputed sources")
        search_log.append(f"Web search precomputed ({len(scraped_content)} sources)")
    elif skip_search:
        scraped_content = []
        ws_elapsed = None
        logger.info("[WEB_SCRAPE] Skipped (LLM knowledge only)")
        search_log.append("Web search skipped (skip_search=True)")
    else:
        scraped_content = []
        # Direct Brave Search API call
        urls = _brave_search(query, num_results=num_results, log=search_log,
                             query_prefix=query_prefix, query_suffix=query_suffix)
        search_method = "Brave Search API"

        # Parallel URL scraping with ThreadPoolExecutor
        if urls:
            logger.info(f"[WEB_SCRAPE] Scraping {len(urls)} URLs in parallel...")

            with ThreadPoolExecutor(max_workers=SCRAPE_MAX_WORKERS) as executor:
                results = list(executor.map(lambda url: scrape_url(url, content_char_limit), urls))

                filtered = 0
                filter_reasons = {}
                for result in results:
                    if result is None:
                        filtered += 1
                    elif "_filtered" in result:
                        filtered += 1
                        reason = result["_filtered"]
                        filter_reasons[reason] = filter_reasons.get(reason, 0) + 1
                    elif "_scrape_error" in result:
                        scrape_errors.append({"url": result["url"], "reason": result["_scrape_error"]})
                    else:
                        scraped_content.append(result)
                        if len(scraped_content) >= max_sites:
                            break

            fetched = len(scraped_content) + len(scrape_errors) + filtered
            n_ok = len(scraped_content)
            n_err = len(scrape_errors)
            if n_ok > 0:
                detail_parts = [f"{fetched} fetched"]
                if n_err:
                    detail_parts.append(f"{n_err} error{'s' if n_err != 1 else ''}")
                detail = f"  ({', '.join(detail_parts)})" if n_err else ""
                titles = " | ".join(s["title"][:40] for s in scraped_content)
                logger.info(f"{YELLOW}[WEB_SCRAPE] ✓ {n_ok}/{max_sites} sources{detail}{RESET}: {titles}")
            else:
                parts = []
                if n_err:
                    parts.append(f"{n_err} error{'s' if n_err != 1 else ''}")
                if filtered:
                    parts.append(f"{filtered} filtered")
                detail = f"  ({fetched} fetched, {', '.join(parts)})" if parts else ""
                logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] ✗ 0/{max_sites} sources{detail}{RESET}")
        else:
            logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] ✗ No URLs found{RESET}")
        ws_elapsed = round(time.time() - ws_start, 3)

    # Build research prompt (custom override or registry-based)
    profiling_prompt = ep_cfg.get("prompt")
    profiling_schema = ep_cfg.get("output_schema")
    profiling_provider = ep_cfg["provider"]
    profiling_model = ep_cfg["model"]
    if profiling_prompt:
        # Custom prompt with {{variable}} substitution
        if not scraped_content:
            keywords = [w.strip() for w in _split_keywords(query) if len(w.strip()) >= MIN_KEYWORD_LENGTH]
            fallback_context = f"Query contains terms: {', '.join(keywords[:_WS_CONFIG['fallback_keywords_limit']])}"
            combined_text = f"Research about: {query}\n\n{fallback_context}"
        else:
            combined_text = f"Research about: {query}\n\n" + "\n\n".join(
                [f"{i}. {item['title']}\n{item['content'][:_EP_CONFIG['per_site_content_limit']]}" for i, item in enumerate(scraped_content, 1)]
            )[:raw_content_limit]
        format_string = _generate_format_string_from_schema(profiling_schema or schema)
        prompt = profiling_prompt.replace("{{query}}", query)
        prompt = prompt.replace("{{format_string}}", format_string)
        prompt = prompt.replace("{{combined_text}}", combined_text)
    else:
        prompt = _build_research_prompt(query, scraped_content, schema, raw_content_limit)

    # Injection check: verify all elements made it into the prompt
    checks = [f"{len(prompt):,} chars"]
    checks.append(f"query: {'✓' if query in prompt else '✗ MISSING'}")
    if profiling_prompt:
        unresolved = re.findall(r"\{\{(\w+)\}\}", prompt)
        checks.append(f"format_string: {'✓' if '{{format_string}}' not in prompt else '✗ MISSING'}")
        checks.append(f"combined_text: {'✓' if '{{combined_text}}' not in prompt else '✗ MISSING'}")
        if unresolved:
            checks.append(f"unresolved vars: {unresolved}")
    else:
        has_data = "RESEARCH DATA:" in prompt or any(item['title'] in prompt for item in scraped_content[:1])
        checks.append(f"research_data: {'✓' if has_data else '✗ MISSING'}")
    logger.debug(f"{YELLOW}[PROMPT] {' | '.join(checks)}{RESET}")

    messages = [{"role": "user", "content": prompt}]
    llm_kwargs = {
        "messages": messages,
        "provider": profiling_provider,
        "model": profiling_model,
        "temperature": ep_cfg["temperature"],
        "max_tokens": ep_cfg.get("max_tokens"),
        "output_format": "schema" if profiling_schema else "json",
    }
    if profiling_schema:
        llm_kwargs["schema"] = profiling_schema

    # LLM call phase timing
    llm_start = time.time()
    _usage: dict = {}
    result = await llm_call(**llm_kwargs, warnings=warnings, usage_out=_usage)
    llm_elapsed = round(time.time() - llm_start, 3)
    if usage_out is not None and _usage:
        usage_out.update(_usage)

    processing_time = (ws_elapsed or 0) + llm_elapsed
    result['_metadata'] = {
        'query': query,
        'sources_count': len(scraped_content),
        'processing_time_seconds': round(processing_time, 2),
        'sources': [{'title': item['title'], 'url': item['url']} for item in scraped_content]
    }

    # Build debug info
    debug_info = _build_debug_info(scraped_content, search_method, search_log, scrape_errors,
                                    query, max_sites, content_char_limit, raw_content_limit,
                                    query_prefix=query_prefix, query_suffix=query_suffix,
                                    skip_search=skip_search, fetched_count=fetched,
                                    filter_reasons=filter_reasons, num_results=num_results)
    debug_info["web_search_elapsed"] = ws_elapsed
    debug_info["llm_elapsed"] = llm_elapsed
    if _usage:
        debug_info["llm_usage"] = dict(_usage)
    # Full scraped content for intermediate caching (Wave 4)
    debug_info["scraped_content"] = scraped_content
    return result, debug_info
