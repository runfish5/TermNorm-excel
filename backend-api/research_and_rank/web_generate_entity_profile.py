import json
import time
import requests
import logging
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote_plus
from core.llm_providers import llm_call
from utils.utils import CYAN, MAGENTA, RED, RESET
import re
import asyncio
from config.settings import settings
from prompts.prompt_loader import get_prompt_loader

logger = logging.getLogger(__name__)
def generate_format_string_from_schema(schema):
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
    skip_extensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']
    skip_domains = ['academia.edu', 'researchgate.net', 'arxiv.org', 'ieee.org']

    if any(ext in url.lower() for ext in skip_extensions) or any(domain in url.lower() for domain in skip_domains):
        return None

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }

        response = requests.get(url, timeout=5, headers=headers)
        if response.status_code != 200:
            return None

        soup = BeautifulSoup(response.content[:50000], 'html.parser')
        for tag in soup(['script', 'style', 'nav', 'header', 'footer']):
            tag.decompose()

        text = re.sub(r'\s+', ' ', soup.get_text().strip())
        if len(text) < 200 or len(text) > 10000:
            return None

        title = soup.find('title')
        title = title.get_text().strip()[:100] if title else url.split('/')[-1]

        return {'title': title, 'content': text[:char_limit], 'url': url}
    except Exception as e:
        logger.error(f"Scraping failed for {url}: {e}")
        return None

def _search_engine(engine_name, search_url, headers, query_label, log):
    """Helper: Try search engine and return URLs"""
    try:
        response = requests.get(search_url, headers=headers, timeout=10)
        msg = f"{engine_name} status: {response.status_code}"
        print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
        log.append(msg)

        if response.status_code == 202:
            msg = f"{engine_name} returned 202, retrying..."
            print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
            log.append(msg)
            time.sleep(2)
            response = requests.get(search_url, headers=headers, timeout=15)
            msg = f"{engine_name} retry status: {response.status_code}"
            print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
            log.append(msg)

        if response.status_code == 200:
            soup = BeautifulSoup(response.content, 'html.parser')
            if 'duckduckgo' in search_url:
                urls = [l.get('href') for l in soup.find_all('a', class_='result__a')
                        if l.get('href') and l.get('href').startswith('http')]
            else:  # Bing
                urls = [l.get('href') for l in soup.find_all('a', href=True)
                       if l.get('href') and l.get('href').startswith('http') and 'bing.com' not in l.get('href')]
            msg = f"{engine_name} found {len(urls)} URLs"
            print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
            log.append(msg)
            return urls
        else:
            msg = f"{engine_name} failed, status: {response.status_code}"
            print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
            log.append(msg)
    except Exception as e:
        msg = f"{engine_name} failed: {str(e)}"
        print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
        log.append(msg)
    return []

def _brave_search(query, num_results=20, log=None):
    """
    Brave Search API - Primary search method (requires API key)
    Free tier: 2,000 queries/month, 1 query/second
    Get key at: https://api-dashboard.search.brave.com/register
    Set in .env: BRAVE_SEARCH_API_KEY=your_key
    """
    api_key = settings.brave_search_api_key
    if not api_key:
        msg = "Brave Search API key not configured (set BRAVE_SEARCH_API_KEY in .env)"
        print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
        if log:
            log.append(msg)
        return []

    try:
        msg = f"Trying Brave Search API for: '{query}'"
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
                'q': query,
                'count': num_results,
                'search_lang': 'en',
                'country': 'US'
            },
            headers=headers,
            timeout=10
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

def _searxng_fallback(query, num_results=20, log=None):
    """
    SearXNG meta-search fallback - queries 70+ engines simultaneously
    Use when Brave Search is unavailable or rate limited
    """
    # Try multiple public instances for reliability
    searx_instances = [
        'https://searx.be',
        'https://searx.tiekoetter.com',
        'https://searx.ninja'
    ]

    for instance in searx_instances:
        try:
            msg = f"Trying SearXNG instance: {instance}"
            print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
            if log:
                log.append(msg)

            response = requests.get(
                f"{instance}/search",
                params={
                    'q': query,
                    'format': 'json',
                    'language': 'en',
                    'safesearch': 0
                },
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},
                timeout=15
            )

            if response.status_code == 200:
                data = response.json()
                results = data.get('results', [])
                urls = [r['url'] for r in results[:num_results] if 'url' in r and r['url'].startswith('http')]

                msg = f"SearXNG ({instance}) found {len(urls)} URLs"
                print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
                if log:
                    log.append(msg)

                if urls:  # If we got results, return them
                    return urls
            else:
                msg = f"SearXNG instance {instance} returned {response.status_code}"
                print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
                if log:
                    log.append(msg)

        except Exception as e:
            msg = f"SearXNG instance {instance} failed: {str(e)}"
            print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
            if log:
                log.append(msg)
            continue

    msg = "All SearXNG instances failed"
    print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
    if log:
        log.append(msg)
    return []

async def web_generate_entity_profile(query, max_sites=6, schema=None, content_char_limit=800, raw_content_limit=5000, verbose=False, prompt_version="latest"):
    if schema is None:
        raise ValueError("Schema parameter is required. Please provide a valid schema dictionary.")

    start_time = time.time()
    time.sleep(1)
    search_log = []  # Track all search attempts

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    }

    # FALLBACK CHAIN: Brave → SearXNG → DuckDuckGo → Bing
    # Brave (if API key configured) → SearXNG (no key) → DDG/Bing scraping (preserved for future)
    # Get Brave key: https://api-dashboard.search.brave.com/register (2k free queries/month)

    # 1. PRIMARY: Try Brave Search API (if configured)
    urls = _brave_search(query, num_results=20, log=search_log)

    # Try enriched query with Brave if initial fails
    if not urls and settings.brave_search_api_key:
        enriched = f"{query} material properties"
        print(f"{MAGENTA}[WEB_SCRAPE] Brave retry with: '{enriched}'{RESET}")
        search_log.append(f"Brave retry with enriched query: '{enriched}'")
        urls = _brave_search(enriched, num_results=20, log=search_log)

    # 2. FALLBACK 1: Try SearXNG meta-search (no API key required)
    if not urls:
        print(f"{MAGENTA}[WEB_SCRAPE] Trying SearXNG meta-search...{RESET}")
        search_log.append("Trying SearXNG meta-search (fallback 1)...")
        urls = _searxng_fallback(query, num_results=20, log=search_log)

        # Try enriched query with SearXNG if initial fails
        if not urls:
            enriched = f"{query} material properties technical specifications"
            print(f"{MAGENTA}[WEB_SCRAPE] SearXNG retry with: '{enriched}'{RESET}")
            search_log.append(f"SearXNG retry with: '{enriched}'")
            urls = _searxng_fallback(enriched, num_results=20, log=search_log)

    # 3. FALLBACK 2: Try DuckDuckGo scraping (rate limited)
    if not urls:
        print(f"{MAGENTA}[WEB_SCRAPE] Trying DuckDuckGo fallback...{RESET}")
        search_log.append("Trying DuckDuckGo fallback (fallback 2)...")
        ddg_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}&kl=us-en&lr=lang_en"
        urls = _search_engine("DuckDuckGo", ddg_url, headers, query, search_log)

        # Try enriched query with DDG if initial fails
        if not urls:
            enriched = f"{query} material properties"
            print(f"{MAGENTA}[WEB_SCRAPE] DuckDuckGo retry with: '{enriched}'{RESET}")
            search_log.append(f"DuckDuckGo retry with: '{enriched}'")
            urls = _search_engine("DuckDuckGo", f"https://html.duckduckgo.com/html/?q={quote_plus(enriched)}&kl=us-en&lr=lang_en", headers, enriched, search_log)

    # 4. FALLBACK 3: Try Bing scraping (final fallback)
    if not urls:
        print(f"{MAGENTA}[WEB_SCRAPE] Trying Bing fallback...{RESET}")
        search_log.append("Trying Bing fallback (fallback 3)...")
        bing_url = f"https://www.bing.com/search?q={quote_plus(query)}&setlang=en&mkt=en-US"
        urls = _search_engine("Bing", bing_url, headers, query, search_log)

        # Try enriched query with Bing if initial fails
        if not urls:
            enriched = f"{query} technical specifications"
            print(f"{MAGENTA}[WEB_SCRAPE] Bing retry with: '{enriched}'{RESET}")
            search_log.append(f"Bing retry with: '{enriched}'")
            urls = _search_engine("Bing", f"https://www.bing.com/search?q={quote_plus(enriched)}&setlang=en&mkt=en-US", headers, enriched, search_log)
    
    scraped_content = []
    scrape_errors = []

    if urls:
        print(f"{MAGENTA}[WEB_SCRAPE] Attempting to scrape {min(len(urls), max_sites * 2)} URLs...{RESET}")
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(scrape_url, url, content_char_limit) for url in urls[:max_sites * 2]]
            for i, future in enumerate(futures):
                result = future.result()
                if result:
                    scraped_content.append(result)
                    print(f"{MAGENTA}[WEB_SCRAPE] ✓ Scraped {len(scraped_content)}/{max_sites}: {result['title'][:50]}{RESET}")
                    if len(scraped_content) >= max_sites:
                        break
                else:
                    scrape_errors.append(urls[i])

        # BACKUP: If all failed but more URLs available, try the rest
        if not scraped_content and len(urls) > max_sites * 2:
            remaining_urls = urls[max_sites * 2:]
            print(f"{MAGENTA}[WEB_SCRAPE] First batch failed - trying {len(remaining_urls)} more URLs...{RESET}")

            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [executor.submit(scrape_url, url, content_char_limit) for url in remaining_urls]
                for i, future in enumerate(futures):
                    result = future.result()
                    if result:
                        scraped_content.append(result)
                        print(f"{MAGENTA}[WEB_SCRAPE] ✓ Scraped {len(scraped_content)}/{max_sites}: {result['title'][:50]}{RESET}")
                        if len(scraped_content) >= max_sites:
                            break
                    else:
                        scrape_errors.append(remaining_urls[i])

        if scraped_content:
            print(f"{MAGENTA}[WEB_SCRAPE] ✓ Results: {len(scraped_content)} successful, {len(scrape_errors)} failed{RESET}")
        else:
            print(f"{RED}[WEB_SCRAPE] ✗ All scraping failed! {len(scrape_errors)} attempts{RESET}")

        if scrape_errors:
            print(f"{MAGENTA}[WEB_SCRAPE] Failed URLs sample: {scrape_errors[:3]}{RESET}")
    else:
        print(f"{RED}[WEB_SCRAPE] ✗ No URLs found for query: '{query}'{RESET}")
    
    # If scraping failed, add generic domain keywords to help LLM
    if not scraped_content:
        # Extract potential domain keywords from query
        keywords = [w.strip() for w in query.replace('/', ' ').replace('-', ' ').split() if len(w.strip()) > 2]
        fallback_context = f"Query contains terms: {', '.join(keywords[:8])}"
        combined_text = f"Research about: {query}\n\n{fallback_context}"
    else:
        combined_text = f"Research about: {query}\n\n" + "\n\n".join(
            [f"{i}. {item['title']}\n{item['content'][:500]}" for i, item in enumerate(scraped_content, 1)]
        )[:raw_content_limit]
    
    # Load versioned prompt or use default
    format_string = generate_format_string_from_schema(schema)

    try:
        prompt_loader = get_prompt_loader()
        prompt_data = prompt_loader.load_prompt('entity_profiling', prompt_version)
        prompt = prompt_loader.format_prompt(
            prompt_data,
            query=query,
            format_string=format_string,
            combined_text=combined_text
        )
        if verbose:
            print(f"[PROFILING] Using prompt v{prompt_data['version']}: {prompt_data.get('name', 'Unknown')}")
    except Exception as e:
        # Fallback to hardcoded prompt if versioned prompt fails
        logger.warning(f"Failed to load versioned prompt, using default: {e}")
        prompt = f"""You are a comprehensive technical database API specialized in exhaustive entity profiling. Extract ALL possible information about '{query}' from the research data and return it in this exact JSON format:
{format_string}

CRITICAL SPELLING REQUIREMENT: In ALL arrays, after each term, immediately add its US/GB spelling variant if different. Example: ["colour", "color", "analyse", "analyze"]. This is MANDATORY for every array field.

CORE CONCEPT IDENTIFICATION: Within '{query}', certain words carry more semantic weight than others. Material names, product codes, and specifications describe WHAT is involved, but other terms describe the fundamental NATURE of what is being expressed. Identify the single word that defines the conceptual essence - typically the term that indicates an activity, action, method, or process rather than an object or material. Output only this one defining word.

PROFESSIONAL CLASSIFICATION ALIASES: Generate the full spectrum of expert-level references for this entity, spanning precise technical descriptors to broader categorical terms. These terms stem from domain-specific terminology and industry-standard nomenclature that professionals recognize. Include approximations and near-equivalent terms that experts use when exact terminology doesn't exist, accepting that some terms may not be perfect equivalents but represent the best available expert terminology for referencing similar concepts.

GENERIC TECHNICAL INFERENCE INSTRUCTION: Given the product or technical description '{query}', perform comprehensive analysis to extract and infer:

1. **Explicit Information**: Directly stated specifications, dimensions, materials, codes, and properties
2. **Implicit Information**: Commonly associated materials, manufacturing processes, applications, and technical characteristics that are standard for this type of product/component, even if not explicitly mentioned
3. **Manufacturing Processes**: Both stated and inferred processes based on product type, materials, and specifications
4. **Material Composition**: Complete material breakdown including standard/typical materials used in such products
5. **Applications & Use Cases**: Direct and derived applications based on product characteristics

**Include domain knowledge**: Draw from technical standards, industry practices, and material science to infer missing but relevant information.

CRITICAL INSTRUCTIONS FOR RICH ATTRIBUTE COLLECTION:
- MAXIMIZE diversity: Include ALL synonyms, trade names, scientific names, abbreviations, acronyms, regional terms, industry terminology
- COMPREHENSIVE extraction: Capture every property, specification, feature, attribute, including numerical values and compositional data
- PRIORITIZE completeness over brevity: Aim for 5-10+ items per array field - be thorough, not minimal
---
RESEARCH DATA:
{combined_text}
---
REMEMBER: Every term must be followed by its US/GB variant if different. Return only the JSON object with ALL fields maximally populated."""
    
    print(CYAN)
    print(prompt)
    print(RESET)
    
    messages = [{"role": "user", "content": prompt}]
    result = await llm_call(messages=messages, temperature=0.3, max_tokens=1800, output_format="json")
    
    processing_time = time.time() - start_time
    result['_metadata'] = {
        'query': query,
        'sources_count': len(scraped_content),
        'processing_time_seconds': round(processing_time, 2),
        'sources': [{'title': item['title'], 'url': item['url']} for item in scraped_content]
    }
    
    if verbose:
        print(f"✅ Generated profile with {len(result)-1} fields | {len(scraped_content)} sources | {processing_time:.1f}s")

    # Determine which search method was used
    log_str = " ".join(search_log)
    if "Brave Search found" in log_str:
        search_method = "Brave Search API"
    elif "SearXNG" in log_str and "found" in log_str:
        search_method = "SearXNG meta-search (Brave unavailable/failed)"
    elif "DuckDuckGo found" in log_str:
        search_method = "DuckDuckGo scraping (Brave & SearXNG failed)"
    elif "Bing found" in log_str:
        search_method = "Bing scraping (all other methods failed)"
    else:
        search_method = "Fallback chain: Brave → SearXNG → DDG → Bing"

    # Always return debug info with metadata only (no full content)
    if scraped_content:
        sources = {
            "sources_fetched": [{'title': item['title'], 'url': item['url']} for item in scraped_content],
            "search_method": search_method,
            "method_parameters": {
                "query": query,
                "max_sites": max_sites,
                "content_char_limit": content_char_limit,
                "raw_content_limit": raw_content_limit
            }
        }
    else:
        sources = {
            "error": "web_scraping_failed",
            "search_attempts": search_log,
            "scrape_failures": len(scrape_errors),
            "fallback": "LLM knowledge only",
            "method_parameters": {
                "query": query,
                "max_sites": max_sites,
                "content_char_limit": content_char_limit,
                "raw_content_limit": raw_content_limit
            }
        }

    debug_info = {"inputs": {"scraped_sources": sources}}
    return result, debug_info