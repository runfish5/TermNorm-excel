"""
Research Pipeline API - /research-and-match endpoint (stateless)
"""
import json
import logging
import time
import re
from pathlib import Path
from pprint import pprint
from collections import Counter, defaultdict
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Request, Body

from research_and_rank.web_generate_entity_profile import web_generate_entity_profile
from research_and_rank.display_profile import display_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking
import utils.utils as utils
from utils.utils import CYAN, MAGENTA, RED, YELLOW, RESET
from utils.responses import success_response

logger = logging.getLogger(__name__)
router = APIRouter()

# Load entity schema once at module level
_schema_path = Path(__file__).parent.parent / "research_and_rank" / "entity_profile_schema.json"
with open(_schema_path, 'r') as f:
    ENTITY_SCHEMA = json.load(f)


class TokenLookupMatcher:
    """Stateless token-based matcher (created on-the-fly per request)"""

    def __init__(self, terms: List[str]):
        self.deduplicated_terms = list(set(terms))
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


@router.post("/research-and-match")
async def research_and_match(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Research a query and rank candidates using LLM + token matching (stateless)"""
    user_id = request.state.user_id
    query = payload.get("query", "")
    terms = payload.get("terms", [])

    logger.info(f"[PIPELINE] User {user_id}: Started for query: '{query}' with {len(terms)} terms")
    start_time = time.time()

    # Validate terms provided
    if not terms:
        raise HTTPException(
            status_code=400,
            detail="No terms provided - include terms array in request payload"
        )

    # Create matcher on-the-fly (stateless)
    token_matcher = TokenLookupMatcher(terms)
    logger.info(f"[PIPELINE] Created TokenLookupMatcher with {len(token_matcher.deduplicated_terms)} unique terms")

    # Step 1: Research
    logger.info("[PIPELINE] Step 1: Researching")
    entity_profile = await web_generate_entity_profile(
        query,
        max_sites=7,
        schema=ENTITY_SCHEMA,
        verbose=True
    )
    pprint(entity_profile)

    # Step 2: Token matching
    logger.info("\n[PIPELINE] Step 2: Matching candidates")

    # Build search terms from query and entity profile
    search_terms = [word for s in [query] + utils.flatten_strings(entity_profile) for word in s.split()]
    unique_search_terms = list(set(search_terms))

    logger.info(f"Search terms: {len(search_terms)} total → {len(unique_search_terms)} unique")
    logger.info(f"Unique terms: {', '.join(unique_search_terms[:20])}{'...' if len(unique_search_terms) > 20 else ''}")

    match_start = time.time()
    candidate_results = token_matcher.match(unique_search_terms)

    logger.info(f"{RED}{chr(10).join([str(item) for item in candidate_results])}{RESET}")
    logger.info(f"Match completed in {time.time() - match_start:.2f}s")

    # Step 3: LLM ranking
    logger.info(CYAN + "\n[PIPELINE] Step 3: Ranking with LLM" + RESET)
    profile_info = display_profile(entity_profile, "RESEARCH PROFILE")

    llm_response = await call_llm_for_ranking(profile_info, entity_profile, candidate_results, query)
    total_time = round(time.time() - start_time, 2)

    # Build standardized response
    num_candidates = len(llm_response.get('ranked_candidates', []))
    result = success_response(
        message=f"Research completed - Found {num_candidates} matches in {total_time}s",
        data={
            "ranked_candidates": llm_response.get('ranked_candidates', []),
            "llm_provider": llm_response.get('llm_provider'),
            "total_time": total_time
        }
    )

    logger.info(YELLOW)
    logger.info(json.dumps(result, indent=2))
    logger.info(RESET)
    return result