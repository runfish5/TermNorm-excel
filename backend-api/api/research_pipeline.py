"""
Research Pipeline API - Session-based term matching
"""
import json
import logging
import time
import re
from pathlib import Path
from pprint import pprint
from datetime import datetime
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


def _prioritize_errors(record):
    """Check for errors in training record and move to first position if detected"""

    def _find_and_extract_error(obj, path=[]):
        """Recursively find error dict in nested structure"""
        if isinstance(obj, dict):
            # Check if this dict contains an 'error' key
            if "error" in obj:
                return obj, path
            # Recurse into nested dicts
            for key, value in obj.items():
                result, error_path = _find_and_extract_error(value, path + [key])
                if result:
                    return result, error_path
        return None, []

    # Search for error in record
    error_info, error_path = _find_and_extract_error(record)

    if error_info:
        # Navigate to parent and pop the error
        parent = record
        for key in error_path[:-1]:
            parent = parent[key]
        parent.pop(error_path[-1])

        # Merge with error_info first, then rest of record
        return {**error_info, **record}

    return record


class TokenLookupMatcher:
    """Token-based matcher for candidate filtering"""

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


# Session storage - stores terms array and usage stats per user
# Structure: {user_id: {"terms": [...], "init_time": datetime, "query_count": int, "targets_used": {}}}
user_sessions = {}


@router.post("/session/init-terms")
async def init_terms(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Initialize user session with terms array and tracking"""
    user_id = request.state.user_id
    terms = payload.get("terms", [])

    if not terms:
        raise HTTPException(
            status_code=400,
            detail="No terms provided - include terms array in request payload"
        )

    # Store terms in session with usage tracking
    user_sessions[user_id] = {
        "terms": terms,
        "init_time": datetime.utcnow(),
        "query_count": 0,
        "targets_used": {}  # target → count
    }

    logger.info(f"[SESSION] User {user_id}: Initialized session with {len(terms)} terms")

    return success_response(
        message=f"Session initialized with {len(terms)} terms",
        data={"term_count": len(terms)}
    )


@router.post("/research-and-match")
async def research_and_match(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Research a query and rank candidates using LLM + token matching (session-based)"""
    user_id = request.state.user_id
    query = payload.get("query", "")

    # Retrieve terms from session
    if user_id not in user_sessions:
        raise HTTPException(
            status_code=400,
            detail="No session found - initialize session first with POST /session/init-terms"
        )

    terms = user_sessions[user_id]["terms"]
    logger.info(f"[PIPELINE] User {user_id}: Started for query: '{query}' with {len(terms)} terms from session")
    start_time = time.time()

    # Create token matcher from session terms
    token_matcher = TokenLookupMatcher(terms)
    logger.info(f"[PIPELINE] TokenLookupMatcher created with {len(token_matcher.deduplicated_terms)} unique terms")

    # Step 1: Research (always returns tuple)
    logger.info("[PIPELINE] Step 1: Researching")
    entity_profile, profile_debug = await web_generate_entity_profile(
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

    # Step 3: LLM ranking (always returns tuple)
    logger.info(CYAN + "\n[PIPELINE] Step 3: Ranking with LLM" + RESET)
    profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
    llm_response, ranking_debug = await call_llm_for_ranking(
        profile_info, entity_profile, candidate_results, query
    )

    total_time = round(time.time() - start_time, 2)

    # Save training record
    from datetime import datetime
    from core.llm_providers import LLM_PROVIDER, LLM_MODEL

    # Get top ranked candidate and prepare flattened structure
    ranked_candidates = llm_response.get('ranked_candidates', [])
    target = ranked_candidates[0].get('candidate') if ranked_candidates else "No matches found"
    confidence = ranked_candidates[0].get('relevance_score', 0) if ranked_candidates else 0

    # Check web search status
    scraped_sources = profile_debug["inputs"]["scraped_sources"]
    web_search_failed = isinstance(scraped_sources, dict) and "error" in scraped_sources

    # Flattened training record - top-level fields for easy queries
    training_record = {
        # Core identification
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "session_id": user_id,
        "source": query,
        "target": target,
        "method": "ProfileRank",
        "confidence": confidence,

        # Flattened candidates (no nesting)
        "candidates": [
            {
                "rank": i,
                "name": c.get('candidate'),
                "score": c.get('relevance_score'),
                "core_score": c.get('core_concept_score'),
                "spec_score": c.get('spec_score'),
            }
            for i, c in enumerate(ranked_candidates)
        ] if ranked_candidates else [],

        # Entity profile (top-level)
        "entity_profile": entity_profile,

        # Metadata
        "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "total_time": total_time,
        "web_search_status": "failed" if web_search_failed else "success",

        # Debug info (flattened from nested stages)
        "token_matches": ranking_debug["inputs"]["token_matched_candidates"] if ranking_debug else [],
        "web_sources": scraped_sources.get("sources_fetched", []) if not web_search_failed else [],
    }

    # Check for errors and move to first position if detected
    training_record = _prioritize_errors(training_record)

    # Write to activity.jsonl
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(training_record) + "\n")

    logger.info(f"[PIPELINE] Training record saved: {query} → {target}")

    # Update session usage stats automatically
    if user_id in user_sessions:
        user_sessions[user_id]["query_count"] += 1
        targets = user_sessions[user_id]["targets_used"]
        targets[target] = targets.get(target, 0) + 1

    # Build standardized response (web_search_failed already calculated above)
    num_candidates = len(llm_response.get('ranked_candidates', []))
    result = success_response(
        message=f"Research completed - Found {num_candidates} matches in {total_time}s",
        data={
            "ranked_candidates": llm_response.get('ranked_candidates', []),
            "llm_provider": llm_response.get('llm_provider'),
            "total_time": total_time,
            "web_search_status": "failed" if web_search_failed else "success",
            "web_search_error": scraped_sources.get("error") if web_search_failed else None
        }
    )

    logger.info(YELLOW)
    logger.info(json.dumps(result, indent=2))
    logger.info(RESET)
    return result