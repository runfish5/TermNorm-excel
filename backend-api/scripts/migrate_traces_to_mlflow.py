"""
Migration script: Convert existing Langfuse-style traces to MLflow FileStore format.

This script:
1. Finds all existing trace-*.json files in experiments
2. Converts them to MLflow FileStore format (trace_info.yaml + subdirectories)
3. Places traces in experiment_id/traces/trace_id/ directory

MLflow FileStore trace structure:
    experiment_id/
        traces/
            trace_id/
                trace_info.yaml
                request_metadata/
                tags/
                artifacts/
                    traces.json

Run from backend-api directory:
    python scripts/migrate_traces_to_mlflow.py

Or with dry-run to see what would be migrated:
    python scripts/migrate_traces_to_mlflow.py --dry-run
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Any


def write_yaml(file_path: Path, data: Dict):
    """Write proper YAML format (matches MLflow FileStore)."""
    import yaml
    with open(file_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def convert_langfuse_to_mlflow_trace(langfuse_trace: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a Langfuse-style trace to MLflow native format.

    Langfuse format has observations/scores.
    MLflow format has info/data with spans.
    """
    trace_id = langfuse_trace.get("id", "unknown")

    # Extract timestamps
    start_time = langfuse_trace.get("start_time", 0)
    end_time = langfuse_trace.get("end_time", start_time)
    start_time_ns = int(start_time * 1_000_000_000) if start_time else 0
    end_time_ns = int(end_time * 1_000_000_000) if end_time else start_time_ns

    # Map status
    status = langfuse_trace.get("status", "SUCCESS")
    status_map = {
        "SUCCESS": "OK",
        "ERROR": "ERROR",
        "TIMEOUT": "ERROR",
        "RUNNING": "UNSET",
    }

    # Generate root span ID from trace ID (deterministic)
    root_span_id = trace_id[:16] if len(trace_id) >= 16 else trace_id.ljust(16, "0")

    # Build scores as attributes
    scores = langfuse_trace.get("scores", [])
    score_attrs = {f"score.{s['name']}": s["value"] for s in scores}

    # Build root span
    root_span = {
        "span_id": root_span_id,
        "trace_id": trace_id,
        "parent_id": None,
        "name": langfuse_trace.get("name", "termnorm_pipeline"),
        "start_time_ns": start_time_ns,
        "end_time_ns": end_time_ns,
        "status": {"status_code": status_map.get(status, "UNSET")},
        "inputs": langfuse_trace.get("input", {}),
        "outputs": langfuse_trace.get("output", {}),
        "attributes": {
            "session_id": langfuse_trace.get("metadata", {}).get("session_id"),
            "run_id": langfuse_trace.get("metadata", {}).get("run_id"),
            "experiment_id": langfuse_trace.get("metadata", {}).get("experiment_id"),
            **score_attrs,
        },
        "events": [],
        "span_type": "CHAIN",
    }

    # Convert observations to child spans
    child_spans = []
    observations = langfuse_trace.get("observations", [])

    span_type_map = {
        "span": "CHAIN",
        "generation": "LLM",
        "event": "UNKNOWN",
    }

    for i, obs in enumerate(observations):
        obs_start = obs.get("start_time", start_time)
        obs_end = obs.get("end_time", obs_start)

        # Generate deterministic span ID
        span_id = f"{trace_id[:8]}{i:08x}"

        child_span = {
            "span_id": span_id,
            "trace_id": trace_id,
            "parent_id": root_span_id,
            "name": obs.get("name", f"step_{i}"),
            "start_time_ns": int(obs_start * 1_000_000_000) if obs_start else start_time_ns,
            "end_time_ns": int(obs_end * 1_000_000_000) if obs_end else end_time_ns,
            "status": {"status_code": "OK"},
            "inputs": obs.get("input", {}),
            "outputs": obs.get("output", {}),
            "attributes": obs.get("metadata", {}),
            "events": [],
            "span_type": span_type_map.get(obs.get("type", "span"), "UNKNOWN"),
        }
        child_spans.append(child_span)

    # Build MLflow trace structure
    mlflow_trace = {
        "info": {
            "trace_id": trace_id,
            "experiment_id": langfuse_trace.get("metadata", {}).get("experiment_id", ""),
            "request_time": int(start_time * 1000) if start_time else 0,
            "execution_duration": int(langfuse_trace.get("latency_ms", 0)),
            "state": "OK" if status == "SUCCESS" else "ERROR",
            "request_preview": json.dumps(langfuse_trace.get("input", {})),
            "response_preview": json.dumps(langfuse_trace.get("output", {})),
            "trace_metadata": {
                "run_id": langfuse_trace.get("metadata", {}).get("run_id", ""),
                "session_id": langfuse_trace.get("metadata", {}).get("session_id", ""),
            },
            "tags": {},
        },
        "data": {
            "spans": [root_span] + child_spans,
        },
    }

    return mlflow_trace


def find_trace_files(experiments_path: Path) -> Dict[Path, List[Path]]:
    """
    Find all trace files organized by run artifacts directory.

    Returns: {artifacts_dir: [trace_files]}
    """
    results = {}

    for exp_dir in experiments_path.iterdir():
        if not exp_dir.is_dir() or exp_dir.name.startswith("."):
            continue

        # Check both old structure (with /runs/) and new structure (without)
        for run_dir in exp_dir.iterdir():
            if not run_dir.is_dir():
                continue

            # Skip special directories
            if run_dir.name in ("runs", "models"):
                # Check inside /runs/ for old structure
                if run_dir.name == "runs":
                    for old_run_dir in run_dir.iterdir():
                        if old_run_dir.is_dir():
                            traces_dir = old_run_dir / "artifacts" / "traces"
                            if traces_dir.exists():
                                trace_files = list(traces_dir.glob("trace-*.json"))
                                if trace_files:
                                    artifacts_dir = old_run_dir / "artifacts"
                                    results[artifacts_dir] = trace_files
                continue

            # New structure: run directories directly under experiment
            traces_dir = run_dir / "artifacts" / "traces"
            if traces_dir.exists():
                trace_files = list(traces_dir.glob("trace-*.json"))
                if trace_files:
                    artifacts_dir = run_dir / "artifacts"
                    results[artifacts_dir] = trace_files

    return results


def save_mlflow_filestore_trace(experiments_path: Path, experiment_id: str,
                                  langfuse_trace: Dict, dry_run: bool = False) -> bool:
    """
    Save a single trace in MLflow FileStore format.

    Creates: experiment_id/traces/trace_id/
                trace_info.yaml
                request_metadata/
                tags/
                artifacts/traces.json
    """
    trace_id = langfuse_trace.get("id", "unknown")

    # MLflow FileStore path
    mlflow_traces_path = experiments_path / experiment_id / "traces" / trace_id

    if mlflow_traces_path.exists():
        return False  # Already migrated

    if dry_run:
        return True  # Would create

    # Create directory structure
    mlflow_traces_path.mkdir(parents=True, exist_ok=True)
    (mlflow_traces_path / "request_metadata").mkdir(exist_ok=True)
    (mlflow_traces_path / "tags").mkdir(exist_ok=True)
    (mlflow_traces_path / "artifacts").mkdir(exist_ok=True)

    # Extract timestamps
    start_time = langfuse_trace.get("start_time", 0)
    latency_ms = langfuse_trace.get("latency_ms", 0)

    # Convert Unix timestamp to ISO 8601 string (required by MLflow)
    from datetime import datetime, timezone
    if start_time:
        request_time_str = datetime.fromtimestamp(start_time, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        request_time_str = datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")

    # Map status to MLflow TraceState string values
    status = langfuse_trace.get("status", "SUCCESS")
    status_map = {"SUCCESS": "OK", "ERROR": "ERROR", "TIMEOUT": "ERROR", "RUNNING": "IN_PROGRESS"}

    # Build trace_info.yaml with MLflow-compatible field names
    # See: mlflow/entities/trace_info.py TraceInfo.from_dict()
    trace_info = {
        "trace_id": trace_id,
        # trace_location must be a dict that TraceLocation.from_dict() can parse
        "trace_location": {
            "type": "MLFLOW_EXPERIMENT",
            "mlflow_experiment": {
                "experiment_id": experiment_id
            }
        },
        "request_time": request_time_str,  # Must be ISO 8601 string
        "execution_duration_ms": int(latency_ms) if latency_ms else None,
        "state": status_map.get(status, "OK"),
        "request_preview": json.dumps(langfuse_trace.get("input", {})),
        "response_preview": json.dumps(langfuse_trace.get("output", {})),
    }
    write_yaml(mlflow_traces_path / "trace_info.yaml", trace_info)

    # Write request_metadata
    metadata = langfuse_trace.get("metadata", {})
    for key, value in metadata.items():
        if value is not None:
            meta_file = mlflow_traces_path / "request_metadata" / key
            with open(meta_file, "w") as f:
                f.write(str(value))

    # Write tags
    # Artifact location uses file:// URI for MLflow FileStore compatibility
    # Must use absolute path for MLflow to find the artifacts
    artifacts_path = (mlflow_traces_path / "artifacts").resolve()
    artifact_uri = f"file:///{artifacts_path.as_posix()}"

    tags = {
        "mlflow.traceName": langfuse_trace.get("name", "termnorm_pipeline"),
        "mlflow.traceInputs": json.dumps(langfuse_trace.get("input", {})),
        "mlflow.traceOutputs": json.dumps(langfuse_trace.get("output", {})),
        "mlflow.artifactLocation": artifact_uri,  # Required for trace data access
    }
    for score in langfuse_trace.get("scores", []):
        tags[f"score.{score['name']}"] = str(score["value"])

    for key, value in tags.items():
        tag_file = mlflow_traces_path / "tags" / key
        with open(tag_file, "w") as f:
            f.write(str(value))

    # Save spans as artifact
    spans_data = convert_langfuse_to_mlflow_trace(langfuse_trace)
    spans_file = mlflow_traces_path / "artifacts" / "traces.json"
    with open(spans_file, "w") as f:
        json.dump(spans_data, f, indent=2)

    return True


def migrate_traces(experiments_path: Path, dry_run: bool = False) -> None:
    """
    Migrate all Langfuse-style traces to MLflow FileStore format.
    """
    trace_locations = find_trace_files(experiments_path)

    if not trace_locations:
        print("No trace files found to migrate.")
        return

    total_traces = sum(len(files) for files in trace_locations.values())
    print(f"Found {total_traces} trace files across {len(trace_locations)} runs.")

    for artifacts_dir, trace_files in trace_locations.items():
        # Extract experiment_id from path
        # Path is like: experiments/experiment_id/run_id/artifacts
        # or: experiments/experiment_id/runs/run_id/artifacts (old structure)
        path_parts = artifacts_dir.parts
        exp_idx = path_parts.index("experiments") if "experiments" in path_parts else -1
        if exp_idx >= 0 and exp_idx + 1 < len(path_parts):
            experiment_id = path_parts[exp_idx + 1]
        else:
            # Try to find experiment_id from the relative path
            experiment_id = artifacts_dir.parent.parent.name
            if experiment_id == "runs":
                experiment_id = artifacts_dir.parent.parent.parent.name

        print(f"\n{artifacts_dir}:")
        print(f"  Experiment: {experiment_id}")
        print(f"  Langfuse trace files: {len(trace_files)}")

        migrated = 0
        skipped = 0
        errors = 0

        for trace_file in trace_files:
            try:
                with open(trace_file, "r") as f:
                    langfuse_trace = json.load(f)

                # Get trace ID
                trace_id = langfuse_trace.get("id", "").replace("trace-", "")
                if not trace_id:
                    trace_id = trace_file.stem.replace("trace-", "")
                langfuse_trace["id"] = trace_id

                result = save_mlflow_filestore_trace(
                    experiments_path, experiment_id, langfuse_trace, dry_run
                )

                if result:
                    if dry_run:
                        print(f"    [DRY RUN] Would migrate {trace_file.name}")
                    else:
                        print(f"    Migrated {trace_file.name}")
                    migrated += 1
                else:
                    skipped += 1

            except Exception as e:
                print(f"    Error converting {trace_file.name}: {e}")
                errors += 1

        print(f"  Summary: {migrated} migrated, {skipped} skipped, {errors} errors")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Migrate Langfuse traces to MLflow format")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be migrated without writing")
    parser.add_argument("--path", type=str, default="logs/experiments", help="Path to experiments directory")
    args = parser.parse_args()

    experiments_path = Path(args.path)

    if not experiments_path.exists():
        print(f"Error: Experiments path does not exist: {experiments_path}")
        sys.exit(1)

    print(f"Migrating traces from: {experiments_path.absolute()}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("-" * 60)

    migrate_traces(experiments_path, dry_run=args.dry_run)

    print("\n" + "-" * 60)
    print("Migration complete!")
    if args.dry_run:
        print("Run without --dry-run to actually migrate.")


if __name__ == "__main__":
    main()
