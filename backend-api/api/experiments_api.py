"""
Experiment data API for external consumers (e.g., PromptPotter).

Exposes MLflow-compatible experiment/run/trace data stored in logs/experiments/.
Uses the existing ExperimentManager, RunManager, and TraceLogger infrastructure.
"""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List, Dict, Any
from pathlib import Path
import json

from utils.standards_logger import ExperimentManager, RunManager, ConfigTreeManager
from utils.prompt_registry import get_prompt_registry

router = APIRouter(prefix="/experiments", tags=["experiments"])

# Initialize managers
experiment_manager = ExperimentManager()
config_tree_manager = ConfigTreeManager()


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


# =============================================================================
# Mappings API (full experiment data package for PromptPotter)
# =============================================================================

def _parse_mappings_tsv(exp_path: Path) -> List[Dict[str, str]]:
    """Parse mappings.tsv into [{bom_material, dataset_entry}]."""
    tsv_file = exp_path / "mappings.tsv"
    if not tsv_file.exists():
        return []

    mappings = []
    lines = tsv_file.read_text(encoding="utf-8").strip().split("\n")
    for line in lines:
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        # Skip header row if present
        if parts[0] == "Material name in BOM":
            continue
        mappings.append({
            "bom_material": parts[0].strip() if len(parts) > 0 else "",
            "dataset_entry": parts[1].strip() if len(parts) > 1 else "",
        })
    return mappings


def _load_pipeline_data(run_path: Path) -> Optional[Dict[str, Any]]:
    """Read pipeline_config.json, derive notation string, extract config_id."""
    config_file = run_path / "artifacts" / "pipeline_config.json"
    if not config_file.exists():
        return None

    try:
        config = json.loads(config_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    # Derive shorthand notation from steps (e.g. "LLM1-TokenMatching-LLM2")
    notation_parts = []
    llm_counter = 0
    for step in config.get("steps", []):
        step_type = step.get("type", "")
        if step_type == "LLMGeneration":
            llm_counter += 1
            notation_parts.append(f"LLM{llm_counter}")
        elif step_type == "DeterministicFunction":
            # Use the step name in PascalCase
            name = step.get("name", "Function")
            notation_parts.append(
                "".join(w.capitalize() for w in name.split("_"))
            )
        else:
            notation_parts.append(step.get("name", step_type))

    notation = "-".join(notation_parts) if notation_parts else None

    # Extract config_id from version or metadata
    config_id = config.get("version")

    return {
        "config": config,
        "notation": notation,
        "config_id": config_id,
    }


def _load_evaluation_results(run_path: Path) -> List[Dict[str, Any]]:
    """Parse evaluation_results.jsonl into list of dicts."""
    results_file = run_path / "artifacts" / "evaluation_results.jsonl"
    if not results_file.exists():
        return []

    results = []
    for line in results_file.read_text(encoding="utf-8").strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            results.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return results


def _load_run_traces(run_path: Path) -> List[Dict[str, Any]]:
    """Read all trace-*.json from artifacts/traces/."""
    traces_dir = run_path / "artifacts" / "traces"
    if not traces_dir.exists():
        return []

    traces = []
    for trace_file in sorted(traces_dir.glob("trace-*.json")):
        try:
            traces.append(json.loads(trace_file.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    return traces


def _resolve_dependencies(
    runs_pipeline_data: List[Optional[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Resolve prompts + node configs from ConfigTreeManager and PromptRegistry."""
    prompt_registry = get_prompt_registry()
    prompts: Dict[str, Any] = {}
    node_configs: Dict[str, Any] = {}
    unresolved_prompts: List[str] = []

    for pipeline_data in runs_pipeline_data:
        if pipeline_data is None:
            continue

        config = pipeline_data["config"]
        config_id = pipeline_data["config_id"]

        # Resolve node config
        if config_id and config_id not in node_configs:
            node_config = config_tree_manager.get_config(config_id)
            if node_config:
                node_configs[config_id] = node_config

        # Find prompt families referenced in pipeline steps
        for step in config.get("steps", []):
            step_config = step.get("config", {})
            step_name = step.get("name", "")

            # Check if this step references a prompt (LLMGeneration steps)
            if step.get("type") != "LLMGeneration":
                continue

            prompt_version_str = step_config.get("prompt_version", "")
            # Use the step name as the prompt family
            family = step_name
            prompt_key = f"{family}/{prompt_version_str}"

            if prompt_key in prompts or prompt_key in unresolved_prompts:
                continue

            try:
                # Try numeric version first, fall back to latest
                version = None
                if prompt_version_str and prompt_version_str.replace("v", "").isdigit():
                    version = int(prompt_version_str.replace("v", ""))

                template = prompt_registry.get_prompt(family, version)
                metadata = prompt_registry.get_metadata(family, version)
                prompts[prompt_key] = {
                    "family": family,
                    "version": version,
                    "template": template,
                    **metadata,
                }
            except FileNotFoundError:
                unresolved_prompts.append(prompt_key)

    return {
        "prompts": prompts,
        "node_configs": node_configs,
        "unresolved_prompts": unresolved_prompts,
    }


@router.get("/{experiment_id}/mappings")
async def get_experiment_mappings(
    experiment_id: str,
    include_traces: bool = Query(False),
):
    """
    Get full experiment data package — metadata, runs, mappings, and resolved dependencies.

    Returns experiment metadata, ground-truth mappings, all runs with pipeline configs
    and evaluation results, and resolved prompt/node config dependencies.
    """
    experiment = experiment_manager.get_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    exp_path = Path("logs/experiments") / experiment_id

    # Parse ground-truth mappings
    mappings = _parse_mappings_tsv(exp_path)

    # Get all runs
    run_manager = RunManager(experiment_id)
    raw_runs = run_manager.list_runs()

    # Enrich each run with pipeline, evaluation, and trace data
    runs = []
    pipeline_data_list = []

    for run in raw_runs:
        run_id = run.get("run_id", "")
        run_path = exp_path / run_id

        # Load pipeline data
        pipeline_data = _load_pipeline_data(run_path)
        pipeline_data_list.append(pipeline_data)

        # Load evaluation results
        evaluation_results = _load_evaluation_results(run_path)

        # Load traces (conditionally)
        traces = _load_run_traces(run_path) if include_traces else []
        trace_count = len(traces) if include_traces else None

        runs.append({
            "run_id": run_id,
            "run_name": run.get("run_name", ""),
            "status": run.get("status"),
            "params": run.get("params", {}),
            "metrics": run.get("metrics", {}),
            "tags": run.get("tags", {}),
            "pipeline": {
                "config": pipeline_data["config"] if pipeline_data else None,
                "notation": pipeline_data["notation"] if pipeline_data else None,
                "config_id": pipeline_data["config_id"] if pipeline_data else None,
            },
            "evaluation_results": evaluation_results,
            "evaluation_count": len(evaluation_results),
            "traces": traces,
            "trace_count": trace_count,
        })

    # Resolve cross-referenced dependencies
    dependencies = _resolve_dependencies(pipeline_data_list)

    return {
        "experiment": experiment,
        "mappings": mappings,
        "mappings_count": len(mappings),
        "runs": runs,
        "total_runs": len(runs),
        "dependencies": dependencies,
        "include_traces": include_traces,
    }


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


# =============================================================================
# Datasets API (Langfuse-compatible ground truth datasets)
# =============================================================================

DATASETS_PATH = Path("logs/langfuse/datasets")
TRACES_PATH = Path("logs/langfuse/traces")
OBSERVATIONS_PATH = Path("logs/langfuse/observations")
SCORES_PATH = Path("logs/langfuse/scores")


@router.get("/datasets")
async def list_datasets():
    """
    List all datasets.

    Returns dataset names with item counts from logs/langfuse/datasets/.
    """
    datasets = []
    if DATASETS_PATH.exists():
        for dataset_dir in DATASETS_PATH.iterdir():
            if dataset_dir.is_dir():
                items = list(dataset_dir.glob("item-*.json"))
                datasets.append({
                    "name": dataset_dir.name,
                    "item_count": len(items)
                })
    return {"datasets": datasets, "total": len(datasets)}


@router.get("/datasets/{dataset_name}")
async def get_dataset(
    dataset_name: str,
    limit: int = Query(100, le=500, ge=1),
    offset: int = Query(0, ge=0),
):
    """
    Get all items in a dataset with pagination.

    Returns dataset items from logs/langfuse/datasets/{dataset_name}/.
    """
    dataset_path = DATASETS_PATH / dataset_name
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")

    items = []
    for item_file in sorted(dataset_path.glob("item-*.json"), reverse=True):
        try:
            item_data = json.loads(item_file.read_text())
            items.append(item_data)
        except json.JSONDecodeError:
            continue

    # Apply pagination
    total = len(items)
    paginated = items[offset:offset + limit]

    return {
        "dataset_name": dataset_name,
        "items": paginated,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/datasets/{dataset_name}/items/{item_id}")
async def get_dataset_item(dataset_name: str, item_id: str):
    """
    Get a single dataset item.

    Returns the item data from logs/langfuse/datasets/{dataset_name}/{item_id}.json
    """
    dataset_path = DATASETS_PATH / dataset_name
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")

    # Handle both "item-xxx" and "xxx" formats
    if not item_id.startswith("item-"):
        item_id = f"item-{item_id}"

    item_file = dataset_path / f"{item_id}.json"
    if not item_file.exists():
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found in dataset '{dataset_name}'")

    try:
        item_data = json.loads(item_file.read_text())
        return {"item": item_data}
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse item file")


@router.get("/datasets/{dataset_name}/items/{item_id}/full")
async def get_dataset_item_full(dataset_name: str, item_id: str):
    """
    Get a dataset item with all linked data.

    Returns:
    - item: The dataset item
    - trace: The linked trace (from source_trace_id)
    - observations: All observations for that trace
    - scores: All scores for that trace
    """
    dataset_path = DATASETS_PATH / dataset_name
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")

    # Handle both "item-xxx" and "xxx" formats
    if not item_id.startswith("item-"):
        item_id = f"item-{item_id}"

    item_file = dataset_path / f"{item_id}.json"
    if not item_file.exists():
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found")

    try:
        item_data = json.loads(item_file.read_text())
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse item file")

    result = {
        "item": item_data,
        "trace": None,
        "observations": [],
        "scores": []
    }

    # Load linked trace
    source_trace_id = item_data.get("source_trace_id")
    if source_trace_id:
        trace_file = TRACES_PATH / f"{source_trace_id}.json"
        if trace_file.exists():
            try:
                result["trace"] = json.loads(trace_file.read_text())
            except json.JSONDecodeError:
                pass

        # Load observations for this trace
        obs_dir = OBSERVATIONS_PATH / source_trace_id
        if obs_dir.exists():
            for obs_file in obs_dir.glob("*.json"):
                try:
                    obs_data = json.loads(obs_file.read_text())
                    result["observations"].append(obs_data)
                except json.JSONDecodeError:
                    continue

        # Load scores for this trace
        scores_file = SCORES_PATH / f"{source_trace_id}.jsonl"
        if scores_file.exists():
            try:
                for line in scores_file.read_text().strip().split("\n"):
                    if line:
                        result["scores"].append(json.loads(line))
            except (json.JSONDecodeError, Exception):
                pass

    return result
