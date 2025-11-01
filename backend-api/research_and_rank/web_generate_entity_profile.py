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

async def web_generate_entity_profile(query, max_sites=6, schema=None, content_char_limit=800, raw_content_limit=5000, verbose=False):
    if schema is None:
        raise ValueError("Schema parameter is required. Please provide a valid schema dictionary.")

    start_time = time.time()
    time.sleep(1)
    search_log = []  # Track all search attempts

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    }

    # Try DuckDuckGo
    print(f"{MAGENTA}[WEB_SCRAPE] Searching DuckDuckGo for: '{query}'{RESET}")
    ddg_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}&kl=us-en&lr=lang_en"
    urls = _search_engine("DuckDuckGo", ddg_url, headers, query, search_log)

    # If DDG returns 0 URLs, try enriched query
    if not urls:
        enriched = f"{query} material properties"
        print(f"{MAGENTA}[WEB_SCRAPE] Retrying with: '{enriched}'{RESET}")
        search_log.append(f"Retrying with enriched query: '{enriched}'")
        urls = _search_engine("DuckDuckGo", f"https://html.duckduckgo.com/html/?q={quote_plus(enriched)}&kl=us-en&lr=lang_en", headers, enriched, search_log)

    # If still no URLs, try Bing
    if not urls:
        print(f"{MAGENTA}[WEB_SCRAPE] Trying Bing fallback...{RESET}")
        search_log.append("Trying Bing fallback...")
        bing_url = f"https://www.bing.com/search?q={quote_plus(query)}&setlang=en&mkt=en-US"
        urls = _search_engine("Bing", bing_url, headers, query, search_log)

        # If Bing returns 0 URLs, try enriched
        if not urls:
            enriched = f"{query} technical specifications"
            print(f"{MAGENTA}[WEB_SCRAPE] Retrying Bing with: '{enriched}'{RESET}")
            search_log.append(f"Retrying Bing with: '{enriched}'")
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
    
    format_string = generate_format_string_from_schema(schema)
    
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

    # Always return debug info with metadata only (no full content)
    if scraped_content:
        sources = {
            "sources_fetched": [{'title': item['title'], 'url': item['url']} for item in scraped_content],
            "search_method": "DuckDuckGo w/ Bing fallback",
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