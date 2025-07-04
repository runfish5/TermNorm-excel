import json
from pathlib import Path
from .web_generate_entity_profile import web_generate_entity_profile
from .display_profile import display_profile
from .call_llm_for_ranking import call_llm_for_ranking
from .correct_candidate_strings import correct_candidate_strings
import time
from pprint import pprint

# Load entity schema
schema_path = Path(__file__).parent / "entity_profile_schema.json"
with open(schema_path, 'r') as f:
    entity_schema = json.load(f)

def rank_terms_by_shared_tokens(matcher, query):
    """Helper function for matching"""
    start = time.time()
    results = matcher.match(query)  # Returns ALL matches
    match_time = time.time() - start
    return results, match_time

def research_and_rank_candidates(query, matcher, groq_api_key, verbose=False):
    """
    Main function: research topic, match candidates, get LLM ranking with string correction
    """
    # 1. Research
    entity_profile = web_generate_entity_profile(
        query, 
        groq_api_key, 
        max_sites=6, 
        schema=entity_schema,
        content_char_limit=801,
        raw_content_limit=5000,
        verbose=verbose
    )
    
    # 2. Match
    results, match_time = rank_terms_by_shared_tokens(matcher, query)
    
    # 3. Format for LLM using display_profile
    profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
    
    # 4. Get ranking
    ranking_result = call_llm_for_ranking(profile_info, results, query, groq_api_key)
    # 5. Correct candidate strings
    corrected_result = correct_candidate_strings(ranking_result, results)
    print("ACTUALLY I SUCCEEDED AT M JOBS")
    # pprint(corrected_result)
    return corrected_result
