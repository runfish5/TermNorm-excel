"""
Matcher Setup API - /update-matcher endpoint with embedded TokenLookupMatcher
"""
import re
import logging
import time
from collections import defaultdict
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()


class TokenLookupMatcher:
    """Token-based matcher for term lookup"""

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
                score = shared_token_count / len(term_tokens)
                scores.append((self.deduplicated_terms[i], score))

        return sorted(scores, key=lambda x: x[1], reverse=True)

    def append_terms(self, new_terms: List[str]):
        """Add new terms to existing matcher"""
        if not new_terms:
            return

        # Add to datasets
        self.complete_term_dataset.extend(new_terms)

        # Add unique terms and update index
        for term in new_terms:
            if term not in self.deduplicated_terms:
                self.deduplicated_terms.append(term)
                # Update index for this new term
                term_index = len(self.deduplicated_terms) - 1
                for token in self._tokenize(term):
                    self.token_term_lookup[token].add(term_index)


# Global matcher instance (singleton pattern)
_token_matcher: TokenLookupMatcher = None


def get_token_matcher() -> TokenLookupMatcher:
    """Get the global token matcher instance"""
    global _token_matcher
    return _token_matcher


@router.post("/update-matcher")
async def update_matcher(request: Dict[str, List[str]]) -> Dict[str, Any]:
    """Smart endpoint that creates new matcher or appends to existing one"""
    global _token_matcher
    start = time.time()

    terms = request.get("terms", [])
    logger.info(f"Updating matcher with {len(terms)} terms")

    if _token_matcher is None:
        # Create new matcher
        _token_matcher = TokenLookupMatcher(terms)
        setup_time = time.time() - start
        logger.info(f"TokenLookupMatcher setup complete in {setup_time:.2f} seconds")

        return {
            "status": "matcher_setup_complete",
            "setup_time": setup_time,
            "total_terms": len(_token_matcher.complete_term_dataset),
            "unique_terms": len(_token_matcher.deduplicated_terms),
            "duplicates_removed": len(_token_matcher.complete_term_dataset) - len(_token_matcher.deduplicated_terms)
        }
    else:
        # Append to existing matcher
        _token_matcher.append_terms(terms)
        append_time = time.time() - start
        return {
            "status": "terms_appended",
            "append_time": append_time,
            "total_unique_terms": len(_token_matcher.deduplicated_terms)
        }