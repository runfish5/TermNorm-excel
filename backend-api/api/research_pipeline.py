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
from utils.cache_metadata import CacheMetadata
from utils.live_experiment_logger import log_to_experiments
from utils.standards_logger import TaskDatasetManager, ConfigTreeManager

logger = logging.getLogger(__name__)

# Singleton managers for task/config tracking (Langfuse-compatible)
_task_manager: TaskDatasetManager = None
_config_manager: ConfigTreeManager = None

def get_task_manager() -> TaskDatasetManager:
    """Get or create singleton task manager."""
    global _task_manager
    if _task_manager is None:
        _task_manager = TaskDatasetManager()
    return _task_manager

def get_config_manager() -> ConfigTreeManager:
    """Get or create singleton config manager."""
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigTreeManager()
    return _config_manager
router = APIRouter()

# Load entity schema once at module level
_schema_path = Path(__file__).parent.parent / "research_and_rank" / "entity_profile_schema.json"
with open(_schema_path, 'r') as f:
    ENTITY_SCHEMA = json.load(f)

# Match database - persistent index of identifiers
MATCH_DB_PATH = Path(__file__).parent.parent / "logs" / "match_database.json"
match_database: Dict[str, Any] = {}

# Cache metadata tracker - sophisticated tracking of loaded data
cache_metadata = CacheMetadata()


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

    # Create or update identifier entry
    if target not in match_database:
        match_database[target] = {
            "entity_profile": record.get("entity_profile"),
            "aliases": {},
            "web_sources": record.get("web_sources", []),
            "last_updated": record.get("timestamp")
        }

    entry = match_database[target]

    # Update alias (newer timestamp wins)
    existing = entry["aliases"].get(source)
    if not existing or record.get("timestamp", "") > existing.get("timestamp", ""):
        entry["aliases"][source] = {
            "timestamp": record.get("timestamp"),
            "method": record.get("method"),
            "confidence": record.get("confidence")
        }

    # Update entity_profile if this is newer and has profile
    if record.get("entity_profile") and record.get("timestamp", "") > entry.get("last_updated", ""):
        entry["entity_profile"] = record.get("entity_profile")
        entry["web_sources"] = record.get("web_sources", [])
        entry["last_updated"] = record.get("timestamp")


    # Track incremental update in metadata
    identifiers_added = 1 if target not in match_database else 0
    identifiers_updated = 0 if identifiers_added else 1
    cache_metadata.add_incremental_update(
        source="backend_pipeline",
        records_added=1,
        identifiers_added=identifiers_added,
        identifiers_updated=identifiers_updated,
    )

    save_match_database()


def rebuild_match_database():
    """
    Rebuild mode: Regenerate database from experiments structure.

    Scans all experiments for evaluation_results.jsonl files and corresponding traces.
    Extracts entity profiles, aliases, and web sources to build the match database.

    INTENDED BEHAVIOR - Reads ONLY from experiments structure:
    - activity.jsonl is LEGACY (for dual-logging transition period)
    - rebuild ONLY reads from experiments/ (the single source of truth)
    - If you need activity.jsonl data, run migration script first:
      python backend-api/archive/convert_activity_to_experiments.py
    """
    global match_database
    match_database = {}

    experiments_path = Path(__file__).parent.parent / "logs" / "experiments"

    if not experiments_path.exists():
        logger.warning("[MATCH_DB] No experiments directory found")
        save_match_database()
        return 0

    logger.info("[MATCH_DB] Rebuilding from experiments structure...")
    cache_metadata.mark_rebuild_start("experiments")

    data_sources = []
    total_records = 0

    for exp_dir in experiments_path.iterdir():
        if not exp_dir.is_dir():
            continue

        experiment_id = exp_dir.name
        runs_loaded = []

        runs_dir = exp_dir / "runs"
        if not runs_dir.exists():
            continue

        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir():
                continue

            run_id = run_dir.name
            results_file = run_dir / "artifacts" / "evaluation_results.jsonl"

            if not results_file.exists():
                continue

            # Load evaluation results
            run_records = 0
            with open(results_file, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        record = json.loads(line)
                        # Convert from evaluation_results format to internal format
                        normalized_record = {
                            "source": record.get("query"),
                            "target": record.get("predicted"),
                            "method": record.get("method"),
                            "confidence": record.get("confidence"),
                            "timestamp": record.get("timestamp"),
                            "session_id": record.get("session_id"),
                        }

                        # Load full trace if available
                        trace_id = record.get("trace_id")
                        if trace_id:
                            trace_file = run_dir / "artifacts" / "traces" / f"{trace_id}.json"
                            if trace_file.exists():
                                with open(trace_file) as tf:
                                    trace = json.load(tf)
                                    # Extract entity_profile and web_sources from trace
                                    for obs in trace.get("observations", []):
                                        if obs.get("name") == "entity_profiling":
                                            normalized_record["entity_profile"] = obs.get("output")
                                        elif obs.get("name") == "web_search":
                                            normalized_record["web_sources"] = obs.get("output", {}).get("sources", [])

                        _update_db_entry(normalized_record)
                        run_records += 1
                        total_records += 1
                    except json.JSONDecodeError:
                        continue

            if run_records > 0:
                runs_loaded.append(run_id)

        if runs_loaded:
            data_sources.append({
                "type": "experiment",
                "experiment_id": experiment_id,
                "runs_loaded": runs_loaded,
                "num_runs": len(runs_loaded),
            })

    # Count identifiers and aliases
    identifiers_count = len(match_database)
    aliases_count = sum(len(entry["aliases"]) for entry in match_database.values())

    save_match_database()

    # Update cache metadata
    cache_metadata.mark_rebuild_complete(
        source_type="experiments",
        records_processed=total_records,
        identifiers_count=identifiers_count,
        aliases_count=aliases_count,
        data_sources=data_sources,
    )

    logger.info(f"[MATCH_DB] Rebuilt from experiments: {identifiers_count} identifiers, {total_records} records")
    return identifiers_count


def _update_db_entry(record: Dict[str, Any]):
    """Internal: Update database entry without saving (for batch rebuild)"""
    target = record.get("target")
    source = record.get("source")
    if not target or not source or target == "No matches found":
        return

    if target not in match_database:
        match_database[target] = {
            "entity_profile": record.get("entity_profile"),
            "aliases": {},
            "web_sources": record.get("web_sources", []),
            "last_updated": record.get("timestamp")
        }

    entry = match_database[target]
    existing = entry["aliases"].get(source)
    if not existing or record.get("timestamp", "") > existing.get("timestamp", ""):
        entry["aliases"][source] = {
            "timestamp": record.get("timestamp"),
            "method": record.get("method"),
            "confidence": record.get("confidence")
        }

    if record.get("entity_profile") and record.get("timestamp", "") > entry.get("last_updated", ""):
        entry["entity_profile"] = record.get("entity_profile")
        entry["web_sources"] = record.get("web_sources", [])
        entry["last_updated"] = record.get("timestamp")


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

    # Get or create task and config for this query (Langfuse-compatible)
    task_manager = get_task_manager()
    config_manager = get_config_manager()
    task_id = task_manager.get_or_create_task(query)
    config_id = config_manager.get_current_config()

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
        # Langfuse-compatible task/config linking
        "task_id": task_id,
        "config_id": config_id,

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

    # DUAL LOGGING (transition period):
    # 1. Write to activity.jsonl (legacy)
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(training_record) + "\n")

    # 2. Write to experiments structure (NEW - main production experiment)
    try:
        trace_id = log_to_experiments(training_record)
        logger.info(f"[EXPERIMENTS] Logged to production_realtime experiment, trace_id={trace_id}")
        # Link trace to task for re-evaluation when ground truth arrives
        task_manager.link_trace(task_id, trace_id)
    except Exception as e:
        logger.error(f"[EXPERIMENTS] Failed to log to experiments: {e}")

    # Update match database (live mode)
    update_match_database(training_record)

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


@router.post("/batch-process-single")
async def batch_process_single(
    request: Request,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
    """
    Process a single query with optional user context.
    Lightweight version of /research-and-match for batch operations.
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
    from core.llm_providers import LLM_PROVIDER, LLM_MODEL
    training_record = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "session_id": user_id,
        "source": query,
        "target": target,
        "method": "BatchProfileRank",
        "confidence": confidence,
        "entity_profile": entity_profile,
        "web_sources": profile_debug.get("inputs", {}).get("scraped_sources", {}).get("sources_fetched", []),
        "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "total_time": total_time,
        "context": context if context else None
    }

    # Log to activity.jsonl
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(training_record) + "\n")

    # Update match database
    update_match_database(training_record)

    # Update session usage stats
    if user_id in user_sessions:
        user_sessions[user_id]["query_count"] += 1
        targets = user_sessions[user_id]["targets_used"]
        targets[target] = targets.get(target, 0) + 1

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