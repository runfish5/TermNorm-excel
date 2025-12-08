"""
Langfuse-compatible logging for TermNorm.

Directory structure:
    logs/langfuse/
    ├── traces/{trace_id}.json
    ├── observations/{trace_id}/{obs_id}.json
    ├── scores/{trace_id}.jsonl
    └── datasets/{dataset_name}/{item_id}.json
"""

import json
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime

BASE_PATH = Path("logs/langfuse")
DEFAULT_DATASET = "termnorm_ground_truth"
EVENTS_FILE = BASE_PATH / "events.jsonl"

# In-memory index for fast query->item_id lookups
_query_index: Dict[str, str] = {}
_index_loaded = False


def _log_event(event: Dict):
    """Append event to events.jsonl (simple flat log of all actions)."""
    _ensure_dirs()
    event["timestamp"] = datetime.utcnow().isoformat() + "Z"
    with open(EVENTS_FILE, "a") as f:
        f.write(json.dumps(event) + "\n")


def _generate_id(length: int = 32) -> str:
    """Generate datetime-prefixed ID for chronological sorting."""
    dt = datetime.utcnow().strftime("%y%m%d%H%M%S")
    return dt + uuid.uuid4().hex[:length - 12]


def _ensure_dirs():
    """Create directory structure if needed."""
    (BASE_PATH / "traces").mkdir(parents=True, exist_ok=True)
    (BASE_PATH / "observations").mkdir(parents=True, exist_ok=True)
    (BASE_PATH / "scores").mkdir(parents=True, exist_ok=True)
    (BASE_PATH / "datasets" / DEFAULT_DATASET).mkdir(parents=True, exist_ok=True)


# =============================================================================
# TRACES
# =============================================================================

def create_trace(
    name: str,
    input: Dict,
    user_id: str = None,
    session_id: str = None,
    metadata: Dict = None,
    tags: List[str] = None,
) -> str:
    """Create a new trace. Returns trace_id."""
    _ensure_dirs()
    trace_id = _generate_id()

    trace = {
        "id": trace_id,
        "name": name,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "input": input,
        "output": None,
        "user_id": user_id,
        "session_id": session_id,
        "metadata": metadata or {},
        "tags": tags or [],
    }

    path = BASE_PATH / "traces" / f"{trace_id}.json"
    path.write_text(json.dumps(trace, indent=2))
    return trace_id


def update_trace(trace_id: str, output: Dict = None, metadata: Dict = None):
    """Update trace with output and/or metadata."""
    path = BASE_PATH / "traces" / f"{trace_id}.json"
    if not path.exists():
        return

    trace = json.loads(path.read_text())
    if output is not None:
        trace["output"] = output
    if metadata:
        trace["metadata"] = {**trace.get("metadata", {}), **metadata}

    path.write_text(json.dumps(trace, indent=2))


def get_trace(trace_id: str) -> Optional[Dict]:
    """Get trace by ID."""
    path = BASE_PATH / "traces" / f"{trace_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


# =============================================================================
# OBSERVATIONS
# =============================================================================

def create_observation(
    trace_id: str,
    type: str,  # "span", "generation", "event"
    name: str,
    input: Any = None,
    output: Any = None,
    model: str = None,
    metadata: Dict = None,
) -> str:
    """Create observation linked to trace. Returns obs_id."""
    obs_id = f"obs-{uuid.uuid4().hex[:12]}"
    now = datetime.utcnow().isoformat() + "Z"

    observation = {
        "id": obs_id,
        "trace_id": trace_id,
        "type": type,
        "name": name,
        "start_time": now,
        "end_time": now,
        "input": input,
        "output": output,
        "metadata": metadata or {},
    }

    if type == "generation" and model:
        observation["model"] = model

    trace_dir = BASE_PATH / "observations" / trace_id
    trace_dir.mkdir(parents=True, exist_ok=True)
    (trace_dir / f"{obs_id}.json").write_text(json.dumps(observation, indent=2))

    return obs_id


# =============================================================================
# SCORES
# =============================================================================

def create_score(trace_id: str, name: str, value: Any, data_type: str = "NUMERIC"):
    """Add score to trace (appends to JSONL file)."""
    _ensure_dirs()
    score = {
        "id": f"score-{uuid.uuid4().hex[:8]}",
        "trace_id": trace_id,
        "name": name,
        "value": value,
        "data_type": data_type,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    path = BASE_PATH / "scores" / f"{trace_id}.jsonl"
    with open(path, "a") as f:
        f.write(json.dumps(score) + "\n")


# =============================================================================
# DATASET ITEMS
# =============================================================================

def _load_query_index():
    """Build query->item_id index from disk (once)."""
    global _index_loaded
    if _index_loaded:
        return

    datasets_dir = BASE_PATH / "datasets"
    if datasets_dir.exists():
        for item_file in datasets_dir.rglob("*.json"):
            try:
                item = json.loads(item_file.read_text())
                query = item.get("input", {}).get("query")
                if query:
                    _query_index[query] = item["id"]
            except (json.JSONDecodeError, KeyError):
                continue
    _index_loaded = True


def get_or_create_item(query: str, source_trace_id: str = None) -> str:
    """Get existing item for query or create new one. Returns item_id."""
    _load_query_index()
    _ensure_dirs()

    # Existing item?
    if query in _query_index:
        item_id = _query_index[query]
        if source_trace_id:
            _update_item_trace(item_id, source_trace_id)
        return item_id

    # Create new
    item_id = f"item-{_generate_id(24)}"
    item = {
        "id": item_id,
        "dataset_name": DEFAULT_DATASET,
        "input": {"query": query},
        "expected_output": None,
        "source_trace_id": source_trace_id,
        "metadata": {"created_at": datetime.utcnow().isoformat() + "Z"},
        "status": "ACTIVE",
    }

    path = BASE_PATH / "datasets" / DEFAULT_DATASET / f"{item_id}.json"
    path.write_text(json.dumps(item, indent=2))
    _query_index[query] = item_id
    return item_id


def _update_item_trace(item_id: str, trace_id: str):
    """Update item's source_trace_id."""
    path = BASE_PATH / "datasets" / DEFAULT_DATASET / f"{item_id}.json"
    if not path.exists():
        return

    item = json.loads(path.read_text())
    item["source_trace_id"] = trace_id
    item["metadata"]["updated_at"] = datetime.utcnow().isoformat() + "Z"
    path.write_text(json.dumps(item, indent=2))


def set_ground_truth(item_id: str, target: str) -> bool:
    """Set expected_output for dataset item."""
    path = BASE_PATH / "datasets" / DEFAULT_DATASET / f"{item_id}.json"
    if not path.exists():
        return False

    item = json.loads(path.read_text())
    item["expected_output"] = {"target": target}
    item["metadata"]["ground_truth_at"] = datetime.utcnow().isoformat() + "Z"
    path.write_text(json.dumps(item, indent=2))
    return True


def get_item_by_query(query: str) -> Optional[Dict]:
    """Get dataset item by query string."""
    _load_query_index()
    item_id = _query_index.get(query)
    if not item_id:
        return None

    path = BASE_PATH / "datasets" / DEFAULT_DATASET / f"{item_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


# =============================================================================
# HIGH-LEVEL API
# =============================================================================

def log_pipeline(record: Dict[str, Any], session_id: str = None) -> str:
    """
    Log full pipeline result.

    Creates trace, observations, scores, and dataset item.
    Returns trace_id.
    """
    query = record.get("source")

    # Create trace
    trace_id = create_trace(
        name="termnorm_pipeline",
        input={"query": query},
        user_id=session_id or "anonymous",
        session_id=session_id,
        metadata={
            "method": record.get("method"),
            "llm_provider": record.get("llm_provider"),
        },
        tags=["production"],
    )

    # Create dataset item linked to trace
    item_id = get_or_create_item(query, source_trace_id=trace_id)

    # Log to events.jsonl (flat log with IDs for navigation)
    _log_event({
        "event": "pipeline",
        "trace_id": trace_id,
        "item_id": item_id,
        "query": query,
        "target": record.get("target"),
        "method": record.get("method"),
        "confidence": record.get("confidence", 0),
        "latency_ms": record.get("total_time", 0) * 1000,
        "session_id": session_id,
    })

    # Add observations
    if record.get("web_sources"):
        create_observation(
            trace_id, "span", "web_search",
            input={"query": query},
            output={"sources": record["web_sources"], "count": len(record["web_sources"])},
        )

    if record.get("entity_profile"):
        create_observation(
            trace_id, "generation", "entity_profiling",
            model=record.get("llm_provider", "unknown"),
            input={"query": query},
            output=record["entity_profile"],
        )

    if record.get("token_matches"):
        create_observation(
            trace_id, "span", "token_matching",
            input={"profile": _profile_summary(record.get("entity_profile"))},
            output={"candidates": record["token_matches"], "count": len(record["token_matches"])},
        )

    if record.get("candidates"):
        create_observation(
            trace_id, "generation", "llm_ranking",
            model=record.get("llm_provider", "unknown"),
            input={"candidate_count": len(record.get("token_matches", []))},
            output={"ranked": record["candidates"], "top": record["target"]},
        )

    # Add scores
    create_score(trace_id, "confidence", record.get("confidence", 0))
    if record.get("total_time"):
        create_score(trace_id, "latency_ms", record["total_time"] * 1000)

    # Complete trace
    update_trace(trace_id, output={
        "target": record["target"],
        "method": record["method"],
        "confidence": record.get("confidence", 0),
    })

    return trace_id


def log_user_correction(source: str, target: str, method: str = "UserChoice") -> bool:
    """
    Log user correction and update ground truth.

    Returns True if successful.
    """
    item = get_item_by_query(source)
    trace_id = None
    item_id = None

    if item:
        item_id = item["id"]
        trace_id = item.get("source_trace_id")

        # Update ground truth
        set_ground_truth(item_id, target)

        # Add correction event to trace
        if trace_id:
            trace = get_trace(trace_id)
            prev_target = trace.get("output", {}).get("target") if trace else None

            create_observation(
                trace_id, "event", "user_correction",
                input={"previous_target": prev_target},
                output={"selected_target": target},
                metadata={"method": method},
            )

            update_trace(trace_id, output={
                "target": target,
                "method": method,
                "confidence": 1.0,
            })
    else:
        # Create new item with ground truth (no prior trace)
        item_id = get_or_create_item(source)
        set_ground_truth(item_id, target)

    # Log to events.jsonl (flat log with IDs for navigation)
    _log_event({
        "event": method,  # "UserChoice" or "DirectEdit"
        "trace_id": trace_id,  # None if no prior pipeline run
        "item_id": item_id,
        "query": source,
        "target": target,
    })

    return True


def _profile_summary(profile: Optional[Dict]) -> Optional[Dict]:
    """Extract lean summary from entity profile."""
    if not profile:
        return None
    return {
        "entity_name": profile.get("entity_name"),
        "core_concept": profile.get("core_concept"),
    }


# =============================================================================
# LEGACY COMPATIBILITY
# =============================================================================

def log_to_langfuse(record: Dict[str, Any], session_id: str = None) -> str:
    """Alias for log_pipeline."""
    return log_pipeline(record, session_id)


def log_to_experiments(record: Dict[str, Any]) -> str:
    """Legacy wrapper."""
    return log_pipeline(record, record.get("session_id"))
