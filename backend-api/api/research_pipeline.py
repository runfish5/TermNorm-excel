"""
Research Pipeline API - Session-based term matching
"""
import json
import logging
import time
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Request, Body

from research_and_rank.web_generate_entity_profile import web_generate_entity_profile
from research_and_rank.display_profile import display_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking
from research_and_rank.correct_candidate_strings import find_top_matches
from research_and_rank.fuzzy_matching import fuzzy_match_terms
from core.llm_providers import llm_call, LLM_PROVIDER, LLM_MODEL
import utils.utils as utils
from utils.utils import CYAN, MAGENTA, RED, YELLOW, RESET
from utils.responses import success_response
from utils.cache_metadata import CacheMetadata
from utils.langfuse_logger import (
    log_batch_start, log_batch_complete, log_pipeline,
    log_cache_match, log_fuzzy_match, log_user_correction
)
from utils.schema_registry import get_schema_registry
from config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# Load entity schema from registry (versioned)
_schema_registry = get_schema_registry()
ENTITY_SCHEMA = _schema_registry.get_schema("entity_profile")  # latest version by default

# Match database - persistent index of identifiers
MATCH_DB_PATH = Path(__file__).parent.parent / "logs" / "match_database.json"
match_database: Dict[str, Any] = {}

# Cache metadata tracker - sophisticated tracking of loaded data
cache_metadata = CacheMetadata()

# Load pipeline.json defaults (single read at import time)
_PIPELINE_CONFIG_PATH = Path(__file__).parent.parent / "config" / "pipeline.json"
_pipeline_config = json.loads(_PIPELINE_CONFIG_PATH.read_text())
_node = lambda name: _pipeline_config["nodes"][name]["config"]
_pipeline = lambda name: _pipeline_config["pipelines"][name]

# Shared thresholds (from pipeline.json where available)
HIGH_CONFIDENCE_THRESHOLD = _node("token_matching")["high_confidence_threshold"]
ACCEPT_THRESHOLD = _node("token_matching")["accept_threshold"]
VERIFIED_METHODS = {"UserChoice", "DirectEdit", "cached", "fuzzy"}


def _is_alias_verified(method, confidence):
    """Check if an alias should be marked as verified (user-confirmed or high-confidence)"""
    return method in VERIFIED_METHODS or confidence >= HIGH_CONFIDENCE_THRESHOLD


def _ensure_db_entry(target, web_sources=None, timestamp=None):
    """Create a match_database entry for target if it doesn't exist. Returns the entry."""
    if target not in match_database:
        match_database[target] = {
            "entity_profile": None,
            "aliases": {},
            "web_sources": web_sources or [],
            "last_updated": timestamp,
        }
    return match_database[target]


def _update_session_usage(user_id, target=None):
    """Increment session query count and optionally track target usage."""
    if user_id not in user_sessions:
        return
    user_sessions[user_id]["query_count"] += 1
    if target:
        targets = user_sessions[user_id]["targets_used"]
        targets[target] = targets.get(target, 0) + 1


def _find_and_extract_error(obj, path=None):
    """Recursively find error dict in nested structure"""
    if path is None:
        path = []
    if isinstance(obj, dict):
        if "error" in obj:
            return obj, path
        for key, value in obj.items():
            result, error_path = _find_and_extract_error(value, path + [key])
            if result:
                return result, error_path
    return None, []


def load_match_database():
    """
    Load match database from JSON file on startup.

    Smart rebuild logic:
    - If cache missing → rebuild
    - If experiments directory newer than cache → rebuild
    - Otherwise → load from cache

    This ensures cache stays fresh without expensive staleness checks.
    """
    global match_database

    experiments_path = Path(__file__).parent.parent / "logs" / "experiments"

    # Check if rebuild needed (simple file timestamp comparison)
    needs_rebuild = False

    if not MATCH_DB_PATH.exists():
        logger.info("[MATCH_DB] Cache missing, will rebuild")
        needs_rebuild = True
    elif experiments_path.exists():
        # Compare timestamps: is experiments dir newer than cache?
        cache_mtime = MATCH_DB_PATH.stat().st_mtime

        # Check if ANY experiment has newer content
        for exp_dir in experiments_path.iterdir():
            if not exp_dir.is_dir() or exp_dir.name.startswith('.'):
                continue

            runs_dir = exp_dir / "runs"
            if runs_dir.exists() and runs_dir.stat().st_mtime > cache_mtime:
                logger.info(f"[MATCH_DB] Experiment {exp_dir.name} has new data, will rebuild")
                needs_rebuild = True
                break

    # Rebuild if needed
    if needs_rebuild:
        rebuild_match_database()
        return

    # Load existing cache
    try:
        with open(MATCH_DB_PATH, 'r', encoding='utf-8') as f:
            match_database = json.load(f)
        logger.info(f"[MATCH_DB] Loaded {len(match_database)} identifiers from cache")

        # Log cache summary
        summary = cache_metadata.get_summary()
        logger.info(f"[MATCH_DB] Cache age: {summary['age']}, identifiers: {summary['total_identifiers']}")
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"[MATCH_DB] Failed to load cache: {e}, rebuilding...")
        rebuild_match_database()


def save_match_database():
    """Persist match database to JSON file"""
    MATCH_DB_PATH.parent.mkdir(exist_ok=True)
    with open(MATCH_DB_PATH, 'w', encoding='utf-8') as f:
        json.dump(match_database, f, indent=2, ensure_ascii=False)


def update_match_database(record: Dict[str, Any]):
    """Live mode: Update database from single log record"""
    target = record.get("target")
    source = record.get("source")
    if not target or not source or target == "No matches found":
        return

    now = datetime.utcnow().isoformat() + "Z"

    # Step 1: Update all existing aliases for this source to point to new target
    # This preserves history while tracking the "ground truth" current assignment
    for entity_id, entity in match_database.items():
        if entity_id == target:
            continue  # Skip the new target
        if source in entity.get("aliases", {}):
            entity["aliases"][source]["current_target"] = target

    # Track if new entry (before creating)
    is_new = target not in match_database

    # Create or update identifier entry
    # Note: entity_profile is NOT stored here because it describes the SOURCE (user query),
    # not the TARGET (matched identifier). The profile explains what the user searched for,
    # not what the standardized term means.
    entry = _ensure_db_entry(target, web_sources=record.get("web_sources", []), timestamp=now)

    method = record.get("method")
    confidence = record.get("confidence", 0)
    verified = _is_alias_verified(method, confidence)

    # Update alias WITHOUT current_target (this IS the current target)
    entry["aliases"][source] = {
        "timestamp": now,
        "method": method,
        "confidence": confidence,
        "verified": verified
    }

    # Update web_sources and timestamp if provided
    if record.get("web_sources"):
        entry["web_sources"] = record.get("web_sources", [])
        entry["last_updated"] = now

    # Track incremental update in metadata
    cache_metadata.add_incremental_update(
        source="backend_pipeline",
        records_added=1,
        identifiers_added=1 if is_new else 0,
        identifiers_updated=0 if is_new else 1,
    )

    save_match_database()


def rebuild_match_database():
    """
    Rebuild mode: Regenerate database from langfuse structure.

    Scans all traces and observations in logs/langfuse/ to build the match database.
    Extracts entity profiles, aliases, and web sources.
    """
    global match_database
    match_database = {}

    langfuse_path = Path(__file__).parent.parent / "logs" / "langfuse"
    traces_path = langfuse_path / "traces"
    observations_path = langfuse_path / "observations"

    if not traces_path.exists():
        logger.warning("[MATCH_DB] No langfuse traces directory found")
        save_match_database()
        return 0

    logger.info("[MATCH_DB] Rebuilding from langfuse structure...")
    cache_metadata.mark_rebuild_start("langfuse")

    total_records = 0

    for trace_file in traces_path.glob("*.json"):
        try:
            with open(trace_file, 'r', encoding='utf-8') as f:
                trace = json.load(f)

            trace_id = trace.get("id")
            query = trace.get("input", {}).get("query")
            output = trace.get("output", {})
            target = output.get("target")

            if not query or not target:
                continue

            normalized_record = {
                "source": query,
                "target": target,
                "method": output.get("method"),
                "confidence": output.get("confidence"),
                "timestamp": trace.get("timestamp"),
                "session_id": trace.get("session_id"),
            }

            # Load observations for entity_profile and web_sources
            obs_dir = observations_path / trace_id
            if obs_dir.exists():
                for obs_file in obs_dir.glob("*.json"):
                    with open(obs_file, 'r', encoding='utf-8') as of:
                        obs = json.load(of)
                        if obs.get("name") == "entity_profiling":
                            normalized_record["entity_profile"] = obs.get("output")
                        elif obs.get("name") == "web_search":
                            normalized_record["web_sources"] = obs.get("output", {}).get("sources", [])

            _update_db_entry(normalized_record)
            total_records += 1

        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"[MATCH_DB] Error reading {trace_file}: {e}")
            continue

    # Count identifiers and aliases
    identifiers_count = len(match_database)
    aliases_count = sum(len(entry["aliases"]) for entry in match_database.values())

    save_match_database()

    # Update cache metadata
    cache_metadata.mark_rebuild_complete(
        source_type="langfuse",
        records_processed=total_records,
        identifiers_count=identifiers_count,
        aliases_count=aliases_count,
        data_sources=[{"type": "langfuse", "traces_loaded": total_records}],
    )

    logger.info(f"[MATCH_DB] Rebuilt from langfuse: {identifiers_count} identifiers, {total_records} records")
    return identifiers_count


def _update_db_entry(record: Dict[str, Any]):
    """Internal: Update database entry without saving (for batch rebuild)"""
    target = record.get("target")
    source = record.get("source")
    if not target or not source or target == "No matches found":
        return

    # Note: entity_profile is NOT stored - it describes the source query, not the target
    entry = _ensure_db_entry(target, web_sources=record.get("web_sources", []), timestamp=record.get("timestamp"))

    existing = entry["aliases"].get(source)
    if not existing or record.get("timestamp", "") > existing.get("timestamp", ""):
        method = record.get("method")
        confidence = record.get("confidence", 0)
        verified = _is_alias_verified(method, confidence or 0)

        entry["aliases"][source] = {
            "timestamp": record.get("timestamp"),
            "method": method,
            "confidence": confidence,
            "verified": verified
        }

    if record.get("web_sources") and record.get("timestamp", "") > entry.get("last_updated", ""):
        entry["web_sources"] = record.get("web_sources", [])
        entry["last_updated"] = record.get("timestamp")


def _prioritize_errors(record):
    """Check for errors in training record and move to first position if detected"""
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


@router.post("/sessions")
async def init_terms(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Create session with terms array and tracking"""
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


def _resolve_pipeline_params(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Extract pipeline parameters with defaults from pipeline.json, overridable per-request."""
    _ws = _node("web_search")
    _ep = _node("entity_profiling")
    _tm = _node("token_matching")
    _lr = _node("llm_ranking")
    _fm = _node("fuzzy_matching")
    return {
        "max_sites": payload.get("max_sites", _ws["max_sites"]),
        "num_results": payload.get("num_results", _ws["num_results"]),
        "content_char_limit": payload.get("content_char_limit", _ws["content_char_limit"]),
        "raw_content_limit": payload.get("raw_content_limit", _ws["raw_content_limit"]),
        "profiling_temperature": payload.get("profiling_temperature", _ep["temperature"]),
        "profiling_max_tokens": payload.get("profiling_max_tokens", _ep["max_tokens"]),
        "ranking_temperature": payload.get("ranking_temperature", _lr["temperature"]),
        "ranking_max_tokens": payload.get("ranking_max_tokens", _lr["max_tokens"]),
        "ranking_sample_size": payload.get("ranking_sample_size", _lr["ranking_sample_size"]),
        "max_token_candidates": payload.get("max_token_candidates", _tm["max_token_candidates"]),
        "relevance_weight_core": payload.get("relevance_weight_core", _tm["relevance_weight_core"]),
        "ranking_prompt": payload.get("ranking_prompt", None),
        "fuzzy_threshold": payload.get("fuzzy_threshold", _fm["threshold"]),
        "fuzzy_scorer": payload.get("fuzzy_scorer", _fm["scorer"]),
    }


def _run_fuzzy_step(query: str, terms: List[str], params: Dict) -> tuple:
    """Step 0: Fuzzy matching. Returns (results, elapsed_time)."""
    logger.info(CYAN + "[PIPELINE] Step 0: Fuzzy matching" + RESET)
    t0 = time.time()
    results = fuzzy_match_terms(
        query, terms, threshold=params["fuzzy_threshold"], scorer=params["fuzzy_scorer"], limit=5
    )
    elapsed = round(time.time() - t0, 3)
    logger.info(f"[PIPELINE] Fuzzy: {len(results)} matches in {elapsed}s")
    return results, elapsed


async def _run_research_step(query: str, steps: List[str], params: Dict) -> tuple:
    """Step 1: Web search + entity profiling. Returns (entity_profile, profile_debug, elapsed_time)."""
    run_web_search = "web_search" in steps
    run_entity_profiling = "entity_profiling" in steps

    t0 = time.time()
    if run_entity_profiling:
        effective_max_tokens = params["profiling_max_tokens"] // 2 if not run_web_search else params["profiling_max_tokens"]
        logger.info("[PIPELINE] Step 1: Researching%s", "" if run_web_search else " (LLM knowledge only)")
        entity_profile, profile_debug = await web_generate_entity_profile(
            query,
            max_sites=params["max_sites"],
            schema=ENTITY_SCHEMA,
            content_char_limit=params["content_char_limit"],
            raw_content_limit=params["raw_content_limit"],
            num_results=params["num_results"],
            profiling_temperature=params["profiling_temperature"],
            profiling_max_tokens=effective_max_tokens,
            verbose=True,
            skip_search=not run_web_search,
        )
        logger.debug("[PIPELINE] Entity profile: %s", entity_profile)
    else:
        logger.info(CYAN + "[PIPELINE] Step 1: Skipping entity profiling" + RESET)
        entity_profile = []
        profile_debug = {"inputs": {"scraped_sources": {"sources_fetched": [], "note": "Skipped by pipeline steps"}}}

    return entity_profile, profile_debug, round(time.time() - t0, 3)


def _run_token_step(query: str, entity_profile: list, token_matcher: "TokenLookupMatcher") -> tuple:
    """Step 2: Token matching. Returns (candidate_results, elapsed_time)."""
    logger.info("\n[PIPELINE] Step 2: Matching candidates")
    search_terms = [word for s in [query] + utils.flatten_strings(entity_profile) for word in s.split()]
    unique_search_terms = list(set(search_terms))

    logger.info(f"Search terms: {len(search_terms)} total → {len(unique_search_terms)} unique")
    logger.info(f"Unique terms: {', '.join(unique_search_terms[:20])}{'...' if len(unique_search_terms) > 20 else ''}")

    t0 = time.time()
    candidate_results = token_matcher.match(unique_search_terms)
    elapsed = round(time.time() - t0, 3)

    logger.info(f"{RED}{chr(10).join([str(item) for item in candidate_results])}{RESET}")
    logger.info(f"Match completed in {elapsed:.2f}s")
    return candidate_results, elapsed


async def _run_ranking_step(entity_profile: list, candidates: list, query: str, steps: List[str], params: Dict) -> tuple:
    """Step 3: LLM ranking. Returns (llm_response, ranking_debug, elapsed_time)."""
    run_llm_ranking = "llm_ranking" in steps
    max_token_candidates = params["max_token_candidates"]

    t0 = time.time()
    if not run_llm_ranking:
        logger.info(CYAN + "\n[PIPELINE] Step 3: Skipping LLM ranking (using token scores)" + RESET)
        llm_response = {
            "ranked_candidates": [
                {"candidate": term, "relevance_score": score, "core_concept_score": score, "spec_score": 0}
                for term, score in candidates[:max_token_candidates]
            ]
        }
        ranking_debug = {"inputs": {"token_matched_candidates": candidates[:max_token_candidates]}}
    else:
        logger.info(CYAN + "\n[PIPELINE] Step 3: Ranking with LLM" + RESET)
        profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
        llm_response, ranking_debug = await call_llm_for_ranking(
            profile_info, entity_profile, candidates, query,
            temperature=params["ranking_temperature"],
            max_tokens=params["ranking_max_tokens"],
            sample_size=params["ranking_sample_size"],
            relevance_weight_core=params["relevance_weight_core"],
            ranking_prompt=params["ranking_prompt"],
        )
    elapsed = round(time.time() - t0, 3) if run_llm_ranking else None
    return llm_response, ranking_debug, elapsed


def _build_training_record(
    query: str, user_id: str, llm_response: dict, entity_profile: list,
    profile_debug: dict, ranking_debug: dict, candidates: list,
    params: Dict, steps: List[str], total_time: float,
) -> Dict[str, Any]:
    """Build training record for langfuse logging and match DB update."""
    ranked_candidates = llm_response.get("ranked_candidates", [])
    target = ranked_candidates[0].get("candidate") if ranked_candidates else "No matches found"
    confidence = ranked_candidates[0].get("relevance_score", 0) if ranked_candidates else 0

    scraped_sources = profile_debug["inputs"]["scraped_sources"]
    web_search_failed = isinstance(scraped_sources, dict) and "error" in scraped_sources

    record = {
        "source": query,
        "target": target,
        "method": "ProfileRank",
        "confidence": confidence,
        "session_id": user_id,
        "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "total_time": total_time,
        "web_search_status": "failed" if web_search_failed else "success",
        "pipeline_params": {"steps": steps, **params},
        "entity_profile": entity_profile,
        "candidates": [
            {"rank": i, "name": c.get("candidate"), "score": c.get("relevance_score"),
             "core_score": c.get("core_concept_score"), "spec_score": c.get("spec_score")}
            for i, c in enumerate(ranked_candidates)
        ] if ranked_candidates else [],
        "token_matches": ranking_debug["inputs"]["token_matched_candidates"] if ranking_debug else [],
        "web_sources": scraped_sources.get("sources_fetched", []) if not web_search_failed else [],
    }
    return _prioritize_errors(record)


def _build_pipeline_response(
    llm_response: dict, entity_profile: list, candidates: list,
    profile_debug: dict, step_timings: dict, params: Dict,
    steps: List[str], total_time: float,
) -> Dict[str, Any]:
    """Build standardized API response."""
    ranked = llm_response.get("ranked_candidates", [])
    scraped_sources = profile_debug["inputs"]["scraped_sources"]
    web_search_failed = isinstance(scraped_sources, dict) and "error" in scraped_sources

    result = success_response(
        message=f"Research completed - Found {len(ranked)} matches in {total_time}s",
        data={
            "ranked_candidates": ranked,
            "entity_profile": entity_profile,
            "token_matched_candidates": candidates[:params["max_token_candidates"]],
            "llm_provider": llm_response.get("llm_provider"),
            "total_time": total_time,
            "step_timings": step_timings,
            "web_search_status": "failed" if web_search_failed else "success",
            "web_search_error": scraped_sources.get("error") if web_search_failed else None,
            "pipeline_params": {"steps": steps, **params},
        }
    )
    logger.info(YELLOW)
    logger.info(json.dumps(result, indent=2))
    logger.info(RESET)
    return result


@router.post("/matches")
async def research_and_match(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Normalize a term - research and rank candidates using LLM + token matching"""
    user_id = request.state.user_id
    query = payload.get("query", "")
    steps = payload.get("steps") or _pipeline("default")
    trace_id = payload.get("trace_id")

    if not settings.use_web_search:
        steps = [s for s in steps if s != "web_search"]

    params = _resolve_pipeline_params(payload)

    if user_id not in user_sessions:
        raise HTTPException(status_code=400, detail="No session found - initialize session first with POST /sessions")

    terms = user_sessions[user_id]["terms"]
    logger.info(f"[PIPELINE] User {user_id}: Started for query: '{query}' with {len(terms)} terms from session")
    start_time = time.time()

    # Step 0: Fuzzy matching (optional, short-circuits if fuzzy-only)
    fuzzy_time = None
    if steps is not None and "fuzzy_matching" in steps:
        fuzzy_results, fuzzy_time = _run_fuzzy_step(query, terms, params)
        if steps == ["fuzzy_matching"]:
            total_time = round(time.time() - start_time, 2)
            return success_response(
                message=f"Fuzzy matching completed - {len(fuzzy_results)} matches in {total_time}s",
                data={
                    "ranked_candidates": [{"candidate": t, "relevance_score": s} for t, s in fuzzy_results],
                    "total_time": total_time,
                    "step_timings": {"fuzzy_matching": fuzzy_time},
                    "pipeline_params": {"steps": ["fuzzy_matching"], "fuzzy_threshold": params["fuzzy_threshold"], "fuzzy_scorer": params["fuzzy_scorer"]},
                }
            )

    # Steps 1-3: Research → Token matching → LLM ranking
    token_matcher = TokenLookupMatcher(terms)
    logger.info(f"[PIPELINE] TokenLookupMatcher created with {len(token_matcher.deduplicated_terms)} unique terms")

    entity_profile, profile_debug, step1_time = await _run_research_step(query, steps, params)
    candidate_results, step2_time = _run_token_step(query, entity_profile, token_matcher)
    llm_response, ranking_debug, step3_time = await _run_ranking_step(entity_profile, candidate_results, query, steps, params)

    total_time = round(time.time() - start_time, 2)
    step_timings = {"fuzzy_matching": fuzzy_time, "entity_profiling": step1_time, "token_matching": step2_time, "llm_ranking": step3_time}

    # Log and persist
    training_record = _build_training_record(query, user_id, llm_response, entity_profile, profile_debug, ranking_debug, candidate_results, params, steps, total_time)

    try:
        logged_trace_id = log_pipeline(training_record, session_id=user_id, trace_id=trace_id)
        logger.info(f"[LANGFUSE] Logged trace: {logged_trace_id}")
    except Exception as e:
        logger.error(f"[LANGFUSE] Failed to log: {e}")

    update_match_database(training_record)
    logger.info(f"[PIPELINE] Training record saved: {query} → {training_record['target']}")
    _update_session_usage(user_id, training_record["target"])

    return _build_pipeline_response(llm_response, entity_profile, candidate_results, profile_debug, step_timings, params, steps, total_time)


@router.post("/batches/{batch_id}/items")
async def batch_process_single(
    request: Request,
    batch_id: str,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
    """
    Process a single query within a batch.
    Lightweight version of /matches for batch operations.
    """
    user_id = request.state.user_id
    query = payload.get("query", "")
    context = payload.get("context", "")  # User-provided context

    if not query:
        return {"status": "error", "message": "Query is required"}

    # Retrieve terms from session
    if user_id not in user_sessions:
        raise HTTPException(
            status_code=400,
            detail="No session found - initialize session first"
        )

    terms = user_sessions[user_id]["terms"]
    logger.info(f"[BATCH] Processing: {query} (context: {context[:50] if context else 'none'}...)")

    start_time = time.time()

    # Create token matcher
    token_matcher = TokenLookupMatcher(terms)

    # Build entity profile with context (fewer sites for batch)
    query_with_context = f"{query} {context}" if context else query
    entity_profile, profile_debug = await web_generate_entity_profile(
        query_with_context,
        max_sites=5,  # Fewer sites for batch processing
        schema=ENTITY_SCHEMA,
        verbose=False
    )

    # Token matching
    search_terms = [word for s in [query] + utils.flatten_strings(entity_profile)
                    for word in s.split()]
    unique_search_terms = list(set(search_terms))
    candidate_results = token_matcher.match(unique_search_terms)

    # LLM ranking with context
    profile_info = display_profile(entity_profile, "BATCH PROFILE")
    llm_response, ranking_debug = await call_llm_for_ranking(
        profile_info,
        entity_profile,
        candidate_results,
        f"{query} (User context: {context})" if context else query
    )

    ranked_candidates = llm_response.get('ranked_candidates', [])
    target = ranked_candidates[0].get('candidate') if ranked_candidates else "No matches"
    confidence = ranked_candidates[0].get('relevance_score', 0) if ranked_candidates else 0

    total_time = round(time.time() - start_time, 2)

    # Build training record for logging
    training_record = {
        "source": query,
        "target": target,
        "method": "BatchProfileRank",
        "confidence": confidence,
        "entity_profile": entity_profile,
        "web_sources": profile_debug.get("inputs", {}).get("scraped_sources", {}).get("sources_fetched", []),
        "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "total_time": total_time,
    }

    # Langfuse logging
    try:
        log_pipeline(training_record, session_id=user_id)
    except Exception as e:
        logger.error(f"[LANGFUSE] Failed to log batch: {e}")

    # Update match database
    update_match_database(training_record)

    # Update session usage stats
    _update_session_usage(user_id, target)

    logger.info(f"[BATCH] Completed: {query} -> {target} ({confidence:.0%}) in {total_time}s")

    return success_response(
        message="Single batch item processed",
        data={
            "target": target,
            "confidence": confidence,
            "candidates": ranked_candidates[:3],  # Top 3 only for batch
            "total_time": total_time
        }
    )


# =============================================================================
# DIRECT PROMPT - Single LLM call without web search
# =============================================================================

@router.post("/batches")
async def batch_start(
    request: Request,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
    """
    Create a batch operation. Returns batch_id for linking items.

    Payload:
        method: "DirectPrompt" (required)
        user_prompt: User's instruction prompt (required)
        item_count: Number of items to process (required)
    """
    user_id = request.state.user_id
    method = payload.get("method", "DirectPrompt")
    user_prompt = payload.get("user_prompt", "")
    item_count = payload.get("item_count", 0)

    if not user_prompt:
        raise HTTPException(400, "user_prompt is required")
    if item_count < 1:
        raise HTTPException(400, "item_count must be >= 1")

    batch_id = log_batch_start(
        method=method,
        user_prompt=user_prompt,
        item_count=item_count,
        session_id=user_id,
    )

    logger.info(f"[BATCH] Started batch {batch_id}: {method}, {item_count} items")

    return success_response(
        message=f"Batch started: {item_count} items",
        data={"batch_id": batch_id}
    )


@router.patch("/batches/{batch_id}")
async def batch_complete(
    request: Request,
    batch_id: str,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
    """
    Complete a batch operation.

    Path params:
        batch_id: Batch ID from POST /batches
    Payload:
        success_count: Number of successful items (required)
        error_count: Number of failed items (default: 0)
        total_time_ms: Total batch time in milliseconds (default: 0)
    """
    success_count = payload.get("success_count", 0)
    error_count = payload.get("error_count", 0)
    total_time_ms = payload.get("total_time_ms", 0)

    log_batch_complete(
        batch_id=batch_id,
        success_count=success_count,
        error_count=error_count,
        total_time_ms=total_time_ms,
    )

    logger.info(f"[BATCH] Completed batch {batch_id}: {success_count} success, {error_count} errors")

    return success_response(
        message=f"Batch completed: {success_count}/{success_count + error_count} successful",
        data={"batch_id": batch_id, "success_count": success_count, "error_count": error_count}
    )


@router.post("/prompts")
async def direct_prompt(
    request: Request,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
    """
    Execute a direct LLM prompt with validation against session terms.

    Payload:
        query: Input text to process (required)
        user_prompt: User's instruction prompt (required)
        batch_id: Optional batch ID (for batch operations)
        current_output: Optional current output column value (provides context)
        project_context: Optional project-specific context string

    Returns:
        target: LLM output (processed/transformed value)
        confidence: 0.0-1.0 (set to 0 if output not in session terms)
        confidence_corrected: True if output was not in terms

    Flow:
    1. Build system prompt with project_context (if provided) + user_prompt
    2. Send to LLM with query and current_output (if provided)
    3. LLM returns output + confidence
    4. Validate: if output not in session terms → confidence = 0
    """
    user_id = request.state.user_id
    query = payload.get("query", "").strip()
    user_prompt = payload.get("user_prompt", "").strip()
    batch_id = payload.get("batch_id")  # Optional
    current_output = payload.get("current_output", "").strip()  # Current output column value
    project_context = payload.get("project_context", "").strip()  # Project-specific context

    logger.info(f"[DIRECT_PROMPT] Received: query='{query[:30] if query else 'EMPTY'}', prompt='{user_prompt[:30] if user_prompt else 'EMPTY'}', batch_id={batch_id}, has_output={bool(current_output)}, has_context={bool(project_context)}")

    if not query:
        logger.warning("[DIRECT_PROMPT] Rejected: empty query")
        raise HTTPException(400, "Query is required")
    if not user_prompt:
        logger.warning("[DIRECT_PROMPT] Rejected: empty user_prompt")
        raise HTTPException(400, "user_prompt is required")

    # Retrieve terms from session for validation
    if user_id not in user_sessions:
        logger.warning(f"[DIRECT_PROMPT] Rejected: no session for user_id={user_id}")
        raise HTTPException(
            400,
            "No session found - initialize session first with POST /sessions"
        )

    terms = user_sessions[user_id]["terms"]
    terms_set = set(terms)  # For O(1) lookup

    logger.info(f"[DIRECT_PROMPT] Processing: {query[:50]}... (batch_id: {batch_id or 'none'})")
    start_time = time.time()

    # Build system prompt for general LLM inference
    context_sections = []
    if project_context:
        context_sections.append(f"PROJECT CONTEXT:\n{project_context}")
    context_sections.append(f"USER INSTRUCTIONS:\n{user_prompt}")
    if current_output:
        context_sections.append(f"Current output value: {current_output}")

    system_prompt = f"""You are a helpful assistant that processes text according to user instructions.

{chr(10).join(context_sections)}

For the given input, apply the user's instructions and return a JSON object:
{{
    "output": "the processed/transformed result",
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation of what you did"
}}

Return ONLY valid JSON."""

    # Build user message
    user_content = f"Input: {query}"
    if current_output:
        user_content += f"\nCurrent output: {current_output}"

    # Single LLM call
    try:
        response = await llm_call(
            messages=[{"role": "user", "content": user_content}],
            system=system_prompt,
            output_format="json",
            temperature=0.0,
            max_tokens=300,
        )

        target = response.get("output", query)  # Default to original if no output
        confidence = float(response.get("confidence", 0.5))
        reasoning = response.get("reasoning", "")

    except Exception as e:
        logger.error(f"[DIRECT_PROMPT] LLM error: {e}")
        return {"status": "error", "message": f"LLM error: {str(e)}"}

    total_time = round(time.time() - start_time, 2)

    # VALIDATION: Fuzzy match LLM output against session terms
    # Get top 10 closest matches and decide: accept, correct, or return candidates
    fuzzy_corrected = False
    needs_user_selection = False
    candidates = []
    fuzzy_score = 0.0
    original_target = None

    top_matches = find_top_matches(target, terms, n=10)
    best_match, best_score = top_matches[0] if top_matches else (None, 0)
    fuzzy_score = best_score

    if best_score >= ACCEPT_THRESHOLD:
        # Accept - LLM output is close enough to a valid term
        if best_match != target:
            original_target = target
            target = best_match
            fuzzy_corrected = True
            logger.info(f"[DIRECT_PROMPT] Fuzzy corrected '{original_target[:30]}' -> '{target[:30]}' (score: {best_score:.2f})")
        else:
            logger.info(f"[DIRECT_PROMPT] Exact match found: '{target[:30]}' (score: {best_score:.2f})")
    else:
        # Poor match - return candidates for user selection
        needs_user_selection = True
        candidates = [{"candidate": c, "score": round(s, 3)} for c, s in top_matches]
        logger.info(f"[DIRECT_PROMPT] No good match for '{target[:30]}' (best: {best_score:.2f}), returning {len(candidates)} candidates")
        # Keep target as-is but set confidence to 0 to signal user action needed
        confidence = 0.0

    # Build training record
    training_record = {
        "source": query,
        "target": target,
        "method": "DirectPrompt",
        "confidence": confidence,
        "reasoning": reasoning,  # LLM's explanation
        "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "total_time": total_time,
        "fuzzy_score": fuzzy_score,
    }

    if fuzzy_corrected:
        training_record["fuzzy_corrected"] = True
        training_record["original_target"] = original_target

    if needs_user_selection:
        training_record["needs_user_selection"] = True
        training_record["candidates"] = candidates

    # Langfuse logging with batch_id and user_prompt
    try:
        trace_id = log_pipeline(
            training_record,
            session_id=user_id,
            batch_id=batch_id,
            user_prompt=user_prompt,
        )
        logger.info(f"[LANGFUSE] Logged DirectPrompt trace: {trace_id}")
    except Exception as e:
        logger.error(f"[LANGFUSE] Failed to log: {e}")

    # Update match database (live mode) - only if accepted (not needing user selection)
    if not needs_user_selection:
        update_match_database(training_record)

    # Update session usage stats
    _update_session_usage(user_id, target if not needs_user_selection else None)

    # Build status message for logging
    status_msg = f"-> {target[:40]}..." if len(target) > 40 else f"-> {target}"
    if needs_user_selection:
        status_msg += f" (NEEDS SELECTION, best: {fuzzy_score:.0%})"
    elif fuzzy_corrected:
        status_msg += f" (corrected from '{original_target[:20]}', {fuzzy_score:.0%})"
    else:
        status_msg += f" ({confidence:.0%})"

    logger.info(f"[DIRECT_PROMPT] Completed: {query[:30]}... {status_msg} in {total_time}s")

    response_data = {
        "target": target,
        "confidence": confidence,
        "reasoning": reasoning,
        "total_time": total_time,
        "fuzzy_score": fuzzy_score,
    }

    if fuzzy_corrected:
        response_data["fuzzy_corrected"] = True
        response_data["original_target"] = original_target

    if needs_user_selection:
        response_data["needs_user_selection"] = True
        response_data["candidates"] = candidates

    return success_response(
        message="Direct prompt completed",
        data=response_data
    )


# =============================================================================
# FRONTEND LOGGING ENDPOINTS
# =============================================================================

from pydantic import BaseModel
from typing import Optional


class LogMatchRequest(BaseModel):
    """Request body for /log-match endpoint"""
    source: str                    # Original input term
    target: str                    # Matched result
    method: str                    # "cached" | "fuzzy"
    confidence: float              # 1.0 for cache, similarity score for fuzzy
    workbook_id: Optional[str] = None
    latency_ms: Optional[float] = None
    matched_key: Optional[str] = None      # Key that matched (fuzzy only)
    direction: Optional[str] = None        # "forward" | "reverse"


class LogActivityRequest(BaseModel):
    """Request body for /log-activity endpoint"""
    source: str
    target: str
    method: str                    # "UserChoice" | "DirectEdit"
    confidence: float
    timestamp: Optional[str] = None


@router.post("/activities/matches")
async def log_match(request: Request, payload: LogMatchRequest) -> Dict[str, Any]:
    """
    Log cache/fuzzy match events from frontend to Langfuse.

    Called fire-and-forget by frontend after cache/fuzzy matches return.
    Creates trace, observation, scores, and links to dataset item.
    """
    user_id = getattr(request.state, 'user_id', 'anonymous')

    try:
        if payload.method == "cached":
            trace_id = log_cache_match(
                source=payload.source,
                target=payload.target,
                latency_ms=payload.latency_ms or 0,
                user_id=user_id,
                session_id=user_id,
            )
        elif payload.method == "fuzzy":
            trace_id = log_fuzzy_match(
                source=payload.source,
                target=payload.target,
                confidence=payload.confidence,
                matched_key=payload.matched_key,
                direction=payload.direction,
                latency_ms=payload.latency_ms or 0,
                user_id=user_id,
                session_id=user_id,
            )
        else:
            raise HTTPException(400, f"Unknown method: {payload.method}")

        logger.info(f"[LOG_MATCH] {payload.method}: {payload.source[:30]}... -> {payload.target[:30]}... ({trace_id})")

        return success_response(
            message=f"{payload.method} match logged",
            data={"trace_id": trace_id}
        )

    except Exception as e:
        logger.error(f"[LOG_MATCH] Error: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/activities")
async def log_activity(request: Request, payload: LogActivityRequest) -> Dict[str, Any]:
    """
    Log user corrections (UserChoice, DirectEdit) from frontend to Langfuse.

    Called by frontend when user selects a candidate or directly edits output.
    Updates ground truth in dataset item.
    """
    try:
        success = log_user_correction(
            source=payload.source,
            target=payload.target,
            method=payload.method,
        )

        logger.info(f"[LOG_ACTIVITY] {payload.method}: {payload.source[:30]}... -> {payload.target[:30]}...")

        return success_response(
            message=f"{payload.method} logged",
            data={"success": success}
        )

    except Exception as e:
        logger.error(f"[LOG_ACTIVITY] Error: {e}")
        return {"status": "error", "message": str(e)}