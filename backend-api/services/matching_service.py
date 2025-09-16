"""
Term matching service - contains business logic for token matching
"""
import re
import logging
import time
from collections import defaultdict
from typing import List
from fastapi import HTTPException

# Using simple dictionaries instead of Pydantic models

logger = logging.getLogger(__name__)


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


class MatchingService:
    """Service for term matching operations"""

    def __init__(self):
        # Instead of global state, we'll store the matcher in the service
        self.token_matcher: TokenLookupMatcher = None

    async def update_matcher(self, request: dict) -> dict:
        """Smart endpoint that creates new matcher or appends to existing one"""
        start = time.time()

        terms = request.get("terms", [])

        if self.token_matcher is None:
            # Create new matcher
            self.token_matcher = TokenLookupMatcher(terms)
            setup_time = time.time() - start
            logger.info(f"TokenLookupMatcher setup complete in {setup_time:.2f} seconds")

            return {
                "status": "matcher_setup_complete",
                "setup_time": setup_time,
                "total_terms": len(self.token_matcher.complete_term_dataset),
                "unique_terms": len(self.token_matcher.deduplicated_terms),
                "duplicates_removed": len(self.token_matcher.complete_term_dataset) - len(self.token_matcher.deduplicated_terms)
            }
        else:
            # Append to existing matcher
            self.token_matcher.append_terms(terms)
            append_time = time.time() - start
            return {
                "status": "terms_appended",
                "append_time": append_time,
                "total_unique_terms": len(self.token_matcher.deduplicated_terms)
            }

    async def match_term(self, request: dict) -> dict:
        """Simple token-based matching without web research"""

        if self.token_matcher is None:
            logger.error("MISSING MAPPING INDEXES: TokenLookupMatcher not initialized")
            logger.error("Server restart detected. Configuration reload required.")
            raise HTTPException(
                status_code=503,
                detail="Server restart detected - mapping indexes lost. Please reload your configuration files to restore mapping data."
            )

        query = request.get("query", "")
        logger.info(f"[MATCH-TERM] Query: '{query}'")

        try:
            # Simple token matching only
            start_time = time.time()
            results = self.token_matcher.match(query)
            match_time = time.time() - start_time

            logger.info(f"[MATCH-TERM] Found {len(results)} matches in {match_time:.3f}s")

            if results:
                logger.info("[MATCH-TERM] Top 3 matches:")
                for i, (candidate, score) in enumerate(results[:3]):
                    logger.info(f"[MATCH-TERM]   {i+1}. '{candidate}' (score: {score:.3f})")

            return {
                "query": query,
                "matches": results,
                "total_matches": len(results),
                "match_time": match_time,
                "research_performed": False
            }

        except Exception as e:
            logger.error(f"Exception in match_term: {e}")
            raise HTTPException(status_code=500, detail=f"Matching failed: {str(e)}")


# Global service instance (singleton pattern)
# This replaces the global token_matcher variable
_matching_service_instance = None


def get_matching_service() -> MatchingService:
    """Get or create the global matching service instance"""
    global _matching_service_instance
    if _matching_service_instance is None:
        _matching_service_instance = MatchingService()
    return _matching_service_instance