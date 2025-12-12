"""
Experiment data API for external consumers (e.g., PromptPotter).

Exposes MLflow-compatible experiment/run/trace data stored in logs/experiments/.
Uses the existing ExperimentManager, RunManager, and TraceLogger infrastructure.
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List, Dict, Any
from pathlib import Path
import json

from utils.standards_logger import ExperimentManager, RunManager

router = APIRouter(prefix="/experiments", tags=["experiments"])

# Initialize managers
experiment_manager = ExperimentManager()


@router.get("")
async def list_experiments():
    """
    List all experiments.

    Returns experiments with metadata and run counts.
    """
    experiments = experiment_manager.list_experiments()
    return {
        "experiments": experiments,
        "total": len(experiments),
    }


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str):
    """
    Get experiment details including all runs.

    Returns experiment metadata with full run list.
    """
    experiment = experiment_manager.get_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    # Get runs for this experiment
    run_manager = RunManager(experiment_id)
    runs = run_manager.list_runs()

    return {
        "experiment": experiment,
        "runs": runs,
        "total_runs": len(runs),
    }


@router.get("/{experiment_id}/runs")
async def list_runs(
    experiment_id: str,
    limit: int = Query(50, le=200, ge=1),
    offset: int = Query(0, ge=0),
):
    """
    List runs in an experiment with pagination.
    """
    experiment = experiment_manager.get_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    run_manager = RunManager(experiment_id)
    all_runs = run_manager.list_runs()

    # Apply pagination
    paginated = all_runs[offset:offset + limit]

    return {
        "runs": paginated,
        "total": len(all_runs),
        "limit": limit,
        "offset": offset,
    }


@router.get("/{experiment_id}/runs/{run_id}")
async def get_run(experiment_id: str, run_id: str):
    """
    Get full run details including params, metrics, tags, and artifacts.
    """
    experiment = experiment_manager.get_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    run_manager = RunManager(experiment_id)
    run = run_manager.get_run(run_id)

    if not run:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    return {"run": run}


@router.get("/{experiment_id}/traces")
async def list_traces(
    experiment_id: str,
    limit: int = Query(100, le=500, ge=1),
    offset: int = Query(0, ge=0),
):
    """
    List all traces in an experiment.

    Reads from logs/experiments/{experiment_id}/traces/
    """
    experiment = experiment_manager.get_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    traces_path = Path("logs/experiments") / experiment_id / "traces"
    if not traces_path.exists():
        return {"traces": [], "total": 0, "limit": limit, "offset": offset}

    traces = []
    for trace_dir in traces_path.iterdir():
        if trace_dir.is_dir():
            trace_info_file = trace_dir / "trace_info.yaml"
            if trace_info_file.exists():
                trace_info = _read_yaml(trace_info_file)
                trace_info["trace_id"] = trace_dir.name

                # Load tags
                tags_dir = trace_dir / "tags"
                if tags_dir.exists():
                    trace_info["tags"] = {}
                    for tag_file in tags_dir.iterdir():
                        if tag_file.is_file():
                            trace_info["tags"][tag_file.name] = tag_file.read_text().strip()

                traces.append(trace_info)

    # Sort by request_time descending (newest first)
    traces.sort(key=lambda t: t.get("request_time", ""), reverse=True)

    # Apply pagination
    total = len(traces)
    paginated = traces[offset:offset + limit]

    return {
        "traces": paginated,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{experiment_id}/traces/{trace_id}")
async def get_trace(experiment_id: str, trace_id: str):
    """
    Get full trace details including spans and artifacts.
    """
    trace_path = Path("logs/experiments") / experiment_id / "traces" / trace_id

    if not trace_path.exists():
        raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")

    # Load trace_info.yaml
    trace_info_file = trace_path / "trace_info.yaml"
    if not trace_info_file.exists():
        raise HTTPException(status_code=404, detail=f"Trace info not found for {trace_id}")

    trace_info = _read_yaml(trace_info_file)
    trace_info["trace_id"] = trace_id

    # Load request_metadata
    metadata_dir = trace_path / "request_metadata"
    trace_info["request_metadata"] = {}
    if metadata_dir.exists():
        for meta_file in metadata_dir.iterdir():
            if meta_file.is_file():
                trace_info["request_metadata"][meta_file.name] = meta_file.read_text().strip()

    # Load tags
    tags_dir = trace_path / "tags"
    trace_info["tags"] = {}
    if tags_dir.exists():
        for tag_file in tags_dir.iterdir():
            if tag_file.is_file():
                trace_info["tags"][tag_file.name] = tag_file.read_text().strip()

    # Load spans from artifacts/traces.json
    spans_file = trace_path / "artifacts" / "traces.json"
    trace_info["spans"] = []
    if spans_file.exists():
        try:
            spans_data = json.loads(spans_file.read_text())
            trace_info["spans"] = spans_data.get("spans", [])
        except json.JSONDecodeError:
            pass

    return {"trace": trace_info}


@router.get("/{experiment_id}/traces/{trace_id}/langfuse")
async def get_trace_langfuse_format(experiment_id: str, trace_id: str):
    """
    Get trace in Langfuse-compatible format (from run artifacts).

    Looks for trace-{trace_id}.json in run artifacts/traces/ directories.
    """
    exp_path = Path("logs/experiments") / experiment_id

    if not exp_path.exists():
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    # Search for the trace file in run artifacts
    for run_dir in exp_path.iterdir():
        if run_dir.is_dir() and run_dir.name != "traces" and run_dir.name != "tags":
            trace_file = run_dir / "artifacts" / "traces" / f"trace-{trace_id}.json"
            if trace_file.exists():
                try:
                    trace_data = json.loads(trace_file.read_text())
                    return {"trace": trace_data, "format": "langfuse"}
                except json.JSONDecodeError:
                    raise HTTPException(status_code=500, detail="Failed to parse trace file")

    raise HTTPException(status_code=404, detail=f"Langfuse trace {trace_id} not found")


def _read_yaml(file_path: Path) -> Dict:
    """Read simple YAML-like format."""
    data = {}
    try:
        with open(file_path) as f:
            for line in f:
                if ":" in line:
                    key, value = line.strip().split(":", 1)
                    value = value.strip().strip('"')
                    # Try to convert to int
                    try:
                        value = int(value)
                    except ValueError:
                        if value == "None":
                            value = None
                    data[key] = value
    except Exception:
        pass
    return data
