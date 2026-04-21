"""
Match Database - Persistent index of standardized identifiers and their aliases.

Manages loading, saving, updating, and rebuilding the match database from
langfuse trace data.
"""
import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Any

from utils.cache_metadata import CacheMetadata
from config.pipeline_config import get_cache_config

logger = logging.getLogger(__name__)

MATCH_DB_PATH = Path(__file__).parent.parent / "logs" / "match_database.json"

_db: dict[str, Any] = {}
_cache_metadata = CacheMetadata()

# Shared thresholds
_cache_config = get_cache_config()
HIGH_CONFIDENCE_THRESHOLD = _cache_config["high_confidence_threshold"]
VERIFIED_METHODS = set(_cache_config["verified_methods"])


def get_db() -> dict[str, Any]:
    """Return the match database dict (mutable reference)."""
    return _db


def get_cache_metadata() -> CacheMetadata:
    """Return the cache metadata tracker."""
    return _cache_metadata


def _is_alias_verified(method, confidence):
    """Check if an alias should be marked as verified (user-confirmed or high-confidence)."""
    return method in VERIFIED_METHODS or confidence >= HIGH_CONFIDENCE_THRESHOLD


def _ensure_db_entry(target, web_sources=None, timestamp=None):
    """Create a database entry for target if it doesn't exist. Returns the entry."""
    if target not in _db:
        _db[target] = {
            "entity_profile": None,
            "aliases": {},
            "web_sources": web_sources or [],
            "last_updated": timestamp,
        }
    return _db[target]


def _update_db_entry(record: dict[str, Any]):
    """Internal: Update database entry without saving (for batch rebuild)."""
    target = record.get("target")
    source = record.get("source")
    if not target or not source or target == "No matches found":
        return

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


def load():
    """
    Load match database from JSON file on startup.

    Smart rebuild logic:
    - If cache missing -> rebuild
    - If experiments directory newer than cache -> rebuild
    - Otherwise -> load from cache
    """
    global _db

    experiments_path = Path(__file__).parent.parent / "logs" / "experiments"

    needs_rebuild = False

    if not MATCH_DB_PATH.exists():
        logger.info("[MATCH_DB] Cache missing, will rebuild")
        needs_rebuild = True
    elif experiments_path.exists():
        cache_mtime = MATCH_DB_PATH.stat().st_mtime
        for exp_dir in experiments_path.iterdir():
            if not exp_dir.is_dir() or exp_dir.name.startswith('.'):
                continue
            runs_dir = exp_dir / "runs"
            if runs_dir.exists() and runs_dir.stat().st_mtime > cache_mtime:
                logger.info(f"[MATCH_DB] Experiment {exp_dir.name} has new data, will rebuild")
                needs_rebuild = True
                break

    if needs_rebuild:
        rebuild()
        return

    try:
        with open(MATCH_DB_PATH, 'r', encoding='utf-8') as f:
            _db = json.load(f)
        logger.debug(f"[MATCH_DB] Loaded {len(_db)} identifiers from cache")
        summary = _cache_metadata.get_summary()
        logger.debug(f"[MATCH_DB] Cache age: {summary['age']}, identifiers: {summary['total_identifiers']}")
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"[MATCH_DB] Failed to load cache: {e}, rebuilding...")
        rebuild()


def save():
    """Persist match database to JSON file."""
    MATCH_DB_PATH.parent.mkdir(exist_ok=True)
    with open(MATCH_DB_PATH, 'w', encoding='utf-8') as f:
        json.dump(_db, f, indent=2, ensure_ascii=False)


def update(record: dict[str, Any]):
    """Live mode: Update database from single log record."""
    target = record.get("target")
    source = record.get("source")
    if not target or not source or target == "No matches found":
        return

    now = datetime.utcnow().isoformat() + "Z"

    # Update all existing aliases for this source to point to new target
    for entity_id, entity in _db.items():
        if entity_id == target:
            continue
        if source in entity.get("aliases", {}):
            entity["aliases"][source]["current_target"] = target

    is_new = target not in _db

    entry = _ensure_db_entry(target, web_sources=record.get("web_sources", []), timestamp=now)

    method = record.get("method")
    confidence = record.get("confidence", 0)
    verified = _is_alias_verified(method, confidence)

    entry["aliases"][source] = {
        "timestamp": now,
        "method": method,
        "confidence": confidence,
        "verified": verified
    }

    if record.get("web_sources"):
        entry["web_sources"] = record.get("web_sources", [])
        entry["last_updated"] = now

    _cache_metadata.add_incremental_update(
        source="backend_pipeline",
        records_added=1,
        identifiers_added=1 if is_new else 0,
        identifiers_updated=0 if is_new else 1,
    )

    save()


def rebuild():
    """
    Rebuild mode: Regenerate database from langfuse structure.

    Scans all traces and observations in logs/langfuse/ to build the match database.
    """
    global _db
    _db = {}

    langfuse_path = Path(__file__).parent.parent / "logs" / "langfuse"
    traces_path = langfuse_path / "traces"
    observations_path = langfuse_path / "observations"

    if not traces_path.exists():
        logger.warning("[MATCH_DB] No langfuse traces directory found")
        save()
        return 0

    logger.info("[MATCH_DB] Rebuilding from langfuse structure...")
    _cache_metadata.mark_rebuild_start("langfuse")

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

    identifiers_count = len(_db)
    aliases_count = sum(len(entry["aliases"]) for entry in _db.values())

    save()

    _cache_metadata.mark_rebuild_complete(
        source_type="langfuse",
        records_processed=total_records,
        identifiers_count=identifiers_count,
        aliases_count=aliases_count,
        data_sources=[{"type": "langfuse", "traces_loaded": total_records}],
    )

    logger.info(f"[MATCH_DB] Rebuilt from langfuse: {identifiers_count} identifiers, {total_records} records")
    return identifiers_count
