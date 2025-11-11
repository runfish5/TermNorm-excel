"""
Run manager for creating and tracking experiment runs.

Follows MLflow run management conventions:
- Unique run_id (UUID format)
- Runs belong to experiments
- Support for nested runs (parent-child)
- Parameters, metrics, tags, artifacts

References:
- MLflow Tracking API: https://mlflow.org/docs/latest/tracking.html
- MLflow Nested Runs: https://mlflow.org/docs/latest/tracking.html#organizing-runs-in-experiments
"""

import json
import jsonlines
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime
import uuid

from registry.schemas import (
    Run,
    RunInfo,
    RunData,
    RunStatus,
    RunType,
    SystemTags,
    EvaluationRunMetadata,
    OptimizationRunMetadata,
    TrialRunMetadata,
    RunResults,
    AggregateMetrics,
    Lineage,
)


class RunManager:
    """
    Manager for run lifecycle and metadata.

    Responsibilities:
    - Create new runs
    - Log parameters, metrics, tags
    - Save artifacts
    - Track run status
    - Support nested runs (parent-child)
    """

    def __init__(self, registry_root: Path):
        """
        Initialize run manager.

        Args:
            registry_root: Root directory for registry data
        """
        self.registry_root = Path(registry_root)
        self.runs_dir = self.registry_root / "runs"
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def create_run(
        self,
        experiment_id: str,
        run_name: str,
        run_type: RunType,
        tags: Optional[Dict[str, str]] = None,
        parent_run_id: Optional[str] = None,
        **kwargs
    ) -> str:
        """
        Create a new run.

        Args:
            experiment_id: Parent experiment ID
            run_name: Human-readable run name
            run_type: Type of run (evaluation/optimization/production)
            tags: Optional tags
            parent_run_id: Parent run ID for nested runs (mlflow.parentRunId)
            **kwargs: Additional run-specific fields

        Returns:
            run_id: Unique run identifier

        Example:
            run_id = manager.create_run(
                experiment_id="exp-123",
                run_name="baseline_eval",
                run_type=RunType.EVALUATION,
                tags={"model": "llama-3.3-70b"},
                dataset_name="termnorm_queries.test.v0"
            )
        """
        # Generate run_id (UUID format, MLflow convention)
        run_id = str(uuid.uuid4())

        # Create run directory
        run_dir = self.runs_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        # Create artifact directory
        artifact_uri = str(run_dir / "artifacts")
        Path(artifact_uri).mkdir(exist_ok=True)

        # Create traces directory (for detailed step traces)
        traces_dir = run_dir / "artifacts" / "traces"
        traces_dir.mkdir(parents=True, exist_ok=True)

        # Initialize tags
        run_tags = tags or {}

        # Set system tags (MLflow convention)
        run_tags[SystemTags.RUN_NAME] = run_name
        if parent_run_id:
            run_tags[SystemTags.PARENT_RUN_ID] = parent_run_id

        # Create RunInfo
        now = datetime.now()
        run_info = RunInfo(
            run_id=run_id,
            run_name=run_name,
            experiment_id=experiment_id,
            status=RunStatus.RUNNING,
            start_time=now,
            artifact_uri=artifact_uri,
            lifecycle_stage="active"
        )

        # Create RunData
        run_data = RunData(
            parameters={},
            metrics={},
            tags=run_tags
        )

        # Create Run
        run = Run(info=run_info, data=run_data)

        # Save run metadata
        self._save_run(run_id, run)

        # Create run-type-specific metadata
        if run_type == RunType.EVALUATION:
            metadata = EvaluationRunMetadata(
                run_id=run_id,
                run_type=run_type,
                parent_run_id=parent_run_id,
                **kwargs
            )
        elif run_type == RunType.OPTIMIZATION:
            if parent_run_id:
                # This is a trial run (child of optimization campaign)
                metadata = TrialRunMetadata(
                    run_id=run_id,
                    run_type=run_type,
                    parent_campaign_id=parent_run_id,
                    **kwargs
                )
            else:
                # This is an optimization campaign (parent run)
                metadata = OptimizationRunMetadata(
                    run_id=run_id,
                    run_type=run_type,
                    **kwargs
                )
        else:
            raise ValueError(f"Unsupported run_type: {run_type}")

        # Save extended metadata
        metadata_file = run_dir / "metadata.json"
        with open(metadata_file, 'w') as f:
            json.dump(metadata.dict(), f, indent=2, default=str)

        return run_id

    def log_param(self, run_id: str, key: str, value: Any) -> None:
        """
        Log a parameter (mlflow.log_param convention).

        Args:
            run_id: Run identifier
            key: Parameter name
            value: Parameter value (will be converted to string)
        """
        run = self._load_run(run_id)
        run.data.parameters[key] = str(value)
        self._save_run(run_id, run)

    def log_params(self, run_id: str, params: Dict[str, Any]) -> None:
        """
        Log multiple parameters at once.

        Args:
            run_id: Run identifier
            params: Dictionary of parameter name-value pairs
        """
        run = self._load_run(run_id)
        for key, value in params.items():
            run.data.parameters[key] = str(value)
        self._save_run(run_id, run)

    def log_metric(self, run_id: str, key: str, value: float, step: Optional[int] = None) -> None:
        """
        Log a metric (mlflow.log_metric convention).

        Args:
            run_id: Run identifier
            key: Metric name
            value: Metric value (numeric)
            step: Optional step/iteration number
        """
        run = self._load_run(run_id)
        metric_key = f"{key}_step_{step}" if step is not None else key
        run.data.metrics[metric_key] = float(value)
        self._save_run(run_id, run)

    def log_metrics(self, run_id: str, metrics: Dict[str, float]) -> None:
        """
        Log multiple metrics at once.

        Args:
            run_id: Run identifier
            metrics: Dictionary of metric name-value pairs
        """
        run = self._load_run(run_id)
        for key, value in metrics.items():
            run.data.metrics[key] = float(value)
        self._save_run(run_id, run)

    def set_tag(self, run_id: str, key: str, value: str) -> None:
        """
        Set a tag (mlflow.set_tag convention).

        Args:
            run_id: Run identifier
            key: Tag name
            value: Tag value (string)
        """
        run = self._load_run(run_id)
        run.data.tags[key] = str(value)
        self._save_run(run_id, run)

    def set_tags(self, run_id: str, tags: Dict[str, str]) -> None:
        """
        Set multiple tags at once.

        Args:
            run_id: Run identifier
            tags: Dictionary of tag name-value pairs
        """
        run = self._load_run(run_id)
        for key, value in tags.items():
            run.data.tags[key] = str(value)
        self._save_run(run_id, run)

    def log_results(self, run_id: str, results: List[RunResults]) -> None:
        """
        Log evaluation results (OpenAI Evals JSONL convention).

        Args:
            run_id: Run identifier
            results: List of result objects
        """
        run_dir = self.runs_dir / run_id
        results_file = run_dir / "results.jsonl"

        with jsonlines.open(results_file, mode='a') as writer:
            for result in results:
                writer.write(result.dict())

    def log_aggregate_metrics(self, run_id: str, metrics: AggregateMetrics) -> None:
        """
        Log aggregate metrics summary.

        Args:
            run_id: Run identifier
            metrics: AggregateMetrics object
        """
        run_dir = self.runs_dir / run_id
        summary_file = run_dir / "metrics_summary.json"

        with open(summary_file, 'w') as f:
            json.dump(metrics.dict(), f, indent=2, default=str)

        # Also log to run metrics
        self.log_metrics(run_id, metrics.metrics)

    def log_artifact(self, run_id: str, artifact_name: str, artifact_data: Any) -> None:
        """
        Log an artifact (file or data).

        Args:
            run_id: Run identifier
            artifact_name: Artifact file name (e.g., "trace_001.json")
            artifact_data: Data to save (will be JSON serialized if dict/list)
        """
        run_dir = self.runs_dir / run_id
        artifact_path = run_dir / "artifacts" / artifact_name

        # Ensure parent directory exists
        artifact_path.parent.mkdir(parents=True, exist_ok=True)

        # Save artifact
        if isinstance(artifact_data, (dict, list)):
            with open(artifact_path, 'w') as f:
                json.dump(artifact_data, f, indent=2, default=str)
        else:
            with open(artifact_path, 'w') as f:
                f.write(str(artifact_data))

    def update_run_status(self, run_id: str, status: RunStatus) -> None:
        """
        Update run status.

        Args:
            run_id: Run identifier
            status: New status
        """
        run = self._load_run(run_id)
        run.info.status = status

        if status in [RunStatus.FINISHED, RunStatus.FAILED, RunStatus.KILLED]:
            run.info.end_time = datetime.now()

        self._save_run(run_id, run)

    def get_run(self, run_id: str) -> Optional[Run]:
        """
        Get run by ID.

        Args:
            run_id: Run identifier

        Returns:
            Run object or None if not found
        """
        return self._load_run(run_id)

    def get_run_metadata(self, run_id: str) -> Optional[Dict[str, Any]]:
        """
        Get extended run metadata.

        Args:
            run_id: Run identifier

        Returns:
            Metadata dict or None if not found
        """
        run_dir = self.runs_dir / run_id
        metadata_file = run_dir / "metadata.json"

        if not metadata_file.exists():
            return None

        with open(metadata_file, 'r') as f:
            return json.load(f)

    def search_runs(
        self,
        experiment_ids: Optional[List[str]] = None,
        filter_string: Optional[str] = None,
        run_type: Optional[RunType] = None,
        parent_run_id: Optional[str] = None
    ) -> List[Run]:
        """
        Search for runs with filters.

        Args:
            experiment_ids: Filter by experiment IDs
            filter_string: MLflow-style filter (e.g., "metrics.mrr > 0.8")
            run_type: Filter by run type
            parent_run_id: Filter by parent run ID (get child runs)

        Returns:
            List of matching runs

        Example:
            # Get all child runs of an optimization campaign
            trials = manager.search_runs(parent_run_id="campaign-123")
        """
        runs = []

        for run_dir in self.runs_dir.iterdir():
            if not run_dir.is_dir():
                continue

            run_id = run_dir.name
            run = self._load_run(run_id)

            if not run:
                continue

            # Filter by experiment
            if experiment_ids and run.info.experiment_id not in experiment_ids:
                continue

            # Filter by parent (for nested runs)
            if parent_run_id:
                if run.data.tags.get(SystemTags.PARENT_RUN_ID) != parent_run_id:
                    continue

            # Filter by run type (check metadata)
            if run_type:
                metadata = self.get_run_metadata(run_id)
                if metadata and metadata.get("run_type") != run_type.value:
                    continue

            # TODO: Implement filter_string parsing (MLflow filter syntax)

            runs.append(run)

        return runs

    def _load_run(self, run_id: str) -> Optional[Run]:
        """Load run from disk."""
        run_dir = self.runs_dir / run_id
        run_file = run_dir / "run.json"

        if not run_file.exists():
            return None

        with open(run_file, 'r') as f:
            data = json.load(f)

        return Run(**data)

    def _save_run(self, run_id: str, run: Run) -> None:
        """Save run to disk."""
        run_dir = self.runs_dir / run_id
        run_file = run_dir / "run.json"

        with open(run_file, 'w') as f:
            json.dump(run.dict(), f, indent=2, default=str)
