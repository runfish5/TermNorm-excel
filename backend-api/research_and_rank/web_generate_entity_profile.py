import time
import random
import logging
import re
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor
from core.llm_providers import llm_call
from utils.utils import CYAN, MAGENTA, RED, RESET, YELLOW, GREEN, BOLD
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

_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
]


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
    """Simple URL scraping with requests"""
    if any(ext in url.lower() for ext in SKIP_EXTENSIONS) or any(domain in url.lower() for domain in SKIP_DOMAINS):
        return None

    try:
        headers = {
            'User-Agent': random.choice(_USER_AGENTS),
            'Accept-Language': ACCEPT_LANGUAGE
        }

        response = requests.get(url, timeout=SCRAPE_TIMEOUT_SECONDS, headers=headers)
        if response.status_code != 200:
            return None

        soup = BeautifulSoup(response.content[:SCRAPE_MAX_RESPONSE_BYTES], 'html.parser')
        for tag in soup(HTML_STRIP_TAGS):
            tag.decompose()

        text = re.sub(r'\s+', ' ', soup.get_text().strip())
        if len(text) < SCRAPE_MIN_TEXT_LENGTH or len(text) > SCRAPE_MAX_TEXT_LENGTH:
            return None

        title = soup.find('title')
        title = title.get_text().strip()[:SCRAPE_TITLE_MAX_LENGTH] if title else url.split('/')[-1]

        return {'title': title, 'content': text[:char_limit], 'url': url}

    except Exception as e:
        logger.error(f"Scraping failed for {url}: {e}")
        return None

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
        print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
        if log:
            log.append(msg)

        headers = {
            'X-Subscription-Token': api_key,
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip'
        }

        response = requests.get(
            'https://api.search.brave.com/res/v1/web/search',
            params={
                'q': effective_query,
                'count': num_results,
                'search_lang': SEARCH_LANGUAGE,
                'country': SEARCH_COUNTRY,
                'spellcheck': _WS_CONFIG["spellcheck"],
            },
            headers=headers,
            timeout=_WS_CONFIG["brave_api_timeout"]
        )

        if response.status_code == 200:
            data = response.json()
            results = data.get('web', {}).get('results', [])
            urls = [r['url'] for r in results if 'url' in r and r['url'].startswith('http')]

            msg = f"Brave Search found {len(urls)} URLs"
            print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
            if log:
                log.append(msg)

            return urls
        elif response.status_code == 429:
            msg = f"Brave Search rate limit exceeded (free tier: 2000/month, 1/sec)"
            print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
            if log:
                log.append(msg)
        else:
            msg = f"Brave Search failed with status {response.status_code}"
            print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
            if log:
                log.append(msg)

    except Exception as e:
        msg = f"Brave Search failed: {str(e)}"
        print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
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


def _build_debug_info(scraped_content, search_method, search_log, scrape_errors, query, max_sites, content_char_limit, raw_content_limit, query_prefix="", query_suffix="", skip_search=False):
    """Build debug information dictionary"""
    method_params = {
        "query": query,
        "max_sites": max_sites,
        "content_char_limit": content_char_limit,
        "raw_content_limit": raw_content_limit,
        "query_prefix": query_prefix,
        "query_suffix": query_suffix,
    }

    if scraped_content:
        return {
            "inputs": {
                "scraped_sources": {
                    "sources_fetched": [{'title': item['title'], 'url': item['url']} for item in scraped_content],
                    "search_method": search_method,
                    "method_parameters": method_params
                }
            }
        }
    elif skip_search:
        return {
            "inputs": {
                "scraped_sources": {
                    "status": "skipped",
                    "note": "Web search disabled",
                    "method_parameters": method_params
                }
            }
        }
    else:
        return {
            "inputs": {
                "scraped_sources": {
                    "error": "web_scraping_failed",
                    "search_attempts": search_log,
                    "scrape_failures": len(scrape_errors),
                    "fallback": "LLM knowledge only",
                    "method_parameters": method_params
                }
            }
        }

async def web_generate_entity_profile(query, max_sites, schema, content_char_limit, raw_content_limit, num_results, profiling_temperature, profiling_max_tokens, verbose=False, skip_search=False, profiling_prompt=None, profiling_schema=None, profiling_model=None, query_prefix="", query_suffix=""):
    if not schema:
        raise ValueError("Schema parameter is required.")

    search_log = []

    scraped_content = []
    scrape_errors = []
    search_method = "skipped"

    # Web search phase timing
    ws_start = time.time()
    if skip_search:
        ws_elapsed = None
        print(f"{MAGENTA}[WEB_SCRAPE] Skipped (LLM knowledge only){RESET}")
        search_log.append("Web search skipped (skip_search=True)")
    else:
        # Direct Brave Search API call
        urls = _brave_search(query, num_results=num_results, log=search_log,
                             query_prefix=query_prefix, query_suffix=query_suffix)
        search_method = "Brave Search API"

        # Parallel URL scraping with ThreadPoolExecutor
        if urls:
            fetch_limit = max_sites * _WS_CONFIG["url_fetch_multiplier"]
            print(f"{MAGENTA}[WEB_SCRAPE] Scraping {min(len(urls), fetch_limit)} URLs in parallel...{RESET}")

            with ThreadPoolExecutor(max_workers=SCRAPE_MAX_WORKERS) as executor:
                results = list(executor.map(lambda url: scrape_url(url, content_char_limit), urls[:fetch_limit]))

                for i, result in enumerate(results):
                    if result:
                        scraped_content.append(result)
                        print(f"{MAGENTA}[WEB_SCRAPE] ✓ {len(scraped_content)}/{max_sites}: {result['title'][:50]}{RESET}")
                        if len(scraped_content) >= max_sites:
                            break
                    else:
                        scrape_errors.append(urls[i])

            if scraped_content:
                print(f"{MAGENTA}[WEB_SCRAPE] ✓ {len(scraped_content)} successful{RESET}")
            else:
                print(f"{RED}[WEB_SCRAPE] ✗ All scraping failed ({len(scrape_errors)} attempts){RESET}")
        else:
            print(f"{RED}[WEB_SCRAPE] ✗ No URLs found{RESET}")
        ws_elapsed = round(time.time() - ws_start, 3)

    # Build research prompt (custom override or registry-based)
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
    print(CYAN)
    print(prompt)
    print(RESET)

    # Debug: Print prompt statistics
    print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET} {GREEN}Total prompt length: {len(prompt):,} characters{RESET}")

    # Calculate template/instruction portion (everything before "RESEARCH DATA:")
    research_data_marker = "RESEARCH DATA:"
    if research_data_marker in prompt:
        template_end_idx = prompt.index(research_data_marker)
        template_length = template_end_idx
        research_data_length = len(prompt) - template_end_idx
        template_pct = (template_length / len(prompt)) * 100
        research_pct = (research_data_length / len(prompt)) * 100

        print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET} Template/instructions: {template_length:,} chars ({template_pct:.1f}%)")
        print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET} Research data section: {research_data_length:,} chars ({research_pct:.1f}%)")

    # Show individual site content lengths
    if scraped_content:
        print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET} Sites included: {len(scraped_content)}")
        for i, item in enumerate(scraped_content, 1):
            content_length = min(len(item['content']), _EP_CONFIG['per_site_content_limit'])
            title_length = len(item['title'])
            total_site_length = content_length + title_length
            print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET}   - Site {i} ({item['title'][:40]}...): {total_site_length:,} chars (title: {title_length}, content: {content_length})")
    else:
        print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET} No scraped content - using fallback context")

    print()  # Blank line for readability

    messages = [{"role": "user", "content": prompt}]
    llm_kwargs = {
        "messages": messages,
        "temperature": profiling_temperature,
        "max_tokens": profiling_max_tokens,
        "output_format": "schema" if profiling_schema else "json",
    }
    if profiling_schema:
        llm_kwargs["schema"] = profiling_schema
    if profiling_model:
        llm_kwargs["model"] = profiling_model

    # LLM call phase timing
    llm_start = time.time()
    result = await llm_call(**llm_kwargs)
    llm_elapsed = round(time.time() - llm_start, 3)

    processing_time = (ws_elapsed or 0) + llm_elapsed
    result['_metadata'] = {
        'query': query,
        'sources_count': len(scraped_content),
        'processing_time_seconds': round(processing_time, 2),
        'sources': [{'title': item['title'], 'url': item['url']} for item in scraped_content]
    }

    if verbose:
        print(f"✅ Generated profile with {len(result)-1} fields | {len(scraped_content)} sources | {processing_time:.1f}s")

    # Build debug info
    debug_info = _build_debug_info(scraped_content, search_method, search_log, scrape_errors,
                                    query, max_sites, content_char_limit, raw_content_limit,
                                    query_prefix=query_prefix, query_suffix=query_suffix,
                                    skip_search=skip_search)
    debug_info["web_search_elapsed"] = ws_elapsed
    debug_info["llm_elapsed"] = llm_elapsed
    return result, debug_info
