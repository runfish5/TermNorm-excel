from difflib import SequenceMatcher


def find_top_matches(llm_string, candidates, n=10):
    """Find top N matching candidates using fuzzy matching.

    Args:
        llm_string: The LLM output string to match
        candidates: List of valid candidate strings
        n: Number of top matches to return (default: 10)

    Returns:
        List of (candidate, similarity_ratio) tuples, sorted by ratio descending
    """
    if not llm_string or not candidates:
        return []

    scores = []
    llm_lower = llm_string.lower()

    for candidate in candidates:
        ratio = SequenceMatcher(None, llm_lower, candidate.lower()).ratio()
        scores.append((candidate, ratio))

    # Sort by similarity descending, return top N
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:n]


def correct_candidate_strings(ranking_result, match_results):
    """
    Corrects LLM-altered candidate strings by finding best matches from original results.
    
    Args:
        ranking_result: The output from call_llm_for_ranking containing ranked_candidates
        match_results: List of tuples [(candidate_string, score), ...] from rank_terms_by_shared_tokens()
    
    Returns:
        Updated ranking_result with corrected candidate strings
    """
    # Extract just the candidate strings from match results for faster lookup
    original_candidates = [result[0] for result in match_results]
    
    def find_best_match(llm_string, candidates):
        """Find the best matching candidate string using fuzzy matching"""
        best_match = None
        best_ratio = 0
        
        for candidate in candidates:
            # Calculate similarity ratio
            ratio = SequenceMatcher(None, llm_string.lower(), candidate.lower()).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_match = candidate
        
        return best_match, best_ratio
    
    # Process each ranked candidate
    corrected_candidates = []
    
    for candidate_info in ranking_result['ranked_candidates']:
        llm_candidate = candidate_info['candidate']
        
        # Find best match from original results
        best_match, similarity = find_best_match(llm_candidate, original_candidates)
        
        # Create corrected candidate info
        corrected_info = candidate_info.copy()
        
        # Store original LLM string if it's different from the match
        if best_match != llm_candidate:
            corrected_info['_original_llm_string'] = llm_candidate
            corrected_info['candidate'] = best_match
            corrected_info['_correction_confidence'] = similarity
        else:
            corrected_info['_correction_confidence'] = 1.0

        # Calculate relevance_score from existing scores (70% core concept + 30% spec)
        core_score = corrected_info.get('core_concept_score', 0.0)
        spec_score = corrected_info.get('spec_score', 0.0)
        corrected_info['relevance_score'] = (core_score * 0.7 + spec_score * 0.3)

        corrected_candidates.append(corrected_info)
    
    # Update the ranking result
    ranking_result['ranked_candidates'] = corrected_candidates
    return ranking_result