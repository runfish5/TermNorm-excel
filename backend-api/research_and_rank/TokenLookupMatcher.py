import re
from collections import defaultdict
from pydantic import BaseModel
from typing import List
from fastapi import APIRouter
import time

# Global matcher instance
token_matcher = None

class TokenLookupMatcher:
    def __init__(self, terms: List[str]):
        # Build index from provided terms
        self.complete_term_dataset = terms  # Before unique
        self.deduplicated_terms = list(set(terms))  # After unique
        self.token_term_lookup = self._build_index()

    def _tokenize(self, text):
        return set(re.findall(r'[a-zA-Z0-9]+', str(text).lower()))

    def _build_index(self):
        index = defaultdict(set)
        for i, term in enumerate(self.deduplicated_terms):
            for token in self._tokenize(term):
                index[token].add(i)
        return index

    def match(self, query):
        query_tokens = self._tokenize(query)
        if not query_tokens:
            return []

        # Find candidates
        candidates = set()
        for token in query_tokens:
            candidates.update(self.token_term_lookup.get(token, set()))

        # Score candidates
        scores = []
        for i in candidates:
            term_tokens = self._tokenize(self.deduplicated_terms[i])
            shared_token_count = len(query_tokens & term_tokens)
            if shared_token_count > 0:
                score = shared_token_count / max(len(query_tokens), len(term_tokens))
                scores.append((self.deduplicated_terms[i], score))

        return sorted(scores, key=lambda x: x[1], reverse=True)

class SetupMatcherRequest(BaseModel):
    terms: List[str]

class MatchRequest(BaseModel):
    query: str

# Create router
router = APIRouter()

@router.post("/setup-matcher")
async def setup_matcher(request: SetupMatcherRequest):
    """Setup the TokenLookupMatcher with a list of terms"""
    global token_matcher
    start = time.time()
    token_matcher = TokenLookupMatcher(request.terms)
    setup_time = time.time() - start
    print(f"[DEBUG] TokenLookupMatcher setup complete in {setup_time:.2f} seconds")
    return {
        "status": "matcher_setup_complete",
        "setup_time": setup_time,
        "total_terms": len(token_matcher.complete_term_dataset),
        "unique_terms": len(token_matcher.deduplicated_terms),
        "duplicates_removed": len(token_matcher.complete_term_dataset) - len(token_matcher.deduplicated_terms)
    }

@router.post("/match-term")
async def match_term(request: MatchRequest):
    """Simple token-based matching without web research"""
    
    if token_matcher is None:
        print(f"[DEBUG] token_matcher is None - matcher not initialized")
        return {"error": "Matcher not initialized. Call /setup-matcher first."}
    
    print(f"[MATCH-TERM] Query: '{request.query}'")
    
    try:
        # Simple token matching only
        start_time = time.time()
        results = token_matcher.match(request.query)
        match_time = time.time() - start_time
        
        print(f"[MATCH-TERM] Found {len(results)} matches in {match_time:.3f}s")
        
        if results:
            print(f"[MATCH-TERM] Top 3 matches:")
            for i, (candidate, score) in enumerate(results[:3]):
                print(f"[MATCH-TERM]   {i+1}. '{candidate}' (score: {score:.3f})")
        
        return {
            "query": request.query,
            "matches": results,  # Already in [[candidate, score], ...] format
            "total_matches": len(results),
            "match_time": match_time,
            "research_performed": False
        }
        
    except Exception as e:
        print(f"[DEBUG] Exception in match_term: {e}")
        return {"error": f"Matching failed: {str(e)}"}

@router.post("/quick-match")
async def quick_match(request: MatchRequest):
    """Alias for match-term for backward compatibility"""
    return await match_term(request)