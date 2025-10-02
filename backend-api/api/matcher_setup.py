"""
Matcher Setup API - /update-matcher endpoint with embedded TokenLookupMatcher
"""
import re
import logging
import time
from collections import defaultdict
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Request, Body

from core.user_manager import get_session, create_session

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


def get_token_matcher(user_id: str) -> TokenLookupMatcher:
    """Get user's token matcher instance"""
    session = get_session(user_id)
    return session.matcher if session else None


@router.post("/update-matcher")
async def update_matcher(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Per-user matcher management - creates or updates user's matcher"""
    user_id = request.state.user_id
    terms = payload.get("terms", [])
    force_reset = payload.get("force_reset", False)

    start = time.time()
    logger.info(f"User {user_id}: Updating matcher with {len(terms)} terms")

    # Get or create user session
    session = get_session(user_id)

    if force_reset or session is None:
        # Create new matcher
        matcher = TokenLookupMatcher(terms)
        session = create_session(user_id, matcher)
        elapsed = time.time() - start
        logger.info(f"User {user_id}: TokenLookupMatcher created in {elapsed:.2f}s")

        return {
            "status": "matcher_created",
            "setup_time": elapsed,
            "total_terms": len(matcher.complete_term_dataset),
            "unique_terms": len(matcher.deduplicated_terms),
            "duplicates_removed": len(matcher.complete_term_dataset) - len(matcher.deduplicated_terms),
            "status_message": f"✅ Matcher initialized - {len(matcher.deduplicated_terms)} unique terms loaded in {elapsed:.2f}s"
        }
    else:
        # Append to existing matcher
        session.matcher.append_terms(terms)
        elapsed = time.time() - start
        return {
            "status": "terms_appended",
            "append_time": elapsed,
            "total_unique_terms": len(session.matcher.deduplicated_terms),
            "status_message": f"✅ Terms appended - {len(session.matcher.deduplicated_terms)} total unique terms"
        }