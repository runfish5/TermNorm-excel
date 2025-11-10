import json
import time
import random
import logging
import re
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote_plus
from core.llm_providers import llm_call
from utils.utils import CYAN, MAGENTA, RED, RESET, YELLOW, GREEN, BOLD
from config.settings import settings

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
    """Simple URL scraping with requests"""
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

def _search_engine(engine_name, search_url, headers, query, log):
    """Helper: Try search engine and return URLs"""
    try:
        response = requests.get(search_url, headers=headers, timeout=10)
        msg = f"{engine_name} status: {response.status_code}"
        print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
        log.append(msg)

        # Handle bot detection (202 = DuckDuckGo CAPTCHA)
        if response.status_code == 202:
            msg = f"{engine_name} bot detection (202), skipping..."
            print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
            log.append(msg)
            return []

        if response.status_code == 200:
            soup = BeautifulSoup(response.content, 'html.parser')

            if 'duckduckgo' in search_url:
                urls = [a.get('href') for a in soup.find_all('a', class_='result__a')
                        if a.get('href') and a.get('href').startswith('http')]
            else:  # Bing
                # Bing uses redirect URLs in href, but real URLs are in <cite> tags
                cite_tags = soup.select('li.b_algo cite')
                urls = []
                for cite in cite_tags:
                    url_text = cite.get_text().strip()
                    # Clean up cite text (remove separators like '›')
                    url_text = url_text.replace(' › ', '/').replace(' � ', '/')
                    # Ensure it starts with http
                    if not url_text.startswith('http'):
                        url_text = 'https://' + url_text
                    urls.append(url_text)

            msg = f"{engine_name} found {len(urls)} URLs"
            print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
            log.append(msg)
            return urls
        else:
            msg = f"{engine_name} failed, status: {response.status_code}"
            print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
            log.append(msg)
    except Exception as e:
        msg = f"{engine_name} error: {str(e)}"
        print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
        log.append(msg)
    return []

def _brave_search(query, num_results=20, log=None):
    """
    Brave Search API - Primary search method (requires API key)
    Free tier: 2,000 queries/month, 1 query/second
    Get key at: https://api-dashboard.search.brave.com/register
    Set in .env: BRAVE_SEARCH_API_KEY=your_key
    Toggle with: USE_BRAVE_API=true/false (default: true)
    """
    # Check if Brave API is disabled (for testing fallbacks)
    if not settings.use_brave_api:
        msg = "Brave Search disabled (USE_BRAVE_API=false)"
        print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
        if log:
            log.append(msg)
        return []

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
    Rotates through multiple public instances for reliability
    """
    # Expanded instance pool with known-working alternatives
    searx_instances = [
        'https://searx.be',
        'https://searx.tiekoetter.com',
        'https://searx.ninja',
        'https://search.bus-hit.me',
        'https://paulgo.io',
        'https://searx.work',
        'https://opnxng.com'
    ]

    for instance in searx_instances:
        try:
            response = requests.get(
                f"{instance}/search",
                params={'q': query, 'format': 'json', 'language': 'en', 'safesearch': 0},
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},
                timeout=12
            )

            if response.status_code == 200:
                results = response.json().get('results', [])
                urls = [r['url'] for r in results[:num_results] if 'url' in r and r['url'].startswith('http')]

                if urls:
                    msg = f"SearXNG ({instance.split('//')[1].split('/')[0]}) found {len(urls)} URLs"
                    print(f"{MAGENTA}[WEB_SCRAPE] {msg}{RESET}")
                    if log:
                        log.append(msg)
                    return urls
            elif response.status_code == 429:
                # Rate limited - try next instance
                continue

        except Exception:
            # Silently skip failed instances, try next
            continue

    msg = "All SearXNG instances unavailable (rate limited or offline)"
    print(f"{RED}[WEB_SCRAPE] {msg}{RESET}")
    if log:
        log.append(msg)
    return []


def _execute_search_fallback_chain(query, headers, search_log):
    """Execute 4-tier search fallback chain, return (urls, search_method)"""
    # 1. Brave Search API (if configured/enabled)
    urls = _brave_search(query, num_results=20, log=search_log)
    if urls:
        return urls, "Brave Search API"

    # 2. SearXNG meta-search
    urls = _searxng_fallback(query, num_results=20, log=search_log)
    if urls:
        return urls, "SearXNG meta-search"

    # 3. DuckDuckGo scraping
    time.sleep(1)  # Brief delay for bot mitigation
    ddg_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}&kl=us-en"
    urls = _search_engine("DuckDuckGo", ddg_url, headers, query, search_log)
    if urls:
        return urls, "DuckDuckGo scraping"

    # 4. Bing scraping (final fallback)
    bing_url = f"https://www.bing.com/search?q={quote_plus(query)}&setlang=en"
    urls = _search_engine("Bing", bing_url, headers, query, search_log)
    if urls:
        return urls, "Bing scraping"

    return [], "All search methods failed"


def _build_research_prompt(query, scraped_content, schema, raw_content_limit):
    """Build LLM prompt for entity profile extraction"""
    # Build combined text from scraped content or fallback
    if not scraped_content:
        keywords = [w.strip() for w in query.replace('/', ' ').replace('-', ' ').split() if len(w.strip()) > 2]
        fallback_context = f"Query contains terms: {', '.join(keywords[:8])}"
        combined_text = f"Research about: {query}\n\n{fallback_context}"
    else:
        combined_text = f"Research about: {query}\n\n" + "\n\n".join(
            [f"{i}. {item['title']}\n{item['content'][:500]}" for i, item in enumerate(scraped_content, 1)]
        )[:raw_content_limit]

    format_string = generate_format_string_from_schema(schema)

    return f"""You are a comprehensive technical database API specialized in exhaustive entity profiling. Extract ALL possible information about '{query}' from the research data and return it in this exact JSON format:
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


def _build_debug_info(scraped_content, search_method, search_log, scrape_errors, query, max_sites, content_char_limit, raw_content_limit):
    """Build debug information dictionary"""
    method_params = {
        "query": query,
        "max_sites": max_sites,
        "content_char_limit": content_char_limit,
        "raw_content_limit": raw_content_limit
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

async def web_generate_entity_profile(query, max_sites=6, schema=None, content_char_limit=800, raw_content_limit=5000, verbose=False):
    if schema is None:
        raise ValueError("Schema parameter is required. Please provide a valid schema dictionary.")

    start_time = time.time()
    search_log = []

    # User-Agent rotation for bot mitigation
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    ]
    headers = {
        'User-Agent': random.choice(user_agents),
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }

    # Execute search fallback chain (Brave → SearXNG → DuckDuckGo → Bing)
    urls, search_method = _execute_search_fallback_chain(query, headers, search_log)
    
    scraped_content = []
    scrape_errors = []

    # Parallel URL scraping with ThreadPoolExecutor
    if urls:
        print(f"{MAGENTA}[WEB_SCRAPE] Scraping {min(len(urls), max_sites * 2)} URLs in parallel...{RESET}")

        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(lambda url: scrape_url(url, content_char_limit), urls[:max_sites * 2]))

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
    
    # Build research prompt
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
            # Content is truncated to 500 chars per site in _build_research_prompt
            content_length = min(len(item['content']), 500)
            title_length = len(item['title'])
            total_site_length = content_length + title_length
            print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET}   - Site {i} ({item['title'][:40]}...): {total_site_length:,} chars (title: {title_length}, content: {content_length})")
    else:
        print(f"{YELLOW}{BOLD}[PROMPT_STATS]{RESET} No scraped content - using fallback context")

    print()  # Blank line for readability

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

    # Build debug info
    debug_info = _build_debug_info(scraped_content, search_method, search_log, scrape_errors,
                                    query, max_sites, content_char_limit, raw_content_limit)
    return result, debug_info