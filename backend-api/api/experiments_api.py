"""
Experiment data API for external consumers (e.g., PromptPotter).

Reads MLflow-compatible experiment/run/trace data from logs/experiments/.
"""

from fastapi import APIRouter, Query, HTTPException
from pathlib import Path
import json

from utils.prompt_registry import get_prompt_registry
from api.responses import _ok

router = APIRouter(prefix="/experiments", tags=["experiments"])

EXPERIMENTS_PATH = Path("logs/experiments")
CONFIGS_PATH = Path("logs/configs/nodes")
DATASETS_PATH = Path("logs/langfuse/datasets")
TRACES_PATH = Path("logs/langfuse/traces")
OBSERVATIONS_PATH = Path("logs/langfuse/observations")
SCORES_PATH = Path("logs/langfuse/scores")


# ---------------------------------------------------------------------------
# Filesystem helpers (inlined from former ExperimentManager / RunManager)
# ---------------------------------------------------------------------------

def _read_yaml(file_path: Path) -> dict:
    """Read simple key: value YAML-like format."""
    data = {}
    try:
        for line in file_path.read_text().splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                value = value.strip().strip('"')
                try:
                    value = int(value)
                except ValueError:
                    if value == "None":
                        value = None
                data[key] = value
    except Exception:
        pass
    return data


def _read_experiment(experiment_id: str) -> dict | None:
    """Read experiment metadata from meta.yaml."""
    meta_file = EXPERIMENTS_PATH / experiment_id / "meta.yaml"
    if not meta_file.exists():
        return None
    return _read_yaml(meta_file)


def _list_experiments() -> list[dict]:
    """List all experiments with run counts."""
    if not EXPERIMENTS_PATH.exists():
        return []
    experiments = []
    for exp_dir in EXPERIMENTS_PATH.iterdir():
        if not exp_dir.is_dir():
            continue
        meta = _read_experiment(exp_dir.name)
        if meta:
            meta["num_runs"] = sum(
                1 for d in exp_dir.iterdir()
                if d.is_dir() and (d / "meta.yaml").exists()
            )
            experiments.append(meta)
    return sorted(experiments, key=lambda x: x.get("creation_time", 0))


def _load_dir_fields(run_path: Path) -> dict:
    """Load params, metrics, tags from MLflow directory format."""
    result = {"params": {}, "metrics": {}, "tags": {}}
    for field in ("params", "metrics", "tags"):
        field_dir = run_path / field
        if not field_dir.exists():
            continue
        for f in field_dir.iterdir():
            if not f.is_file():
                continue
            content = f.read_text().strip()
            if field == "metrics":
                # MLflow format: "timestamp value step\n" — take last line
                lines = content.splitlines()
                if lines:
                    parts = lines[-1].split()
                    if len(parts) >= 2:
                        try:
                            content = float(parts[1])
                        except ValueError:
                            content = parts[1]
            result[field][f.name] = content
    return result


def _list_runs(experiment_id: str) -> list[dict]:
    """List all runs in an experiment."""
    exp_path = EXPERIMENTS_PATH / experiment_id
    if not exp_path.exists():
        return []
    runs = []
    for run_dir in exp_path.iterdir():
        if not run_dir.is_dir():
            continue
        meta_file = run_dir / "meta.yaml"
        if not meta_file.exists():
            continue
        meta = _read_yaml(meta_file)
        meta.update(_load_dir_fields(run_dir))
        runs.append(meta)
    return sorted(runs, key=lambda x: x.get("start_time", 0), reverse=True)


def _get_run(experiment_id: str, run_id: str) -> dict | None:
    """Get full run details including artifacts list."""
    run_path = EXPERIMENTS_PATH / experiment_id / run_id
    meta_file = run_path / "meta.yaml"
    if not meta_file.exists():
        return None
    run = _read_yaml(meta_file)
    run.update(_load_dir_fields(run_path))
    artifacts_path = run_path / "artifacts"
    if artifacts_path.exists():
        run["artifacts"] = [f.name for f in artifacts_path.iterdir() if f.is_file()]
    return run


def _get_node_config(config_id: str) -> dict | None:
    """Read a config node JSON file."""
    config_file = CONFIGS_PATH / f"{config_id}.json"
    if not config_file.exists():
        return None
    try:
        return json.loads(config_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


# ---------------------------------------------------------------------------
# Experiment data helpers
# ---------------------------------------------------------------------------

def _parse_mappings_tsv(exp_path: Path) -> list[dict]:
    """Parse mappings.tsv into [{bom_material, dataset_entry}]."""
    tsv_file = exp_path / "mappings.tsv"
    if not tsv_file.exists():
        return []
    mappings = []
    for line in tsv_file.read_text(encoding="utf-8").strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if parts[0] == "Material name in BOM":
            continue
        mappings.append({
            "bom_material": parts[0].strip() if parts else "",
            "dataset_entry": parts[1].strip() if len(parts) > 1 else "",
        })
    return mappings


def _load_pipeline_data(run_path: Path) -> dict | None:
    """Read pipeline_config.json, derive notation string, extract config_id."""
    config_file = run_path / "artifacts" / "pipeline_config.json"
    if not config_file.exists():
        return None
    try:
        config = json.loads(config_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    notation_parts = []
    llm_counter = 0
    for step in config.get("steps", []):
        step_type = step.get("type", "")
        if step_type == "LLMGeneration":
            llm_counter += 1
            notation_parts.append(f"LLM{llm_counter}")
        elif step_type == "DeterministicFunction":
            name = step.get("name", "Function")
            notation_parts.append("".join(w.capitalize() for w in name.split("_")))
        else:
            notation_parts.append(step.get("name", step_type))

    return {
        "config": config,
        "notation": "-".join(notation_parts) if notation_parts else None,
        "config_id": config.get("version"),
    }


def _load_evaluation_results(run_path: Path) -> list[dict]:
    """Parse evaluation_results.jsonl."""
    results_file = run_path / "artifacts" / "evaluation_results.jsonl"
    if not results_file.exists():
        return []
    results = []
    for line in results_file.read_text(encoding="utf-8").strip().split("\n"):
        if not line.strip():
            continue
        try:
            results.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return results


def _load_run_traces(run_path: Path) -> list[dict]:
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


def _resolve_dependencies(runs_pipeline_data: list[dict | None]) -> dict:
    """Resolve prompts + node configs from ConfigTreeManager and PromptRegistry."""
    prompt_registry = get_prompt_registry()
    prompts = {}
    node_configs = {}
    unresolved_prompts = []

    for pipeline_data in runs_pipeline_data:
        if pipeline_data is None:
            continue
        config = pipeline_data["config"]
        config_id = pipeline_data["config_id"]

        if config_id and config_id not in node_configs:
            node_config = _get_node_config(config_id)
            if node_config:
                node_configs[config_id] = node_config

        for step in config.get("steps", []):
            if step.get("type") != "LLMGeneration":
                continue
            step_config = step.get("config", {})
            family = step.get("name", "")
            prompt_version_str = step_config.get("prompt_version", "")
            prompt_key = f"{family}/{prompt_version_str}"

            if prompt_key in prompts or prompt_key in unresolved_prompts:
                continue
            try:
                version = None
                if prompt_version_str and prompt_version_str.replace("v", "").isdigit():
                    version = int(prompt_version_str.replace("v", ""))
                template = prompt_registry.get_prompt(family, version)
                metadata = prompt_registry.get_metadata(family, version)
                prompts[prompt_key] = {"family": family, "version": version, "template": template, **metadata}
            except FileNotFoundError:
                unresolved_prompts.append(prompt_key)

    return {"prompts": prompts, "node_configs": node_configs, "unresolved_prompts": unresolved_prompts}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_experiments_endpoint():
    return {"experiments": _list_experiments(), "total": len(_list_experiments())}


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str):
    experiment = _read_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")
    runs = _list_runs(experiment_id)
    return {"experiment": experiment, "runs": runs, "total_runs": len(runs)}


@router.get("/{experiment_id}/runs")
async def list_runs_endpoint(
    experiment_id: str,
    limit: int = Query(50, le=200, ge=1),
    offset: int = Query(0, ge=0),
):
    experiment = _read_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")
    all_runs = _list_runs(experiment_id)
    return {"runs": all_runs[offset:offset + limit], "total": len(all_runs), "limit": limit, "offset": offset}


@router.get("/{experiment_id}/runs/{run_id}")
async def get_run_endpoint(experiment_id: str, run_id: str):
    experiment = _read_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")
    run = _get_run(experiment_id, run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return {"run": run}


@router.get("/{experiment_id}/traces")
async def list_traces(
    experiment_id: str,
    limit: int = Query(100, le=500, ge=1),
    offset: int = Query(0, ge=0),
):
    experiment = _read_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    traces_path = Path("logs/experiments") / experiment_id / "traces"
    if not traces_path.exists():
        return {"traces": [], "total": 0, "limit": limit, "offset": offset}

    traces = []
    for trace_dir in traces_path.iterdir():
        if not trace_dir.is_dir():
            continue
        trace_info_file = trace_dir / "trace_info.yaml"
        if not trace_info_file.exists():
            continue
        trace_info = _read_yaml(trace_info_file)
        trace_info["trace_id"] = trace_dir.name
        tags_dir = trace_dir / "tags"
        if tags_dir.exists():
            trace_info["tags"] = {f.name: f.read_text().strip() for f in tags_dir.iterdir() if f.is_file()}
        traces.append(trace_info)

    traces.sort(key=lambda t: t.get("request_time", ""), reverse=True)
    return {"traces": traces[offset:offset + limit], "total": len(traces), "limit": limit, "offset": offset}


@router.get("/{experiment_id}/traces/{trace_id}")
async def get_trace(experiment_id: str, trace_id: str):
    trace_path = Path("logs/experiments") / experiment_id / "traces" / trace_id
    if not trace_path.exists():
        raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")

    trace_info = _read_yaml(trace_path / "trace_info.yaml")
    trace_info["trace_id"] = trace_id

    metadata_dir = trace_path / "request_metadata"
    trace_info["request_metadata"] = {}
    if metadata_dir.exists():
        trace_info["request_metadata"] = {f.name: f.read_text().strip() for f in metadata_dir.iterdir() if f.is_file()}

    tags_dir = trace_path / "tags"
    trace_info["tags"] = {}
    if tags_dir.exists():
        trace_info["tags"] = {f.name: f.read_text().strip() for f in tags_dir.iterdir() if f.is_file()}

    spans_file = trace_path / "artifacts" / "traces.json"
    trace_info["spans"] = []
    if spans_file.exists():
        try:
            trace_info["spans"] = json.loads(spans_file.read_text()).get("spans", [])
        except json.JSONDecodeError:
            pass

    return {"trace": trace_info}


@router.get("/{experiment_id}/traces/{trace_id}/langfuse")
async def get_trace_langfuse_format(experiment_id: str, trace_id: str):
    exp_path = Path("logs/experiments") / experiment_id
    if not exp_path.exists():
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    for run_dir in exp_path.iterdir():
        if run_dir.is_dir() and run_dir.name not in ("traces", "tags"):
            trace_file = run_dir / "artifacts" / "traces" / f"trace-{trace_id}.json"
            if trace_file.exists():
                try:
                    return {"trace": json.loads(trace_file.read_text()), "format": "langfuse"}
                except json.JSONDecodeError:
                    raise HTTPException(status_code=500, detail="Failed to parse trace file")

    raise HTTPException(status_code=404, detail=f"Langfuse trace {trace_id} not found")


@router.get("/{experiment_id}/mappings")
async def get_experiment_mappings(
    experiment_id: str,
    include_traces: bool = Query(False),
):
    experiment = _read_experiment(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id} not found")

    exp_path = EXPERIMENTS_PATH / experiment_id
    mappings = _parse_mappings_tsv(exp_path)
    raw_runs = _list_runs(experiment_id)

    runs = []
    pipeline_data_list = []
    for run in raw_runs:
        run_id = run.get("run_id", "")
        run_path = exp_path / run_id
        pipeline_data = _load_pipeline_data(run_path)
        pipeline_data_list.append(pipeline_data)
        evaluation_results = _load_evaluation_results(run_path)
        traces = _load_run_traces(run_path) if include_traces else []
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
            "trace_count": len(traces) if include_traces else None,
        })

    return {
        "experiment": experiment,
        "mappings": mappings,
        "mappings_count": len(mappings),
        "runs": runs,
        "total_runs": len(runs),
        "dependencies": _resolve_dependencies(pipeline_data_list),
        "include_traces": include_traces,
    }


# ---------------------------------------------------------------------------
# Datasets API (Langfuse-compatible ground truth)
# ---------------------------------------------------------------------------

@router.get("/datasets")
async def list_datasets():
    datasets = []
    if DATASETS_PATH.exists():
        for d in DATASETS_PATH.iterdir():
            if d.is_dir():
                datasets.append({"name": d.name, "item_count": len(list(d.glob("item-*.json")))})
    return {"datasets": datasets, "total": len(datasets)}


@router.get("/datasets/{dataset_name}")
async def get_dataset(
    dataset_name: str,
    limit: int = Query(100, le=500, ge=1),
    offset: int = Query(0, ge=0),
):
    dataset_path = DATASETS_PATH / dataset_name
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")

    items = []
    for item_file in sorted(dataset_path.glob("item-*.json"), reverse=True):
        try:
            items.append(json.loads(item_file.read_text()))
        except json.JSONDecodeError:
            continue

    return {"dataset_name": dataset_name, "items": items[offset:offset + limit], "total": len(items), "limit": limit, "offset": offset}


@router.get("/datasets/{dataset_name}/items/{item_id}")
async def get_dataset_item(dataset_name: str, item_id: str):
    dataset_path = DATASETS_PATH / dataset_name
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
    if not item_id.startswith("item-"):
        item_id = f"item-{item_id}"
    item_file = dataset_path / f"{item_id}.json"
    if not item_file.exists():
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found in dataset '{dataset_name}'")
    try:
        return {"item": json.loads(item_file.read_text())}
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse item file")


@router.get("/datasets/{dataset_name}/items/{item_id}/full")
async def get_dataset_item_full(dataset_name: str, item_id: str):
    dataset_path = DATASETS_PATH / dataset_name
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
    if not item_id.startswith("item-"):
        item_id = f"item-{item_id}"
    item_file = dataset_path / f"{item_id}.json"
    if not item_file.exists():
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found")
    try:
        item_data = json.loads(item_file.read_text())
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse item file")

    result = {"item": item_data, "trace": None, "observations": [], "scores": []}
    source_trace_id = item_data.get("source_trace_id")
    if source_trace_id:
        trace_file = TRACES_PATH / f"{source_trace_id}.json"
        if trace_file.exists():
            try:
                result["trace"] = json.loads(trace_file.read_text())
            except json.JSONDecodeError:
                pass
        obs_dir = OBSERVATIONS_PATH / source_trace_id
        if obs_dir.exists():
            for obs_file in obs_dir.glob("*.json"):
                try:
                    result["observations"].append(json.loads(obs_file.read_text()))
                except json.JSONDecodeError:
                    continue
        scores_file = SCORES_PATH / f"{source_trace_id}.jsonl"
        if scores_file.exists():
            try:
                for line in scores_file.read_text().strip().split("\n"):
                    if line:
                        result["scores"].append(json.loads(line))
            except (json.JSONDecodeError, Exception):
                pass

    return result
