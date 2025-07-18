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
        
        if len(text) < 200 or len(text) > 10000:
            return None
        
        title = soup.find('title')
        title = title.get_text().strip()[:100] if title else url.split('/')[-1]
        
        return {'title': title, 'content': text[:char_limit], 'url': url}
    except:
        return None


def web_generate_entity_profile(query, groq_api_key, max_sites=4, schema=None, 
                  content_char_limit=800, raw_content_limit=5000, verbose=False):
    """Research a topic and return structured data"""
    start_time = time.time()
    time.sleep(1)  # Rate limiting prevention
    
    if schema is None:
        raise ValueError("Schema parameter is required")
    
    # Search DuckDuckGo
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    search_engine_used = "DuckDuckGo"
    
    try:
        search_response = requests.get(search_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }, timeout=10)
        
        # Handle 202 status (rate limiting)
        if search_response.status_code == 202:
            time.sleep(2)
            search_response = requests.get(search_url, headers={
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }, timeout=15)
        
        if search_response.status_code not in [200, 202]:
            raise Exception(f"Search failed with status {search_response.status_code}")
            
    except Exception as e:
        raise Exception(f"Search request failed: {str(e)}")
    
    # Parse search results
    search_soup = BeautifulSoup(search_response.content, 'html.parser')
    all_links = search_soup.find_all('a', class_='result__a')
    urls = [link.get('href') for link in all_links 
            if link.get('href') and link.get('href').startswith('http')]
    
    # Fallback to Bing if no results
    if not urls:
        search_engine_used = "Bing"
        try:
            bing_response = requests.get(f"https://www.bing.com/search?q={quote_plus(query)}", 
                                       headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}, 
                                       timeout=10)
            if bing_response.status_code == 200:
                bing_soup = BeautifulSoup(bing_response.content, 'html.parser')
                bing_links = bing_soup.find_all('a', href=True)
                urls = [link.get('href') for link in bing_links 
                       if link.get('href') and link.get('href').startswith('http') 
                       and 'bing.com' not in link.get('href')][:max_sites * 4]
        except:
            pass
    
    if not urls:
        raise Exception("No URLs found in search results")
    
    # Scrape URLs in parallel
    urls_to_try = urls[:max_sites * 2]
    scraped_content = []
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(scrape_url, url, content_char_limit) for url in urls_to_try]
        
        for future in futures:
            result = future.result()
            if result:
                scraped_content.append(result)
                if len(scraped_content) >= max_sites:
                    break
    
    if not scraped_content:
        raise Exception("No content found during web scraping")
    
    # Combine content for LLM
    combined_text = f"Research about: {query}\n\n" + "\n\n".join(
        [f"{i}. {item['title']}\n{item['content'][:500]}" for i, item in enumerate(scraped_content, 1)]
    )[:raw_content_limit]
    
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
    
    # Enhanced metadata
    processing_time = time.time() - start_time
    total_content_chars = sum(len(item['content']) for item in scraped_content)
    success_rate = len(scraped_content) / len(urls_to_try) * 100
    
    result['_metadata'] = {
        'query': query,
        'search_engine': search_engine_used,
        'sources_count': len(scraped_content),
        'urls_attempted': len(urls_to_try),
        'success_rate_percent': round(success_rate, 1),
        'processing_time_seconds': round(processing_time, 2),
        'total_content_chars': total_content_chars,
        'avg_content_per_source': round(total_content_chars / len(scraped_content)),
        'sources': [{'title': item['title'], 'url': item['url']} for item in scraped_content]
    }
    
    if verbose:
        print(f"🎉 SUCCESS! Generated profile with {len(result)-1} fields | "
              f"{len(scraped_content)} sources ({success_rate:.1f}% success) | "
              f"{search_engine_used} | {processing_time:.1f}s | "
              f"{total_content_chars:,} chars processed")
    
    return result