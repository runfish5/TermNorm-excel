import json
import time
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote_plus
from groq import Groq
import re


def scrape_url(url, char_limit):
    """Fast content extraction with aggressive timeouts and filtering"""
    # Skip problematic URLs
    skip_extensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']
    skip_domains = ['academia.edu', 'researchgate.net', 'arxiv.org', 'ieee.org']
    
    url_lower = url.lower()
    if any(ext in url_lower for ext in skip_extensions) or any(domain in url_lower for domain in skip_domains):
        return None
    
    try:
        response = requests.get(url, timeout=5, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        if response.status_code != 200:
            return None
        
        soup = BeautifulSoup(response.content[:50000], 'html.parser')
        for tag in soup(['script', 'style', 'nav', 'header', 'footer']):
            tag.decompose()
        
        text = re.sub(r'\s+', ' ', soup.get_text().strip())
        
        # Better content validation (200-10000 range works better)
        if len(text) < 200 or len(text) > 10000:
            return None
        
        title = soup.find('title')
        title = title.get_text().strip()[:100] if title else url.split('/')[-1]
        
        return {'title': title, 'content': text[:char_limit], 'url': url}
    except:
        return None


def web_generate_entity_profile(query, groq_api_key, max_sites=4, schema=None, 
                  content_char_limit=800, raw_content_limit=5000, verbose=False, detailed_logging=False):
    """Research a topic and return structured data - simplified 2-step workflow"""
    start_time = time.time()
    
    if schema is None:
        raise ValueError("Schema parameter is required. Please provide a valid schema dictionary.")
    
    if verbose:
        print(f"🦆 DuckDuckGo Search: {query}")
    
    # Search DuckDuckGo - get more URLs for better success rate
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    search_response = requests.get(search_url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }, timeout=10)
    search_soup = BeautifulSoup(search_response.content, 'html.parser')
    urls = [link.get('href') for link in search_soup.find_all('a', class_='result__a') 
            if link.get('href') and link.get('href').startswith('http')][:max_sites * 8]
    
    if verbose:
        print(f"📄 Scraping {max_sites} URLs in parallel...")
    
    # Scrape URLs in parallel with better error handling
    scraped_content = []
    urls_to_try = urls[:max_sites * 2]  # Try more URLs than we need
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(scrape_url, url, content_char_limit) for url in urls_to_try]
        
        for future in futures:
            result = future.result()
            if result:
                scraped_content.append(result)
                if len(scraped_content) >= max_sites:
                    break
    
    if verbose:
        print(f"⏱️  Scraped in {time.time() - start_time:.1f}s")
    
    if not scraped_content:
        raise Exception("No content found during web scraping")
    
    # Combine content and analyze with LLM
    combined_text = f"Research about: {query}\n\n" + "\n\n".join(
        [f"{i}. {item['title']}\n{item['content'][:500]}" for i, item in enumerate(scraped_content, 1)]
    )[:raw_content_limit]
    
    if verbose:
        print(f"🤖 Summarizing {len(scraped_content)} sources...")
    
    # Create JSON format from schema
    format_string = "{\n" + ",\n".join([
        f'  "{name}": []' if props.get('type') == 'array' else f'  "{name}": ""' 
        for name, props in schema['properties'].items()
    ]) + "\n}"
    
    # Call LLM
    groq = Groq(api_key=groq_api_key)
    response = groq.chat.completions.create(
        messages=[{"role": "user", "content": f"""You are a technical material database API. Extract information about '{query}' from the research data and return it in this exact JSON format:
{format_string}

RESEARCH DATA:
{combined_text}

Return only the JSON object with all fields populated. Use empty arrays [] for missing data."""}],
        model="meta-llama/llama-4-maverick-17b-128e-instruct",
        temperature=0.2,
        max_tokens=1200,
        response_format={"type": "json_object"}
    )
    
    result = json.loads(response.choices[0].message.content)
    result['_metadata'] = {
        'query': query,
        'sources_count': len(scraped_content),
        'processing_time': time.time() - start_time,
        'sources': [{'title': item['title'], 'url': item['url']} for item in scraped_content]
    }
    
    return result