import json
import time
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote_plus
from research_and_rank.llm_providers import llm_call
from utils.utils import CYAN, RED, RESET

import re
import asyncio
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
    """Fast content extraction"""
    skip_extensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']
    skip_domains = ['academia.edu', 'researchgate.net', 'arxiv.org', 'ieee.org']
    
    if any(ext in url.lower() for ext in skip_extensions) or any(domain in url.lower() for domain in skip_domains):
        return None
    
    try:
        response = requests.get(url, timeout=5, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
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
    except:
        return None
async def web_generate_entity_profile(query, max_sites=4, schema=None, content_char_limit=800, raw_content_limit=5000, verbose=False):
    """Research a topic and return structured data"""
    if schema is None:
        raise ValueError("Schema parameter is required. Please provide a valid schema dictionary.")
    
    start_time = time.time()
    time.sleep(1)
    
    # Search DuckDuckGo
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    search_response = requests.get(search_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}, timeout=10)
    
    if search_response.status_code == 202:
        time.sleep(2)
        search_response = requests.get(search_url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}, timeout=15)
    
    # Parse search results
    search_soup = BeautifulSoup(search_response.content, 'html.parser')
    urls = [link.get('href') for link in search_soup.find_all('a', class_='result__a') 
            if link.get('href') and link.get('href').startswith('http')]
    
    # Fallback to Bing if no results
    if not urls:
        try:
            bing_response = requests.get(f"https://www.bing.com/search?q={quote_plus(query)}", 
                                       headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}, timeout=10)
            bing_soup = BeautifulSoup(bing_response.content, 'html.parser')
            # print("THIS IS RESPONSE FROM BING"+ str(bing_soup))
            urls = [link.get('href') for link in bing_soup.find_all('a', href=True) 
                   if link.get('href') and link.get('href').startswith('http') and 'bing.com' not in link.get('href')][:max_sites * 4]
        except:
            pass
    
    # if not urls:
    #     raise Exception("No URLs found in search results")
    
    # Scrape URLs in parallel
    scraped_content = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(scrape_url, url, content_char_limit) for url in urls[:max_sites * 2]]
        for future in futures:
            result = future.result()
            if result:
                scraped_content.append(result)
                if len(scraped_content) >= max_sites:
                    break
    
    # if not scraped_content:
    #     raise Exception("No content found during web scraping")
    
    # Prepare data for LLM
    combined_text = f"Research about: {query}\n\n" + "\n\n".join(
        [f"{i}. {item['title']}\n{item['content'][:500]}" for i, item in enumerate(scraped_content, 1)]
    )[:raw_content_limit]
    
    # Use the old format string generation
    format_string = generate_format_string_from_schema(schema)
    
    # Enhanced prompt for richer keyword and attribute collection
    prompt = f"""You are a comprehensive technical database API specialized in exhaustive entity profiling. Extract ALL possible information about '{query}' from the research data and return it in this exact JSON format:
{format_string}

CRITICAL SPELLING REQUIREMENT: In ALL arrays, after each term, immediately add its US/GB spelling variant if different. Example: ["colour", "color", "analyse", "analyze"]. This is MANDATORY for every array field.

CORE CONCEPT IDENTIFICATION: Within '{query}', certain words carry more semantic weight than others. Material names, product codes, and specifications describe WHAT is involved, but other terms describe the fundamental NATURE of what is being expressed. Identify the single word that defines the conceptual essence - typically the term that indicates an activity, action, method, or process rather than an object or material. Output only this one defining word.

PROFESSIONAL CLASSIFICATION ALIASES: Generate the full spectrum of expert-level references for this entity, spanning precise technical descriptors to broader categorical terms. These terms stem from domain-specific terminology and industry-standard nomenclature that professionals recognize. Include approximations and near-equivalent terms that experts use when exact terminology doesn't exist, accepting that some terms may not be perfect equivalents but represent the best available expert terminology for referencing similar concepts.

CRITICAL INSTRUCTIONS FOR RICH ATTRIBUTE COLLECTION:
- MAXIMIZE keyword diversity: Include ALL synonyms, alternative names, trade names, scientific names, common names, abbreviations, acronyms
- COMPREHENSIVE coverage: Extract every property, characteristic, specification, feature, attribute mentioned, including numerical values and compositional data
- CAPTURE context: related terms, associated concepts, derivative names,  regional terms, industry-specific terminology
- PRIORITIZE completeness over brevity: This is a comprehensive profiling task. Aim for 5-10+ items per array field where possible - be thorough, not minimal

---
RESEARCH DATA:
{combined_text}
---
REMEMBER: Every term must be followed by its US/GB variant if different. Return only the JSON object with ALL fields maximally populated."""
    print(CYAN)
    print(prompt)
    print(RESET)
    # Call LLM with enhanced parameters for richer output
    messages = [{"role": "user", "content": prompt}]
    
    result = await llm_call(messages=messages, temperature=0.3, max_tokens=1800, output_format="json")
    
    # Add metadata
    processing_time = time.time() - start_time
    result['_metadata'] = {
        'query': query,
        'sources_count': len(scraped_content),
        'processing_time_seconds': round(processing_time, 2),
        'sources': [{'title': item['title'], 'url': item['url']} for item in scraped_content]
    }
    
    if verbose:
        print(f"✅ Generated profile with {len(result)-1} fields | {len(scraped_content)} sources | {processing_time:.1f}s")
    
    
    
    return result
def web_generate_entity_profile_sync(query, max_sites=4, schema=None, content_char_limit=800, raw_content_limit=5000, verbose=False):
    """Synchronous wrapper"""
    return asyncio.run(web_generate_entity_profile(query, max_sites, schema, content_char_limit, raw_content_limit, verbose))