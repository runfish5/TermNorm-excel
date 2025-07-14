from googlesearch import search
import time
import json
from concurrent.futures import ThreadPoolExecutor
from groq import Groq
from bs4 import BeautifulSoup
import re
import requests
from urllib.parse import quote_plus, urljoin
from pprint import pprint


def is_scrapable_url(url):
    """Skip heavy/slow URLs"""
    skip_extensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']
    skip_domains = ['academia.edu', 'researchgate.net', 'arxiv.org', 'ieee.org']

    url_lower = url.lower()
    return not any(ext in url_lower for ext in skip_extensions) and \
           not any(domain in url_lower for domain in skip_domains)

def quick_scrape(url, content_char_limit=800):
    """Fast content extraction with aggressive timeouts"""
    try:
        chat_completion = requests.get(url, timeout=5, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })

        if chat_completion.status_code != 200:
            return None

        # Quick BeautifulSoup parse
        soup = BeautifulSoup(chat_completion.content[:50000], 'html.parser')  # Limit content size

        # Remove unwanted elements quickly
        for tag in soup(['script', 'style', 'nav', 'header', 'footer']):
            tag.decompose()

        # Get text fast
        text = soup.get_text()
        text = re.sub(r'\s+', ' ', text).strip()

        # Quick quality check
        if len(text) < 200 or len(text) > 20000:
            return None

        title = soup.find('title')
        title = title.get_text().strip()[:100] if title else url.split('/')[-1]

        return {
            'title': title,
            'content': text[:content_char_limit],
            'url': url
        }

    except:
        return None
    
    

def _scrape_with_logging(url, content_limit, index, total, verbose, detailed_logging):
    """Helper to scrape a single URL with optional detailed logging"""
    result = quick_scrape(url, content_limit)
    
    if verbose and detailed_logging:
        # Old behavior: print each individual result
        if result:
            print(f"✅ {index}/{total}: {result['title'][:40]}...")
        else:
            print(f"⚠️ {index}/{total}: Failed or skipped")
    
    # Return result and success status for summary counting
    return result, result is not None


def _collect_urls(query, max_sites, verbose):
    """DuckDuckGo search - no API key required"""
    if verbose:
        print(f"🦆 DuckDuckGo Search: {query}")
    
    urls = []
    search_limit = max_sites * 8
    
    try:
        # DuckDuckGo instant answer API
        search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        response = requests.get(search_url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Extract URLs from DuckDuckGo results
        for link in soup.find_all('a', class_='result__a'):
            href = link.get('href')
            if href and href.startswith('http'):
                urls.append(href)
                if len(urls) >= search_limit:
                    break
                    
    except Exception as e:
        if verbose:
            print(f"⚠️ DuckDuckGo error: {e}")
    
    return urls


def _scrape_content_parallel(urls, max_sites, content_char_limit, verbose, detailed_logging):
    """2. Parallel Scraping - use ThreadPoolExecutor for speed"""
    if verbose:
        print(f"📄 Scraping {max_sites} URLs in parallel...")
    
    parsed_scrape_list = []
    urls_to_scrape = urls[:max_sites * 2]  # Limit attempts
    
    # Counters for summary
    successful_count = 0
    failed_count = 0
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        # Submit all scraping tasks with logging info
        futures = [
            executor.submit(_scrape_with_logging, url, content_char_limit, i+1, len(urls_to_scrape), verbose, detailed_logging)
            for i, url in enumerate(urls_to_scrape)
        ]
        
        # Collect successful results until we have enough
        for future in futures:
            result, success = future.result()
            
            if success:
                successful_count += 1
                if len(parsed_scrape_list) < max_sites:
                    parsed_scrape_list.append(result)
            else:
                failed_count += 1
                
            if len(parsed_scrape_list) >= max_sites:
                break
    
    # Print summary if not using detailed logging
    if verbose and not detailed_logging:
        total_attempted = successful_count + failed_count
        print(f"📊 Scraping summary: {successful_count} successful, {failed_count} failed/skipped out of {total_attempted} attempts")
    
    return parsed_scrape_list


def _combine_content(query, parsed_scrape_list, raw_content_limit):
    """3. Content Combination - merge all scraped content"""
    merged_scrape_text = f"Research about: {query}\n\n"
    for i, item in enumerate(parsed_scrape_list, 1):
        merged_scrape_text += f"{i}. {item['title']}\n{item['content'][:500]}\n\n"
    return merged_scrape_text[:raw_content_limit]


def _build_analysis_prompt(query, merged_scrape_text):
    return f"""You are a technical material database API. Extract information about '{query}' from the research data and return it in this exact JSON format:

{{
  "entity_name": "string",
  "mechanical_properties": ["array of strings"],
  "material_types": ["array of strings"],
  "chemical_elements": ["array of strings"],
  "industries": ["array of strings"],
  "applications": ["array of strings"],
  "key_properties": ["array of strings"],
  "alternative_names": ["array of strings"],
  "notes": ["array of strings"]
}}

RESEARCH DATA:
{merged_scrape_text}

Return only the JSON object with all fields populated. Use empty arrays [] for missing data."""

def _analyze_with_llm(query, merged_scrape_text, groq_api_key, schema):
    """4. LLM Analysis - validate schema and get structured chat_completion"""
    if schema is None:
        raise ValueError("Schema parameter is required. Please provide a valid schema dictionary.")

    groq = Groq(api_key=groq_api_key)
    chat_completion = groq.chat.completions.create(
        messages=[{"role": "user", "content": _build_analysis_prompt(query, merged_scrape_text)}],
        model="meta-llama/llama-4-maverick-17b-128e-instruct",
        temperature=0.2,
        max_tokens=1200,
        response_format={"type": "json_object"}
    )
    
    # Parse chat_completion - will raise JSONDecodeError if invalid
    return json.loads(chat_completion.choices[0].message.content)


def _assemble_result(llm_output_structured_profile, query, parsed_scrape_list, processing_time):
    """5. Result Assembly - add metadata and return"""
    llm_output_structured_profile['_metadata'] = {
        'query': query,
        'sources_count': len(parsed_scrape_list),
        'processing_time': processing_time,
        'sources': [{'title': item['title'], 'url': item['url']} for item in parsed_scrape_list]
    }
    return llm_output_structured_profile


def web_generate_entity_profile(query, groq_api_key, max_sites=4, schema=None, 
                  content_char_limit=800, raw_content_limit=5000, verbose=False, detailed_logging=False):
    """
    Research a topic and return structured data
    
    Args:
        query (str): Search query
        groq_api_key (str): Groq API key
        max_sites (int): Maximum number of sites to scrape
        schema (dict): Optional custom schema for LLM chat_completion
        content_char_limit (int): Character limit for scraped content
        raw_content_limit (int): Character limit for raw content processing
        verbose (bool): Print progress messages
        detailed_logging (bool): If True, print each individual scraping result (old behavior).
                                If False, print summary at the end (new default behavior).
        
    Returns:
        dict: Structured research results
        
    Raises:
        ValueError: If schema is not provided
        json.JSONDecodeError: If LLM chat_completion cannot be parsed as JSON
        Exception: For other processing errors
    """
    start_time = time.time()

    ''' 1 '''
    urls = _collect_urls(query, max_sites, verbose)
    
    ''' 2 '''
    parsed_scrape_list = _scrape_content_parallel(urls, max_sites, content_char_limit, verbose, detailed_logging)
    pprint(parsed_scrape_list)
    if verbose:
        print(f"⏱️  Scraped in {time.time() - start_time:.1f}s")
    if not parsed_scrape_list:
        raise Exception("No content found during web scraping")
    
    ''' 3 '''
    merged_scrape_text = _combine_content(query, parsed_scrape_list, raw_content_limit)
    if verbose:
        print(f"🤖 Summarizing {len(parsed_scrape_list)} sources...")
    
    ''' 4 '''
    llm_output_structured_profile = _analyze_with_llm(query, merged_scrape_text, groq_api_key, schema)
    
    ''' 5 '''
    return _assemble_result(llm_output_structured_profile, query, parsed_scrape_list, time.time() - start_time)