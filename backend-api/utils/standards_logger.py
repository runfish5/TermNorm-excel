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
from datetime import datetime


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
                    # Count runs
                    runs_dir = exp_dir / "runs"
                    num_runs = len(list(runs_dir.iterdir())) if runs_dir.exists() else 0
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

        # Create meta.yaml
        meta = {
            "run_id": run_id,
            "run_name": run_name,
            "experiment_id": self.experiment_id,
            "status": 1,  # 1=RUNNING, 3=FINISHED (MLflow requires numeric)
            "start_time": int(time.time() * 1000),
            "end_time": None,
            "lifecycle_stage": "active",
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
        """Log parameters for a run."""
        run_path = self.base_path / run_id
        params_file = run_path / "params.json"

        # Load existing params
        existing_params = {}
        if params_file.exists():
            with open(params_file) as f:
                existing_params = json.load(f)

        # Merge params
        existing_params.update(params)

        # Save params
        with open(params_file, "w") as f:
            json.dump(existing_params, f, indent=2)

    def log_metrics(self, run_id: str, metrics: Dict):
        """Log metrics for a run."""
        run_path = self.base_path / run_id
        metrics_file = run_path / "metrics.json"

        # Load existing metrics
        existing_metrics = {}
        if metrics_file.exists():
            with open(metrics_file) as f:
                existing_metrics = json.load(f)

        # Merge metrics
        existing_metrics.update(metrics)

        # Save metrics
        with open(metrics_file, "w") as f:
            json.dump(existing_metrics, f, indent=2)

    def set_tags(self, run_id: str, tags: Dict):
        """Set tags for a run."""
        run_path = self.base_path / run_id
        tags_file = run_path / "tags.json"

        # Load existing tags
        existing_tags = {}
        if tags_file.exists():
            with open(tags_file) as f:
                existing_tags = json.load(f)

        # Merge tags
        existing_tags.update(tags)

        # Save tags
        with open(tags_file, "w") as f:
            json.dump(existing_tags, f, indent=2)

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

                    # Load params
                    params_file = run_dir / "params.json"
                    if params_file.exists():
                        with open(params_file) as f:
                            meta["params"] = json.load(f)
                    else:
                        meta["params"] = {}

                    # Load metrics
                    metrics_file = run_dir / "metrics.json"
                    if metrics_file.exists():
                        with open(metrics_file) as f:
                            meta["metrics"] = json.load(f)
                    else:
                        meta["metrics"] = {}

                    # Load tags
                    tags_file = run_dir / "tags.json"
                    if tags_file.exists():
                        with open(tags_file) as f:
                            meta["tags"] = json.load(f)
                    else:
                        meta["tags"] = {}

                    runs.append(meta)

        return sorted(runs, key=lambda x: x["start_time"], reverse=True)

    def get_run(self, run_id: str) -> Optional[Dict]:
        """Get full run details including artifacts."""
        run_path = self.base_path / run_id
        meta_file = run_path / "meta.yaml"

        if not meta_file.exists():
            return None

        run = self._read_yaml(meta_file)

        # Load params
        params_file = run_path / "params.json"
        if params_file.exists():
            with open(params_file) as f:
                run["params"] = json.load(f)

        # Load metrics
        metrics_file = run_path / "metrics.json"
        if metrics_file.exists():
            with open(metrics_file) as f:
                run["metrics"] = json.load(f)

        # Load tags
        tags_file = run_path / "tags.json"
        if tags_file.exists():
            with open(tags_file) as f:
                run["tags"] = json.load(f)

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
        """Write simple YAML-like format."""
        with open(file_path, "w") as f:
            for key, value in data.items():
                if isinstance(value, str):
                    f.write(f'{key}: "{value}"\n')
                elif value is None:
                    f.write(f"{key}: None\n")
                else:
                    f.write(f"{key}: {value}\n")


class TraceLogger:
    """
    Logs detailed execution traces for multi-step workflows.

    Langfuse-compatible format with support for intermediate results.
    """

    def __init__(self, run_id: str, experiment_id: str, base_path: str = "logs/experiments"):
        self.run_id = run_id
        self.experiment_id = experiment_id
        self.traces_path = Path(base_path) / experiment_id / "runs" / run_id / "artifacts" / "traces"
        self.traces_path.mkdir(parents=True, exist_ok=True)
        self.active_traces: Dict[str, Dict] = {}

    def start_trace(self, query: str, session_id: str = None) -> str:
        """
        Start a new trace for a query.

        Returns:
            trace_id: Unique trace identifier
        """
        trace_id = f"trace-{uuid.uuid4().hex[:12]}"

        trace = {
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
            "end_time": None,
            "latency_ms": None,
            "status": "RUNNING",
            "observations": [],  # Intermediate steps
            "scores": [],  # Evaluation metrics
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

        observation = {
            "id": obs_id,
            "type": obs_type,
            "name": name,
            "input": input_data,
            "output": output_data,
            "start_time": start_time or time.time(),
            "end_time": end_time or time.time(),
            "latency_ms": (
                (end_time - start_time) * 1000
                if start_time and end_time
                else None
            ),
            "metadata": metadata or {},
        }

        self.active_traces[trace_id]["observations"].append(observation)

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
        End a trace and save to disk.

        Args:
            trace_id: Trace identifier
            final_output: Final output of the workflow
            status: Final status ("SUCCESS", "ERROR", "TIMEOUT")
        """
        if trace_id not in self.active_traces:
            raise ValueError(f"Trace {trace_id} not found or already ended")

        trace = self.active_traces[trace_id]
        trace["output"] = final_output
        trace["status"] = status
        trace["end_time"] = time.time()
        trace["latency_ms"] = (trace["end_time"] - trace["start_time"]) * 1000

        # Save trace to disk
        self.save_trace(trace_id)

        # Remove from active traces
        del self.active_traces[trace_id]

    def save_trace(self, trace_id: str):
        """Save trace to disk (Langfuse-compatible JSON format)."""
        if trace_id not in self.active_traces:
            raise ValueError(f"Trace {trace_id} not found")

        trace = self.active_traces[trace_id]
        trace_file = self.traces_path / f"{trace_id}.json"

        with open(trace_file, "w") as f:
            json.dump(trace, f, indent=2)


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
