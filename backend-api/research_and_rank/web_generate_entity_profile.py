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
            if items_type == 'string':
                format_items.append(f'  "{prop_name}": ["array of strings"]')
            else:
                format_items.append(f'  "{prop_name}": ["array of {items_type}s"]')
        elif prop_type == 'object':
            format_items.append(f'  "{prop_name}": {{"object"}}')
        elif prop_type == 'number' or prop_type == 'integer':
            format_items.append(f'  "{prop_name}": {prop_type}')
        elif prop_type == 'boolean':
            format_items.append(f'  "{prop_name}": true/false')
        else:
            format_items.append(f'  "{prop_name}": "{prop_type}"')
    
    return "{\n" + ",\n".join(format_items) + "\n}"

def quick_scrape(url, content_char_limit=800):
    """Fast content extraction with aggressive timeouts"""
    try:
        response = requests.get(url, timeout=5, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        if response.status_code != 200:
            return None
        
        soup = BeautifulSoup(response.content[:50000], 'html.parser')
        for tag in soup(['script', 'style', 'nav', 'header', 'footer']):
            tag.decompose()
        
        text = soup.get_text()
        text = re.sub(r'\s+', ' ', text).strip()
        if len(text) < 200 or len(text) > 20000:
            return None
            
        title = soup.find('title')
        title = title.get_text().strip()[:100] if title else url.split('/')[-1]
        return {'title': title, 'content': text[:content_char_limit], 'url': url}
    except:
        return None

def search_and_scrape(query, max_sites, content_char_limit, verbose, detailed_logging):
    """Step 1: Search for URLs and scrape them in parallel"""
    if verbose:
        print(f"🦆 DuckDuckGo Search: {query}")
    
    # Get URLs
    urls = []
    search_limit = max_sites * 8
    try:
        search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(search_url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        for link in soup.find_all('a', class_='result__a'):
            href = link.get('href')
            if href and href.startswith('http'):
                urls.append(href)
                if len(urls) >= search_limit:
                    break
    except Exception as e:
        if verbose:
            print(f"⚠️ DuckDuckGo error: {e}")
    
    # Scrape URLs in parallel
    if verbose:
        print(f"📄 Scraping {max_sites} URLs in parallel...")
    
    parsed_scrape_list = []
    urls_to_scrape = urls[:max_sites * 2]
    successful_count = failed_count = 0
    
    def scrape_with_logging(url, index):
        result = quick_scrape(url, content_char_limit)
        if verbose and detailed_logging:
            if result:
                print(f"✅ {index}: {result['title'][:40]}...")
            else:
                print(f"⚠️ {index}: Failed or skipped")
        return result, result is not None
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(scrape_with_logging, url, i+1) for i, url in enumerate(urls_to_scrape)]
        
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
    
    if verbose and not detailed_logging:
        total_attempted = successful_count + failed_count
        print(f"📊 Scraping summary: {successful_count} successful, {failed_count} failed/skipped out of {total_attempted} attempts")
    
    return parsed_scrape_list

def analyze_content(query, parsed_scrape_list, groq_api_key, schema, raw_content_limit, verbose):
    """Step 2: Combine content and analyze with LLM"""
    if schema is None:
        raise ValueError("Schema parameter is required. Please provide a valid schema dictionary.")
    
    # Combine all scraped content
    merged_scrape_text = f"Research about: {query}\n\n"
    for i, item in enumerate(parsed_scrape_list, 1):
        merged_scrape_text += f"{i}. {item['title']}\n{item['content'][:500]}\n\n"
    merged_scrape_text = merged_scrape_text[:raw_content_limit]
    
    if verbose:
        print(f"🤖 Summarizing {len(parsed_scrape_list)} sources...")
    
    # Build prompt and call LLM
    format_string = generate_format_string_from_schema(schema)
    prompt = f"""You are a technical material database API. Extract information about '{query}' from the research data and return it in this exact JSON format:
{format_string}
RESEARCH DATA:
{merged_scrape_text}
Return only the JSON object with all fields populated. Use empty arrays [] for missing data."""
    
    groq = Groq(api_key=groq_api_key)
    chat_completion = groq.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="meta-llama/llama-4-maverick-17b-128e-instruct",
        temperature=0.2,
        max_tokens=1200,
        response_format={"type": "json_object"}
    )
    
    return json.loads(chat_completion.choices[0].message.content)

def web_generate_entity_profile(query, groq_api_key, max_sites=4, schema=None, 
                  content_char_limit=800, raw_content_limit=5000, verbose=False, detailed_logging=False):
    """Research a topic and return structured data - simplified 2-step workflow"""
    start_time = time.time()
    
    # Step 1: Search and scrape
    parsed_scrape_list = search_and_scrape(query, max_sites, content_char_limit, verbose, detailed_logging)
    
    if verbose:
        print(f"⏱️  Scraped in {time.time() - start_time:.1f}s")
    if not parsed_scrape_list:
        raise Exception("No content found during web scraping")
    
    # Step 2: Analyze with LLM
    llm_output = analyze_content(query, parsed_scrape_list, groq_api_key, schema, raw_content_limit, verbose)
    
    # Add metadata and return
    llm_output['_metadata'] = {
        'query': query,
        'sources_count': len(parsed_scrape_list),
        'processing_time': time.time() - start_time,
        'sources': [{'title': item['title'], 'url': item['url']} for item in parsed_scrape_list]
    }
    
    return llm_output