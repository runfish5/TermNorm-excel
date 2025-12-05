"""
Standards-compliant logging infrastructure for TermNorm.

Implements MLflow/Langfuse/DSPy-compatible file formats without adding dependencies.
Supports multi-step workflow evaluation with intermediate results tracking.
"""

import json
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone


class ExperimentManager:
    """Manages experiments (create, get, list) in MLflow-compatible format."""

    def __init__(self, base_path: str = "logs/experiments"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def create_experiment(self, name: str, description: str = "") -> str:
        """
        Create a new experiment.

        Returns:
            experiment_id: Directory name (e.g., "0_production_historical")
        """
        # Find next experiment ID
        existing_experiments = list(self.base_path.iterdir())
        if existing_experiments:
            max_id = max(
                int(exp.name.split("_")[0])
                for exp in existing_experiments
                if exp.is_dir() and exp.name[0].isdigit()
            )
            next_id = max_id + 1
        else:
            next_id = 0

        # Sanitize name for directory
        safe_name = name.replace(" ", "_").replace("/", "_").replace("\\", "_")
        experiment_id = f"{next_id}_{safe_name}"
        exp_path = self.base_path / experiment_id

        # Create experiment directory
        exp_path.mkdir(parents=True, exist_ok=True)

        # Create meta.yaml (MLflow format)
        meta = {
            "experiment_id": experiment_id,
            "name": name,
            "description": description,
            "artifact_location": str(exp_path),
            "lifecycle_stage": "active",
            "creation_time": int(time.time() * 1000),
            "last_update_time": int(time.time() * 1000),
        }

        with open(exp_path / "meta.yaml", "w") as f:
            # Write as YAML-compatible format
            for key, value in meta.items():
                if isinstance(value, str):
                    f.write(f'{key}: "{value}"\n')
                else:
                    f.write(f"{key}: {value}\n")

        return experiment_id

    def get_experiment(self, experiment_id: str) -> Optional[Dict]:
        """Get experiment metadata."""
        exp_path = self.base_path / experiment_id
        meta_file = exp_path / "meta.yaml"

        if not meta_file.exists():
            return None

        # Parse YAML-like format
        meta = {}
        with open(meta_file) as f:
            for line in f:
                if ":" in line:
                    key, value = line.strip().split(":", 1)
                    value = value.strip().strip('"')
                    # Try to convert to int
                    try:
                        value = int(value)
                    except ValueError:
                        pass
                    meta[key] = value

        return meta

    def get_or_create(self, name: str, description: str = "") -> str:
        """Get existing experiment by name or create new one."""
        experiments = self.list_experiments()
        for exp in experiments:
            if exp["name"] == name:
                return exp["experiment_id"]

        return self.create_experiment(name, description)

    def list_experiments(self) -> List[Dict]:
        """List all experiments."""
        experiments = []
        for exp_dir in self.base_path.iterdir():
            if exp_dir.is_dir():
                meta = self.get_experiment(exp_dir.name)
                if meta:
                    # Count runs (run directories are directly under experiment, not /runs/)
                    # Each run is a subdirectory with a meta.yaml file
                    num_runs = sum(
                        1 for d in exp_dir.iterdir()
                        if d.is_dir() and (d / "meta.yaml").exists()
                    )
                    meta["num_runs"] = num_runs
                    experiments.append(meta)

        return sorted(experiments, key=lambda x: x["creation_time"])


class RunManager:
    """Manages runs within an experiment."""

    def __init__(self, experiment_id: str, base_path: str = "logs/experiments"):
        self.experiment_id = experiment_id
        self.base_path = Path(base_path) / experiment_id
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.current_run_id: Optional[str] = None

    def start_run(
        self, run_name: str, params: Dict = None, tags: Dict = None
    ) -> str:
        """
        Start a new run.

        Args:
            run_name: Human-readable run name
            params: Parameters for this run (model, temperature, etc.)
            tags: Tags for categorization (source, verified, etc.)

        Returns:
            run_id: Unique run identifier
        """
        run_id = str(uuid.uuid4())[:8]  # Short UUID
        self.current_run_id = run_id

        run_path = self.base_path / run_id
        run_path.mkdir(parents=True, exist_ok=True)
        (run_path / "artifacts").mkdir(exist_ok=True)
        (run_path / "artifacts" / "traces").mkdir(exist_ok=True)

        # Create meta.yaml with all MLflow-required RunInfo fields
        artifacts_path = (run_path / "artifacts").resolve()
        meta = {
            "run_id": run_id,
            "run_uuid": run_id,  # MLflow expects run_uuid = run_id
            "run_name": run_name,
            "experiment_id": self.experiment_id,
            "status": 1,  # 1=RUNNING, 3=FINISHED (MLflow requires numeric)
            "start_time": int(time.time() * 1000),
            "end_time": None,
            "lifecycle_stage": "active",
            "source_type": 4,  # LOCAL (MLflow SourceType enum)
            "source_name": "",
            "source_version": "",
            "entry_point_name": "",
            "user_id": "system",
            "artifact_uri": f"file:///{artifacts_path.as_posix()}",
            "tags": [],
        }

        self._write_yaml(run_path / "meta.yaml", meta)

        # Save params
        if params:
            self.log_params(run_id, params)

        # Save tags
        if tags:
            self.set_tags(run_id, tags)

        return run_id

    def end_run(self, run_id: str, status: str = "FINISHED"):
        """End a run with status (FINISHED, FAILED, KILLED)."""
        run_path = self.base_path / run_id
        meta_file = run_path / "meta.yaml"

        if not meta_file.exists():
            return

        # Update meta.yaml
        meta = self._read_yaml(meta_file)
        # Map status to MLflow numeric codes
        status_map = {"RUNNING": 1, "FINISHED": 3, "FAILED": 4, "KILLED": 5}
        meta["status"] = status_map.get(status, 3)  # Default to FINISHED
        meta["end_time"] = int(time.time() * 1000)

        self._write_yaml(meta_file, meta)

        if self.current_run_id == run_id:
            self.current_run_id = None

    def log_params(self, run_id: str, params: Dict):
        """Log parameters for a run (MLflow FileStore format)."""
        run_path = self.base_path / run_id
        params_dir = run_path / "params"
        params_dir.mkdir(parents=True, exist_ok=True)

        # Write each param as individual file (MLflow FileStore format)
        for key, value in params.items():
            param_file = params_dir / key
            with open(param_file, "w") as f:
                f.write(str(value))

    def log_metrics(self, run_id: str, metrics: Dict):
        """Log metrics for a run (MLflow FileStore format)."""
        run_path = self.base_path / run_id
        metrics_dir = run_path / "metrics"
        metrics_dir.mkdir(parents=True, exist_ok=True)

        # Write each metric as individual file (MLflow FileStore format)
        # Format: "timestamp value step\n" where timestamp is ms, step defaults to 0
        timestamp = int(time.time() * 1000)
        for key, value in metrics.items():
            metric_file = metrics_dir / key
            # Append to support metric history
            with open(metric_file, "a") as f:
                f.write(f"{timestamp} {value} 0\n")

    def set_tags(self, run_id: str, tags: Dict):
        """Set tags for a run (MLflow FileStore format)."""
        run_path = self.base_path / run_id
        tags_dir = run_path / "tags"
        tags_dir.mkdir(parents=True, exist_ok=True)

        # Write each tag as individual file (MLflow FileStore format)
        for key, value in tags.items():
            tag_file = tags_dir / key
            with open(tag_file, "w") as f:
                f.write(str(value))

    def log_artifact(self, run_id: str, artifact_name: str, content: Any):
        """
        Log an artifact (evaluation results, pipeline config, etc.).

        Args:
            run_id: Run identifier
            artifact_name: Name of artifact (e.g., "evaluation_results.jsonl")
            content: Content to save (list for JSONL, dict for JSON)
        """
        run_path = self.base_path / run_id / "artifacts"
        artifact_file = run_path / artifact_name

        if artifact_name.endswith(".jsonl"):
            # Append to JSONL
            with open(artifact_file, "a") as f:
                if isinstance(content, list):
                    for item in content:
                        f.write(json.dumps(item) + "\n")
                else:
                    f.write(json.dumps(content) + "\n")
        elif artifact_name.endswith(".json"):
            # Save as JSON
            with open(artifact_file, "w") as f:
                json.dump(content, f, indent=2)
        else:
            # Save as text
            with open(artifact_file, "w") as f:
                f.write(str(content))

    def list_runs(self) -> List[Dict]:
        """List all runs in this experiment."""
        runs = []
        for run_dir in self.base_path.iterdir():
            if run_dir.is_dir():
                meta_file = run_dir / "meta.yaml"
                if meta_file.exists():
                    meta = self._read_yaml(meta_file)

                    # Load params from MLflow directory format
                    params_dir = run_dir / "params"
                    meta["params"] = {}
                    if params_dir.exists():
                        for param_file in params_dir.iterdir():
                            if param_file.is_file():
                                with open(param_file) as f:
                                    meta["params"][param_file.name] = f.read().strip()

                    # Load metrics from MLflow directory format (latest value only)
                    metrics_dir = run_dir / "metrics"
                    meta["metrics"] = {}
                    if metrics_dir.exists():
                        for metric_file in metrics_dir.iterdir():
                            if metric_file.is_file():
                                with open(metric_file) as f:
                                    lines = f.readlines()
                                    if lines:
                                        # Get last line, parse "timestamp value step"
                                        last_line = lines[-1].strip()
                                        parts = last_line.split()
                                        if len(parts) >= 2:
                                            try:
                                                meta["metrics"][metric_file.name] = float(parts[1])
                                            except ValueError:
                                                meta["metrics"][metric_file.name] = parts[1]

                    # Load tags from MLflow directory format
                    tags_dir = run_dir / "tags"
                    meta["tags"] = {}
                    if tags_dir.exists():
                        for tag_file in tags_dir.iterdir():
                            if tag_file.is_file():
                                with open(tag_file) as f:
                                    meta["tags"][tag_file.name] = f.read().strip()

                    runs.append(meta)

        return sorted(runs, key=lambda x: x["start_time"], reverse=True)

    def get_run(self, run_id: str) -> Optional[Dict]:
        """Get full run details including artifacts."""
        run_path = self.base_path / run_id
        meta_file = run_path / "meta.yaml"

        if not meta_file.exists():
            return None

        run = self._read_yaml(meta_file)

        # Load params from MLflow directory format
        params_dir = run_path / "params"
        run["params"] = {}
        if params_dir.exists():
            for param_file in params_dir.iterdir():
                if param_file.is_file():
                    with open(param_file) as f:
                        run["params"][param_file.name] = f.read().strip()

        # Load metrics from MLflow directory format (latest value only)
        metrics_dir = run_path / "metrics"
        run["metrics"] = {}
        if metrics_dir.exists():
            for metric_file in metrics_dir.iterdir():
                if metric_file.is_file():
                    with open(metric_file) as f:
                        lines = f.readlines()
                        if lines:
                            # Get last line, parse "timestamp value step"
                            last_line = lines[-1].strip()
                            parts = last_line.split()
                            if len(parts) >= 2:
                                try:
                                    run["metrics"][metric_file.name] = float(parts[1])
                                except ValueError:
                                    run["metrics"][metric_file.name] = parts[1]

        # Load tags from MLflow directory format
        tags_dir = run_path / "tags"
        run["tags"] = {}
        if tags_dir.exists():
            for tag_file in tags_dir.iterdir():
                if tag_file.is_file():
                    with open(tag_file) as f:
                        run["tags"][tag_file.name] = f.read().strip()

        # List artifacts
        artifacts_path = run_path / "artifacts"
        if artifacts_path.exists():
            run["artifacts"] = [
                f.name
                for f in artifacts_path.iterdir()
                if f.is_file()
            ]

        return run

    def _read_yaml(self, file_path: Path) -> Dict:
        """Read simple YAML-like format."""
        data = {}
        with open(file_path) as f:
            for line in f:
                if ":" in line:
                    key, value = line.strip().split(":", 1)
                    value = value.strip().strip('"')
                    # Try to convert to int
                    try:
                        value = int(value)
                    except ValueError:
                        # Try None
                        if value == "None":
                            value = None
                    data[key] = value
        return data

    def _write_yaml(self, file_path: Path, data: Dict):
        """Write proper YAML format."""
        import yaml
        with open(file_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


class TraceLogger:
    """
    Logs detailed execution traces for multi-step workflows.

    Dual-format output:
    - MLflow FileStore: experiment_id/traces/trace_id/trace_info.yaml (for MLflow UI)
    - Langfuse-style: Individual trace-{id}.json files (detailed observations)
    """

    def __init__(self, run_id: str, experiment_id: str, base_path: str = "logs/experiments"):
        self.run_id = run_id
        self.experiment_id = experiment_id
        self.base_path = Path(base_path)
        # Path without /runs/ subdirectory (MLflow-compatible structure)
        self.artifacts_path = self.base_path / experiment_id / run_id / "artifacts"
        self.traces_path = self.artifacts_path / "traces"
        self.traces_path.mkdir(parents=True, exist_ok=True)
        self.active_traces: Dict[str, Dict] = {}
        self._span_counter = 0  # For generating unique span IDs

    def _generate_span_id(self) -> str:
        """Generate a unique span ID (16 hex chars, OpenTelemetry format)."""
        self._span_counter += 1
        return uuid.uuid4().hex[:16]

    def _generate_trace_id(self) -> str:
        """Generate a unique trace ID (32 hex chars, OpenTelemetry format)."""
        return uuid.uuid4().hex

    def start_trace(self, query: str, session_id: str = None) -> str:
        """
        Start a new trace for a query.

        Returns:
            trace_id: Unique trace identifier
        """
        trace_id = self._generate_trace_id()
        start_time_ns = int(time.time() * 1_000_000_000)

        trace = {
            # Internal tracking
            "id": trace_id,
            "name": "termnorm_pipeline",
            "type": "workflow",
            "input": {"query": query},
            "output": None,
            "metadata": {
                "session_id": session_id,
                "run_id": self.run_id,
                "experiment_id": self.experiment_id,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "start_time": time.time(),
            "start_time_ns": start_time_ns,
            "end_time": None,
            "end_time_ns": None,
            "latency_ms": None,
            "status": "RUNNING",
            "observations": [],  # Langfuse-style intermediate steps
            "scores": [],  # Evaluation metrics
            # MLflow span tracking
            "_mlflow_spans": [],  # Will be converted to MLflow format on save
            "_root_span_id": self._generate_span_id(),
        }

        self.active_traces[trace_id] = trace
        return trace_id

    def add_observation(
        self,
        trace_id: str,
        obs_type: str,
        name: str,
        input_data: Dict,
        output_data: Dict,
        start_time: float = None,
        end_time: float = None,
        metadata: Dict = None,
    ):
        """
        Add an observation (intermediate step) to a trace.

        Args:
            trace_id: Trace identifier
            obs_type: Type of observation ("span", "generation", "event")
            name: Name of step (e.g., "entity_profiling", "token_matching", "llm_ranking")
            input_data: Input to this step
            output_data: Output from this step
            start_time: Start timestamp (Unix epoch)
            end_time: End timestamp (Unix epoch)
            metadata: Additional metadata (model, tokens, etc.)
        """
        if trace_id not in self.active_traces:
            raise ValueError(f"Trace {trace_id} not found or already ended")

        obs_id = f"obs-{uuid.uuid4().hex[:8]}"
        span_id = self._generate_span_id()
        now = time.time()
        start_ts = start_time or now
        end_ts = end_time or now

        # Langfuse-style observation
        observation = {
            "id": obs_id,
            "type": obs_type,
            "name": name,
            "input": input_data,
            "output": output_data,
            "start_time": start_ts,
            "end_time": end_ts,
            "latency_ms": (
                (end_ts - start_ts) * 1000
                if start_time and end_time
                else None
            ),
            "metadata": metadata or {},
        }

        self.active_traces[trace_id]["observations"].append(observation)

        # MLflow-compatible span (OpenTelemetry format)
        trace = self.active_traces[trace_id]
        span_type_map = {
            "span": "CHAIN",
            "generation": "LLM",
            "event": "UNKNOWN",
        }

        mlflow_span = {
            "span_id": span_id,
            "trace_id": trace_id,
            "parent_id": trace["_root_span_id"],  # All observations are children of root
            "name": name,
            "start_time_ns": int(start_ts * 1_000_000_000),
            "end_time_ns": int(end_ts * 1_000_000_000),
            "status": {"status_code": "OK"},
            "inputs": input_data,
            "outputs": output_data,
            "attributes": metadata or {},
            "events": [],
            "span_type": span_type_map.get(obs_type, "UNKNOWN"),
        }

        trace["_mlflow_spans"].append(mlflow_span)

    def add_generation(
        self,
        trace_id: str,
        name: str,
        model: str,
        input_data: Dict,
        output_data: Dict,
        usage: Dict = None,
        start_time: float = None,
        end_time: float = None,
    ):
        """
        Add an LLM generation observation to a trace.

        Args:
            trace_id: Trace identifier
            name: Name of generation step
            model: Model identifier (e.g., "groq/llama-3.3-70b")
            input_data: Input to LLM
            output_data: Output from LLM
            usage: Token usage info {"prompt_tokens": X, "completion_tokens": Y, "total_tokens": Z}
            start_time: Start timestamp
            end_time: End timestamp
        """
        metadata = {
            "model": model,
            "usage": usage or {},
        }

        self.add_observation(
            trace_id=trace_id,
            obs_type="generation",
            name=name,
            input_data=input_data,
            output_data=output_data,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
        )

    def add_score(
        self, trace_id: str, name: str, value: Any, data_type: str = "numeric", comment: str = ""
    ):
        """
        Add a score/metric to a trace.

        Args:
            trace_id: Trace identifier
            name: Score name (e.g., "mrr", "confidence", "latency_ms")
            value: Score value
            data_type: Type of value ("numeric", "boolean", "categorical")
            comment: Optional comment
        """
        if trace_id not in self.active_traces:
            raise ValueError(f"Trace {trace_id} not found or already ended")

        score = {
            "name": name,
            "value": value,
            "data_type": data_type,
            "comment": comment,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

        self.active_traces[trace_id]["scores"].append(score)

    def end_trace(self, trace_id: str, final_output: Dict, status: str = "SUCCESS"):
        """
        End a trace and save to disk in both MLflow and Langfuse formats.

        Args:
            trace_id: Trace identifier
            final_output: Final output of the workflow
            status: Final status ("SUCCESS", "ERROR", "TIMEOUT")
        """
        if trace_id not in self.active_traces:
            raise ValueError(f"Trace {trace_id} not found or already ended")

        trace = self.active_traces[trace_id]
        end_time = time.time()
        end_time_ns = int(end_time * 1_000_000_000)

        trace["output"] = final_output
        trace["status"] = status
        trace["end_time"] = end_time
        trace["end_time_ns"] = end_time_ns
        trace["latency_ms"] = (end_time - trace["start_time"]) * 1000

        # Save trace to disk (both formats)
        self._save_langfuse_trace(trace_id)
        self._save_mlflow_trace(trace_id)

        # Remove from active traces
        del self.active_traces[trace_id]

    def _save_langfuse_trace(self, trace_id: str):
        """Save trace in Langfuse-compatible format (individual JSON file)."""
        if trace_id not in self.active_traces:
            raise ValueError(f"Trace {trace_id} not found")

        trace = self.active_traces[trace_id]

        # Create Langfuse-compatible output (without internal MLflow fields)
        langfuse_trace = {k: v for k, v in trace.items() if not k.startswith("_")}

        # Also remove the ns timestamps from langfuse output
        langfuse_trace.pop("start_time_ns", None)
        langfuse_trace.pop("end_time_ns", None)

        trace_file = self.traces_path / f"trace-{trace_id[:12]}.json"

        with open(trace_file, "w") as f:
            json.dump(langfuse_trace, f, indent=2)

    def _save_mlflow_trace(self, trace_id: str):
        """
        Save trace in MLflow FileStore format.

        MLflow FileStore stores traces in:
            experiment_id/traces/trace_id/
                trace_info.yaml
                request_metadata/
                    key1
                    key2
                tags/
                    key1
                artifacts/
        """
        if trace_id not in self.active_traces:
            raise ValueError(f"Trace {trace_id} not found")

        trace = self.active_traces[trace_id]

        # MLflow FileStore puts traces under experiment, not under runs
        # Path: experiments/experiment_id/traces/trace_id/
        mlflow_traces_path = self.base_path / self.experiment_id / "traces" / trace_id
        mlflow_traces_path.mkdir(parents=True, exist_ok=True)

        # Create subdirectories
        (mlflow_traces_path / "request_metadata").mkdir(exist_ok=True)
        (mlflow_traces_path / "tags").mkdir(exist_ok=True)
        (mlflow_traces_path / "artifacts").mkdir(exist_ok=True)

        # Map status to MLflow TraceState string values
        status_map = {
            "SUCCESS": "OK",
            "ERROR": "ERROR",
            "TIMEOUT": "ERROR",
            "RUNNING": "IN_PROGRESS",
        }

        experiment_id = trace["metadata"].get("experiment_id", "")

        # Convert Unix timestamp to ISO 8601 string (required by MLflow)
        request_time_str = datetime.fromtimestamp(
            trace["start_time"], tz=timezone.utc
        ).isoformat().replace("+00:00", "Z")

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
            "execution_duration_ms": int(trace.get("latency_ms", 0)) if trace.get("latency_ms") else None,
            "state": status_map.get(trace["status"], "OK"),
            "request_preview": json.dumps(trace["input"]),
            "response_preview": json.dumps(trace["output"]),
        }

        # Write trace_info.yaml
        trace_info_file = mlflow_traces_path / "trace_info.yaml"
        self._write_yaml(trace_info_file, trace_info)

        # Write request_metadata as individual files
        metadata = trace.get("metadata", {})
        for key, value in metadata.items():
            if value is not None:
                meta_file = mlflow_traces_path / "request_metadata" / key
                with open(meta_file, "w") as f:
                    f.write(str(value))

        # Write tags as individual files
        # Artifact location uses file:// URI for MLflow FileStore compatibility
        # Must use absolute path for MLflow to find the artifacts
        artifacts_path = (mlflow_traces_path / "artifacts").resolve()
        artifact_uri = f"file:///{artifacts_path.as_posix()}"

        tags = {
            "mlflow.traceName": trace.get("name", "termnorm_pipeline"),
            "mlflow.traceInputs": json.dumps(trace["input"]),
            "mlflow.traceOutputs": json.dumps(trace["output"]),
            "mlflow.artifactLocation": artifact_uri,  # Required for trace data access
        }
        # Add scores as tags
        for score in trace.get("scores", []):
            tags[f"score.{score['name']}"] = str(score["value"])

        for key, value in tags.items():
            tag_file = mlflow_traces_path / "tags" / key
            with open(tag_file, "w") as f:
                f.write(str(value))

        # Save trace data (spans) as artifact
        # MLflow stores span data in artifact storage
        spans_data = self._build_mlflow_spans(trace)
        spans_file = mlflow_traces_path / "artifacts" / "traces.json"
        with open(spans_file, "w") as f:
            json.dump(spans_data, f, indent=2)

    def _build_mlflow_spans(self, trace: Dict) -> Dict:
        """Build MLflow-compatible spans data structure."""
        status_map = {
            "SUCCESS": "OK",
            "ERROR": "ERROR",
            "TIMEOUT": "ERROR",
            "RUNNING": "UNSET",
        }

        # Root span
        root_span = {
            "span_id": trace["_root_span_id"],
            "trace_id": trace["id"],
            "parent_id": None,
            "name": trace["name"],
            "start_time_ns": trace["start_time_ns"],
            "end_time_ns": trace["end_time_ns"],
            "status": {"status_code": status_map.get(trace["status"], "UNSET")},
            "inputs": trace["input"],
            "outputs": trace["output"],
            "attributes": {
                "session_id": trace["metadata"].get("session_id"),
                "run_id": trace["metadata"].get("run_id"),
                "experiment_id": trace["metadata"].get("experiment_id"),
            },
            "events": [],
            "span_type": "CHAIN",
        }

        all_spans = [root_span] + trace.get("_mlflow_spans", [])

        return {"spans": all_spans}

    def save_trace(self, trace_id: str):
        """Save trace to disk (legacy method, calls both formats)."""
        self._save_langfuse_trace(trace_id)
        self._save_mlflow_trace(trace_id)


class DatasetManager:
    """Manages evaluation datasets."""

    def __init__(self, base_path: str = "logs/datasets"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def save_dataset(self, name: str, examples: List[Dict]):
        """
        Save a dataset in JSONL format.

        Args:
            name: Dataset name (e.g., "material_forms_v1")
            examples: List of examples with query, expected, trace, etc.
        """
        dataset_file = self.base_path / f"{name}.jsonl"

        with open(dataset_file, "w") as f:
            for example in examples:
                f.write(json.dumps(example) + "\n")

    def load_dataset(self, name: str) -> List[Dict]:
        """Load a dataset from JSONL format."""
        dataset_file = self.base_path / f"{name}.jsonl"

        if not dataset_file.exists():
            raise FileNotFoundError(f"Dataset {name} not found")

        examples = []
        with open(dataset_file) as f:
            for line in f:
                examples.append(json.loads(line))

        return examples

    def list_datasets(self) -> List[str]:
        """List all available datasets."""
        return [f.stem for f in self.base_path.glob("*.jsonl")]
