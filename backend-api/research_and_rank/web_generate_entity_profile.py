import asyncio
import io
import time
import random
import logging
import re
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor
from core.llm_providers import llm_call
from utils.utils import GREEN, YELLOW, BRIGHT_RED, RESET
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
# PDF datasheets (matweb/basf/sabic) hold the truest materials data but were
# blanket-skipped. When extract_pdf is on we pull their text too. PDFs need a
# bigger byte budget than HTML (the xref table lives at the end — a too-tight
# cap truncates the file and pypdf can't parse it), still bounded by the same
# wall-clock scrape_timeout so a slow PDF can never extend the step.
PDF_MAX_PAGES = _WS_CONFIG.get("pdf_max_pages", 10)
PDF_MAX_BYTES = _WS_CONFIG.get("pdf_max_bytes", 5_000_000)

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


def _extract_pdf_text(data):
    """Best-effort text extraction from PDF bytes. Returns '' on any failure
    (truncated/encrypted/image-only PDF) — the caller treats that as a filtered
    source and, in hybrid mode, falls back to the Brave snippet."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        parts = [(page.extract_text() or "") for page in reader.pages[:PDF_MAX_PAGES]]
        return re.sub(r'\s+', ' ', " ".join(parts).strip())
    except Exception as e:
        logger.debug("PDF extract failed: %s", e)
        return ""


def scrape_url(url, char_limit, extract_pdf=False):
    """Scrape one URL to {title, content, url}, or a typed rejection dict
    ({"_filtered": reason} / {"_scrape_error": ...}). Never raises. Used only by
    the ``scrape`` / ``hybrid`` strategies — the per-URL bounds here are the byte
    cap and a per-read wall-clock deadline; the *aggregate* batch bound lives in
    ``_from_scrape`` (asyncio.wait_for) so a slow batch can never hang the step."""
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
            response = requests.get(
                url, timeout=SCRAPE_TIMEOUT_SECONDS, headers=headers, stream=True
            )
            if response.status_code in SCRAPE_RETRY_STATUS_CODES and attempt < SCRAPE_MAX_RETRIES:
                response.close()
                time.sleep(SCRAPE_RETRY_DELAY)
                continue
            break

        if response.status_code != 200:
            response.close()
            return {"_filtered": f"http_{response.status_code}", "url": url}

        content_type = response.headers.get("Content-Type", "").lower()
        is_pdf = "pdf" in content_type or url_lower.endswith(".pdf")
        is_html = "html" in content_type or "text" in content_type
        if is_pdf and not extract_pdf:
            # PDF extraction disabled — skip (a warning) rather than download a
            # binary we'd only discard.
            response.close()
            return {"_filtered": "non_html", "url": url}
        if not is_pdf and not is_html:
            response.close()
            return {"_filtered": "non_html", "url": url}

        # ``requests`` ``timeout`` bounds per-read/connect, NOT total download — and
        # ``.content`` downloads the WHOLE body before any slice, so the limit is
        # useless against a slow-streaming or oversized URL. Stream and stop at the
        # byte cap OR a wall-clock deadline, whichever first: every URL is hard-bounded
        # in bytes AND time, and an overrun degrades to a short/empty page (a warning),
        # never a block. PDFs get a larger byte cap (xref-at-end), same time bound.
        max_bytes = PDF_MAX_BYTES if is_pdf else SCRAPE_MAX_RESPONSE_BYTES
        deadline = time.monotonic() + SCRAPE_TIMEOUT_SECONDS
        buf = bytearray()
        try:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    buf.extend(chunk)
                if len(buf) >= max_bytes or time.monotonic() > deadline:
                    break
        finally:
            response.close()

        if is_pdf:
            text = _extract_pdf_text(bytes(buf))
            if not text:
                return {"_filtered": "pdf_unreadable", "url": url}
            title = url.split('/')[-1] or url
        else:
            soup = BeautifulSoup(bytes(buf[:SCRAPE_MAX_RESPONSE_BYTES]), 'html.parser')
            for tag in soup(HTML_STRIP_TAGS):
                tag.decompose()
            text = re.sub(r'\s+', ' ', soup.get_text().strip())
            title = soup.find('title')
            title = title.get_text().strip()[:SCRAPE_TITLE_MAX_LENGTH] if title else url.split('/')[-1]

        if len(text) < SCRAPE_MIN_TEXT_LENGTH:
            return {"_filtered": "too_short", "url": url}
        if len(text) > SCRAPE_MAX_TEXT_LENGTH:
            text = text[:SCRAPE_MAX_TEXT_LENGTH]

        return {'title': title, 'content': text[:char_limit], 'url': url}

    except Exception as e:
        logger.debug("Scrape failed for %s: %s", url, e)
        return {"_scrape_error": str(e), "url": url}


def _brave_search(query, num_results, log=None, query_prefix="", query_suffix=""):
    """Brave Search API — the one metered call per match (free tier: 2,000/month,
    1/sec). Returns a list of result records ``{url, title, snippet}`` — NOT bare
    URLs. ``snippet`` is Brave's own ``description`` (+ ``extra_snippets`` on paid
    plans, absent on free) and is the evidence the ``snippets`` strategy uses
    directly and the ``scrape``/``hybrid`` strategies fall back to. Returns [] on
    any failure (disabled / no key / 429 / non-200 / exception); callers degrade
    soft to LLM-knowledge-only.
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
            # Keep the text Brave already returned (description + extra_snippets)
            # alongside the URL — discarding it was the original mistake that
            # forced fragile full-page scraping to re-obtain text already in hand.
            records = []
            for r in results:
                url = r.get('url', '')
                if not url.startswith('http'):
                    continue
                snippet_parts = [r.get('description', '')]
                snippet_parts.extend(r.get('extra_snippets') or [])
                records.append({
                    'url': url,
                    'title': r.get('title') or url,
                    'snippet': "\n".join(p for p in snippet_parts if p).strip(),
                })

            msg = f"Brave Search found {len(records)} sources"
            logger.info(f"[WEB_SCRAPE] {msg}")
            if log:
                log.append(msg)

            return records
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


def _from_snippets(records, max_sites, content_char_limit):
    """Snippets strategy: evidence is the text Brave already returned. Zero page
    fetches → cannot hang, nothing to filter, and a source like matweb is present
    even though its page can't be scraped. Fewer LLM tokens than full pages."""
    return [
        {"title": r["title"], "url": r["url"], "content": r["snippet"][:content_char_limit]}
        for r in records[:max_sites]
        if r["snippet"]
    ]


async def _from_scrape(records, max_sites, content_char_limit, scrape_budget, extract_pdf, snippet_fallback=False):
    """Scrape strategy: fetch full pages for deep evidence, hard-bounded so it can
    never hang. Returns (content_records, scrape_stats).

    THE hang fix: the whole parallel scrape runs under a single ``asyncio.wait_for``
    aggregate deadline (``scrape_budget``). On overrun we return whatever completed
    and degrade — no batch can ever approach the client timeout. (Per-URL bounds in
    ``scrape_url`` are necessary but were never sufficient: they don't bound the
    20-URL batch or DNS resolution.) Results are walked in Brave's rank order; with
    ``snippet_fallback`` (hybrid) a failed/filtered page falls back to that result's
    snippet, so the evidence set is never empty."""
    urls = [r["url"] for r in records]

    def _scrape_all():
        with ThreadPoolExecutor(max_workers=SCRAPE_MAX_WORKERS) as executor:
            return list(executor.map(lambda u: scrape_url(u, content_char_limit, extract_pdf), urls))

    try:
        results = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _scrape_all),
            timeout=scrape_budget,
        )
    except asyncio.TimeoutError:
        # Batch overran the budget. Threads finish in the background and are
        # discarded; the request returns now. Hybrid still yields snippets below.
        logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] scrape budget {scrape_budget}s exceeded — degrading{RESET}")
        results = [None] * len(records)

    out = []
    attempts = ok = failed = 0
    for rec, res in zip(records, results):
        if len(out) >= max_sites:
            break
        attempts += 1
        if isinstance(res, dict) and "content" in res:
            out.append({"title": res["title"], "url": res["url"], "content": res["content"]})
            ok += 1
        else:
            failed += 1
            if snippet_fallback and rec["snippet"]:
                out.append({
                    "title": rec["title"], "url": rec["url"],
                    "content": rec["snippet"][:content_char_limit],
                })
    return out, {"scrape_attempts": attempts, "scrape_ok": ok, "scrape_failed": failed}


def _build_combined_text(query, scraped_content, raw_content_limit):
    """The research-context block for the entity-profiling prompt: the evidence
    sources (each truncated to per_site_content_limit, the whole capped at
    raw_content_limit) or, when nothing gathered, a keyword fallback. One owner —
    both the registry path and the custom-prompt path render through here."""
    if not scraped_content:
        keywords = [w.strip() for w in _split_keywords(query) if len(w.strip()) >= MIN_KEYWORD_LENGTH]
        fallback_context = f"Query contains terms: {', '.join(keywords[:_WS_CONFIG['fallback_keywords_limit']])}"
        return f"Research about: {query}\n\n{fallback_context}"
    return f"Research about: {query}\n\n" + "\n\n".join(
        f"{i}. {item['title']}\n{item['content'][:_EP_CONFIG['per_site_content_limit']]}"
        for i, item in enumerate(scraped_content, 1)
    )[:raw_content_limit]


def _build_research_prompt(query, scraped_content, schema, raw_content_limit):
    """Build LLM prompt for entity profile extraction"""
    combined_text = _build_combined_text(query, scraped_content, raw_content_limit)
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


def _build_debug_info(scraped_content, search_method, search_log, query, max_sites,
                      content_char_limit, raw_content_limit, query_prefix="", query_suffix="",
                      skip_search=False, num_results=0):
    """Build debug information dictionary. The three ``scraped_sources`` shapes
    (success / skipped / error) and the transient ``warnings`` codes are the
    cross-repo contract PromptPotter reads — keep them stable. Strategy-level
    scrape cost lives in the separate ``web_cost`` block (added by the caller)."""
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
    stats = {"target": max_sites, "usable": len(scraped_content), "requested": num_results}

    if scraped_content:
        sources_info = {
            "sources_fetched": [
                {'title': item['title'], 'url': item['url']} for item in scraped_content
            ],
            "search_method": search_method,
            "method_parameters": method_params,
        }
        msg = f"{len(scraped_content)} usable of {max_sites} target ({num_results} requested)"
        info.append({"step": "web_search", "code": "fetch_stats", "message": msg, "stats": stats})

        # max_sites is a cap we stop at, not a floor we must hit — only warn when
        # we actually came up short of the target.
        if len(scraped_content) < max_sites:
            warnings.append({
                "step": "web_search", "code": "low_document_count", "kind": "transient",
                "message": msg, "stats": stats,
            })
    elif skip_search:
        sources_info = {
            "status": "skipped",
            "note": "Web search disabled",
            "method_parameters": method_params,
        }
    else:
        sources_info = {
            "error": "web_search_no_content",
            "search_attempts": search_log,
            "fallback": "LLM knowledge only",
            "method_parameters": method_params,
        }
        last_log = search_log[-1] if search_log else "no results"
        code = "search_failed" if search_log else "no_results"
        warnings.append({
            "step": "web_search", "code": code, "kind": "transient",
            "message": f"No web evidence — {last_log}",
        })

    return {
        "inputs": {"scraped_sources": sources_info},
        "warnings": warnings,
        "info": info,
    }


async def web_generate_entity_profile(query, ws_cfg, ep_cfg, schema, skip_search=False, warnings=None, scraped_content=None, usage_out=None):
    """Web search + entity profiling.

    Evidence gathering is strategy-driven (``ws_cfg["strategy"]``):
      - ``snippets``: use the text Brave returns — one query, no scraping, no hang.
      - ``scrape``:   full-page scrape under a hard aggregate deadline (deep, slower).
      - ``hybrid``:   scrape, falling back to each result's snippet on failure.
    All three issue exactly ONE metered Brave query per match; the trade is depth vs
    latency vs LLM tokens, which PromptPotter sweeps on ground truth. See
    ``docs/WEB_SEARCH_STRATEGY.md``.

    Args:
        query: Input query string.
        ws_cfg: Web search node config dict (strategy, max_sites, num_results, ...).
        ep_cfg: Entity profiling node config dict (temperature, max_tokens, model, prompt, ...).
        schema: Entity profile JSON schema.
        skip_search: If True, skip web search (LLM knowledge only).
        warnings: Mutable list to collect LLM retry warnings.
        scraped_content: Precomputed web content (skips gathering when provided).
        usage_out: Optional dict to receive the provider's token usage
            (``{"input": int, "output": int}``). Also mirrored into
            ``debug_info["llm_usage"]``.
    """
    if not schema:
        raise ValueError("Schema parameter is required.")

    max_sites = ws_cfg["max_sites"]
    num_results = ws_cfg["num_results"]
    content_char_limit = ws_cfg["content_char_limit"]
    query_prefix = ws_cfg.get("query_prefix", "")
    query_suffix = ws_cfg.get("query_suffix", "")
    raw_content_limit = ep_cfg["raw_content_limit"]
    strategy = ws_cfg.get("strategy", "hybrid")
    scrape_budget = ws_cfg.get("scrape_budget", 20)
    extract_pdf = ws_cfg.get("extract_pdf", False)

    search_log = []
    fetched = 0
    search_method = "skipped"
    scrape_stats = {"scrape_attempts": 0, "scrape_ok": 0, "scrape_failed": 0}
    brave_queries = 0
    cost_strategy = strategy

    # Web search phase timing
    ws_start = time.time()
    if scraped_content is not None:
        # Precomputed web content — skip gathering entirely
        ws_elapsed = 0.0
        search_method = "precomputed"
        cost_strategy = "precomputed"
        fetched = len(scraped_content)
        logger.info(f"[WEB_SCRAPE] Using {len(scraped_content)} precomputed sources")
        search_log.append(f"Web search precomputed ({len(scraped_content)} sources)")
    elif skip_search:
        scraped_content = []
        ws_elapsed = None
        cost_strategy = "skipped"
        logger.info("[WEB_SCRAPE] Skipped (LLM knowledge only)")
        search_log.append("Web search skipped (skip_search=True)")
    else:
        scraped_content = []
        search_method = "Brave Search API"
        brave_queries = 1
        # The single metered Brave query, hard-bounded so a DNS/connection edge
        # case can't stall the step before the strategy even runs.
        try:
            records = await asyncio.wait_for(
                asyncio.to_thread(
                    _brave_search, query, num_results=num_results, log=search_log,
                    query_prefix=query_prefix, query_suffix=query_suffix,
                ),
                timeout=ws_cfg["brave_api_timeout"] + 2,
            )
        except Exception as e:
            records = []
            logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] Brave search bounded-timeout: {e}{RESET}")
            search_log.append(f"Brave search error: {e}")

        if records:
            if strategy == "snippets":
                scraped_content = _from_snippets(records, max_sites, content_char_limit)
            else:
                scraped_content, scrape_stats = await _from_scrape(
                    records, max_sites, content_char_limit, scrape_budget, extract_pdf,
                    snippet_fallback=(strategy == "hybrid"),
                )
            fetched = len(scraped_content)
            if scraped_content:
                titles = " | ".join(s["title"][:40] for s in scraped_content)
                logger.info(
                    f"{GREEN}[WEB_SCRAPE] ✓ {fetched} sources · target {max_sites} · "
                    f"strategy={strategy} · scrape_ok={scrape_stats['scrape_ok']} "
                    f"scrape_failed={scrape_stats['scrape_failed']}{RESET}: {titles}"
                )
            else:
                logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] ✗ 0/{max_sites} sources (strategy={strategy}){RESET}")
        else:
            logger.warning(f"{BRIGHT_RED}[WEB_SCRAPE] ✗ No results{RESET}")
        ws_elapsed = round(time.time() - ws_start, 3)

    # Build research prompt (custom override or registry-based)
    profiling_prompt = ep_cfg.get("prompt")
    profiling_schema = ep_cfg.get("output_schema")
    profiling_provider = ep_cfg["provider"]
    profiling_model = ep_cfg["model"]
    if profiling_prompt:
        # Custom prompt with {{variable}} substitution
        combined_text = _build_combined_text(query, scraped_content, raw_content_limit)
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
        "structured_output_mode": ep_cfg.get("structured_output_mode"),
        # Cap reasoning_effort: "low" in the node config for schema nodes — Groq gpt-oss
        # reasoning models return HTTP 400 json_validate_failed (empty failed_generation,
        # unrecoverable by the repair loop) when native strict json_schema is paired with
        # reasoning_effort: "high". Confirmed working at none/low/medium.
        "reasoning_effort": ep_cfg.get("reasoning_effort"),
    }
    if profiling_schema:
        llm_kwargs["schema"] = profiling_schema

    # LLM call phase timing
    llm_start = time.time()
    _usage: dict = {}
    result = await llm_call(**llm_kwargs, warnings=warnings, usage_out=_usage, node_name="entity_profiling")
    llm_elapsed = round(time.time() - llm_start, 3)
    if usage_out is not None and _usage:
        usage_out.update(_usage)

    # The non-strict recovery path (prompt_repair, taken when a token-budget 400 forces us off
    # constrained decoding) can return the profile wrapped in a single-element array instead of
    # the bare object — the strict json_schema decoder would have forbidden it. Unwrap to the
    # first object so the metadata stamp below doesn't crash with "list indices must be integers".
    if isinstance(result, list):
        result = next((item for item in result if isinstance(item, dict)), {})

    processing_time = (ws_elapsed or 0) + llm_elapsed
    result['_metadata'] = {
        'query': query,
        'sources_count': len(scraped_content),
        'processing_time_seconds': round(processing_time, 2),
        'sources': [{'title': item['title'], 'url': item['url']} for item in scraped_content]
    }

    # Build debug info
    debug_info = _build_debug_info(scraped_content, search_method, search_log,
                                    query, max_sites, content_char_limit, raw_content_limit,
                                    query_prefix=query_prefix, query_suffix=query_suffix,
                                    skip_search=skip_search, num_results=num_results)
    debug_info["web_search_elapsed"] = ws_elapsed
    debug_info["llm_elapsed"] = llm_elapsed
    if _usage:
        debug_info["llm_usage"] = dict(_usage)
    # Cost + reliability per match — the axis PromptPotter weighs against accuracy
    # to pick "most efficiently true". brave_queries is the metered cost (==1 on a
    # live search, 0 when skipped/precomputed) and is the free-tier ceiling.
    debug_info["web_cost"] = {
        "strategy": cost_strategy,
        "brave_queries": brave_queries,
        "evidence_chars": sum(len(item.get("content", "")) for item in scraped_content),
        **scrape_stats,
    }
    # Full evidence content for intermediate caching (Wave 4)
    debug_info["scraped_content"] = scraped_content
    return result, debug_info
