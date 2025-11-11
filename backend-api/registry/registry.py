"""
Main Registry interface for experiment tracking.

Provides unified access to:
- Experiment management
- Run tracking
- Dataset handling
- Lineage tracking

Based on MLflow/OpenAI Evals conventions.
"""

from pathlib import Path
from typing import Dict, List, Optional, Any

from registry.managers import (
    ExperimentManager,
    RunManager,
    LineageManager,
    DatasetManager,
)

from registry.schemas import (
    ExperimentType,
    RunType,
    RunStatus,
    DataSplit,
    SystemTags,
)


class Registry:
    """
    Main registry interface for experiment tracking.

    Unified interface to all registry managers following industry standards.

    Example usage:
        # Initialize registry
        registry = Registry(registry_root="backend-api/registry/data")

        # Create experiment
        experiment_id = registry.create_experiment(
            name="baseline_evaluation",
            experiment_type=ExperimentType.EVALUATION,
            description="Baseline prompt performance"
        )

        # Create run
        run_id = registry.create_run(
            experiment_id=experiment_id,
            run_name="baseline_v1",
            run_type=RunType.EVALUATION,
            dataset_name="termnorm_queries.test.v0",
            dataset_path="registry/data/datasets/termnorm_queries.test.v0.jsonl",
            config={"model": "llama-3.3-70b", "prompt": "v1"}
        )

        # Log parameters and metrics
        registry.log_params(run_id, {"model": "llama-3.3-70b", "prompt_version": "v1"})
        registry.log_metrics(run_id, {"mrr": 0.85, "hit@5": 0.92})

        # Complete run
        registry.finish_run(run_id, RunStatus.FINISHED)
    """

    def __init__(self, registry_root: Path = None):
        """
        Initialize registry.

        Args:
            registry_root: Root directory for registry data
                          Defaults to backend-api/registry/data
        """
        if registry_root is None:
            # Default to registry/data in backend-api
            current_file = Path(__file__).resolve()
            backend_api = current_file.parent.parent
            registry_root = backend_api / "registry" / "data"

        self.registry_root = Path(registry_root)
        self.registry_root.mkdir(parents=True, exist_ok=True)

        # Initialize managers
        self.experiments = ExperimentManager(self.registry_root)
        self.runs = RunManager(self.registry_root)
        self.lineage = LineageManager(self.registry_root)
        self.datasets = DatasetManager(self.registry_root)

    # =========================================================================
    # Experiment methods
    # =========================================================================

    def create_experiment(
        self,
        name: str,
        experiment_type: ExperimentType,
        description: str = "",
        created_by: str = "system",
        tags: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> str:
        """
        Create a new experiment.

        Args:
            name: Experiment name (unique)
            experiment_type: Type (evaluation/optimization/production)
            description: Human-readable description
            created_by: Creator identifier
            tags: Optional experiment-level tags
            **kwargs: Additional experiment-specific fields

        Returns:
            experiment_id: Unique experiment identifier
        """
        return self.experiments.create_experiment(
            name=name,
            experiment_type=experiment_type,
            description=description,
            created_by=created_by,
            tags=tags,
            **kwargs
        )

    def get_experiment(self, experiment_id: str):
        """Get experiment metadata by ID."""
        return self.experiments.get_experiment(experiment_id)

    def get_experiment_by_name(self, name: str):
        """Get experiment by name."""
        return self.experiments.get_experiment_by_name(name)

    def list_experiments(self, experiment_type: Optional[ExperimentType] = None):
        """List all experiments with optional filtering."""
        return self.experiments.list_experiments(experiment_type=experiment_type)

    # =========================================================================
    # Run methods
    # =========================================================================

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
            run_type: Type (evaluation/optimization/production)
            tags: Optional tags
            parent_run_id: Parent run ID for nested runs
            **kwargs: Additional run-specific fields

        Returns:
            run_id: Unique run identifier
        """
        return self.runs.create_run(
            experiment_id=experiment_id,
            run_name=run_name,
            run_type=run_type,
            tags=tags,
            parent_run_id=parent_run_id,
            **kwargs
        )

    def log_param(self, run_id: str, key: str, value: Any) -> None:
        """Log a parameter (mlflow.log_param convention)."""
        self.runs.log_param(run_id, key, value)

    def log_params(self, run_id: str, params: Dict[str, Any]) -> None:
        """Log multiple parameters."""
        self.runs.log_params(run_id, params)

    def log_metric(self, run_id: str, key: str, value: float, step: Optional[int] = None) -> None:
        """Log a metric (mlflow.log_metric convention)."""
        self.runs.log_metric(run_id, key, value, step)

    def log_metrics(self, run_id: str, metrics: Dict[str, float]) -> None:
        """Log multiple metrics."""
        self.runs.log_metrics(run_id, metrics)

    def set_tag(self, run_id: str, key: str, value: str) -> None:
        """Set a tag (mlflow.set_tag convention)."""
        self.runs.set_tag(run_id, key, value)

    def set_tags(self, run_id: str, tags: Dict[str, str]) -> None:
        """Set multiple tags."""
        self.runs.set_tags(run_id, tags)

    def log_artifact(self, run_id: str, artifact_name: str, artifact_data: Any) -> None:
        """Log an artifact."""
        self.runs.log_artifact(run_id, artifact_name, artifact_data)

    def finish_run(self, run_id: str, status: RunStatus = RunStatus.FINISHED) -> None:
        """Mark run as finished."""
        self.runs.update_run_status(run_id, status)

    def get_run(self, run_id: str):
        """Get run by ID."""
        return self.runs.get_run(run_id)

    def search_runs(
        self,
        experiment_ids: Optional[List[str]] = None,
        filter_string: Optional[str] = None,
        run_type: Optional[RunType] = None,
        parent_run_id: Optional[str] = None
    ):
        """Search for runs with filters."""
        return self.runs.search_runs(
            experiment_ids=experiment_ids,
            filter_string=filter_string,
            run_type=run_type,
            parent_run_id=parent_run_id
        )

    # =========================================================================
    # Lineage methods (for optimization workflows)
    # =========================================================================

    def initialize_campaign_lineage(self, campaign_id: str) -> None:
        """Initialize lineage tracking for optimization campaign."""
        self.lineage.initialize_campaign_lineage(campaign_id)

    def add_trial_to_lineage(
        self,
        campaign_id: str,
        trial_id: str,
        parent_trial_ids: List[str],
        branch_reason: str,
        changes: Dict[str, Any],
        metrics: Dict[str, float]
    ) -> None:
        """Add trial to lineage graph."""
        self.lineage.add_trial(
            campaign_id=campaign_id,
            trial_id=trial_id,
            parent_trial_ids=parent_trial_ids,
            branch_reason=branch_reason,
            changes=changes,
            metrics=metrics
        )

    def get_lineage(self, campaign_id: str):
        """Get complete lineage for campaign."""
        return self.lineage.get_lineage(campaign_id)

    def get_leaf_trials(self, campaign_id: str):
        """Get leaf trials (candidates for next branching)."""
        return self.lineage.get_leaf_trials(campaign_id)

    def visualize_lineage(self, campaign_id: str) -> str:
        """Get ASCII visualization of lineage tree."""
        return self.lineage.visualize_tree(campaign_id)

    # =========================================================================
    # Dataset methods
    # =========================================================================

    def create_dataset(
        self,
        name: str,
        split: DataSplit,
        version: str,
        samples: List,
        description: str = "",
        created_by: str = "system",
        tags: Optional[Dict[str, str]] = None,
        **kwargs
    ):
        """Create a new dataset."""
        return self.datasets.create_dataset(
            name=name,
            split=split,
            version=version,
            samples=samples,
            description=description,
            created_by=created_by,
            tags=tags,
            **kwargs
        )

    def load_dataset(self, dataset_id: str):
        """Load dataset samples."""
        return self.datasets.load_dataset(dataset_id)

    def get_dataset_metadata(self, dataset_id: str):
        """Get dataset metadata."""
        return self.datasets.get_dataset_metadata(dataset_id)

    def list_datasets(
        self,
        name: Optional[str] = None,
        split: Optional[DataSplit] = None,
        version: Optional[str] = None
    ):
        """List datasets with optional filtering."""
        return self.datasets.list_datasets(name=name, split=split, version=version)

    # =========================================================================
    # Convenience methods
    # =========================================================================

    def create_evaluation_run(
        self,
        experiment_id: str,
        run_name: str,
        dataset_id: str,
        config: Dict[str, Any],
        tags: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Convenience method to create an evaluation run.

        Args:
            experiment_id: Parent experiment ID
            run_name: Human-readable run name
            dataset_id: Dataset identifier (name.split.version)
            config: Run configuration (model, prompts, etc.)
            tags: Optional tags

        Returns:
            run_id: Unique run identifier
        """
        # Get dataset metadata
        dataset_metadata = self.datasets.get_dataset_metadata(dataset_id)
        if not dataset_metadata:
            raise ValueError(f"Dataset {dataset_id} not found")

        # Create run
        run_id = self.create_run(
            experiment_id=experiment_id,
            run_name=run_name,
            run_type=RunType.EVALUATION,
            tags=tags,
            dataset_name=dataset_id,
            dataset_path=dataset_metadata.file_path,
            config=config
        )

        # Log config as parameters
        self.log_params(run_id, config)

        return run_id

    def create_optimization_campaign(
        self,
        campaign_name: str,
        optimizer_algorithm: str,
        target_metric: str,
        dataset_id: str,
        baseline_run_id: Optional[str] = None,
        target_threshold: Optional[float] = None,
        initial_config: Optional[Dict[str, Any]] = None,
        created_by: str = "system",
        tags: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Convenience method to create an optimization campaign.

        Args:
            campaign_name: Human-readable campaign name
            optimizer_algorithm: Optimization algorithm name
            target_metric: Metric to optimize (e.g., 'mrr')
            dataset_id: Dataset identifier
            baseline_run_id: Optional baseline run ID
            target_threshold: Target metric threshold
            initial_config: Initial configuration
            created_by: Creator identifier
            tags: Optional tags

        Returns:
            campaign_id: Optimization campaign run_id
        """
        # Create experiment
        experiment_id = self.create_experiment(
            name=campaign_name,
            experiment_type=ExperimentType.OPTIMIZATION,
            description=f"Optimization campaign using {optimizer_algorithm}",
            created_by=created_by,
            tags=tags,
            optimizer_algorithm=optimizer_algorithm,
            target_metric=target_metric,
            baseline_run_id=baseline_run_id,
            target_threshold=target_threshold
        )

        # Get dataset metadata
        dataset_metadata = self.datasets.get_dataset_metadata(dataset_id)
        if not dataset_metadata:
            raise ValueError(f"Dataset {dataset_id} not found")

        # Create campaign run (parent run)
        campaign_id = self.create_run(
            experiment_id=experiment_id,
            run_name=f"{campaign_name}_campaign",
            run_type=RunType.OPTIMIZATION,
            tags=tags,
            campaign_name=campaign_name,
            optimizer_config={"algorithm": optimizer_algorithm, "target_metric": target_metric},
            initial_conditions={"baseline_run_id": baseline_run_id, "config": initial_config or {}},
            dataset_name=dataset_id,
            dataset_path=dataset_metadata.file_path
        )

        # Initialize lineage tracking
        self.initialize_campaign_lineage(campaign_id)

        return campaign_id

    def create_optimization_trial(
        self,
        campaign_id: str,
        trial_name: str,
        parent_trial_ids: List[str],
        branch_reason: str,
        config: Dict[str, Any],
        changes_from_parent: Dict[str, Any],
        tags: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Convenience method to create an optimization trial.

        Args:
            campaign_id: Parent campaign run_id
            trial_name: Human-readable trial name
            parent_trial_ids: Parent trial IDs
            branch_reason: Reason for creating this trial
            config: Complete trial configuration
            changes_from_parent: Configuration changes from parent
            tags: Optional tags

        Returns:
            trial_id: Trial run_id
        """
        # Get campaign metadata
        campaign_run = self.get_run(campaign_id)
        if not campaign_run:
            raise ValueError(f"Campaign {campaign_id} not found")

        campaign_metadata = self.runs.get_run_metadata(campaign_id)

        # Create trial run (child run)
        trial_id = self.create_run(
            experiment_id=campaign_run.info.experiment_id,
            run_name=trial_name,
            run_type=RunType.OPTIMIZATION,
            tags=tags,
            parent_run_id=campaign_id,  # mlflow.parentRunId
            trial_name=trial_name,
            parent_campaign_id=campaign_id,
            parent_trial_id=parent_trial_ids[0] if parent_trial_ids else None,
            branching_strategy=branch_reason,
            changes_from_parent=changes_from_parent,
            config=config,
            dataset_name=campaign_metadata.get("dataset_name"),
            dataset_path=campaign_metadata.get("dataset_path")
        )

        # Log config as parameters
        self.log_params(trial_id, config)

        # Add to lineage (will be updated with metrics later)
        self.add_trial_to_lineage(
            campaign_id=campaign_id,
            trial_id=trial_id,
            parent_trial_ids=parent_trial_ids,
            branch_reason=branch_reason,
            changes=changes_from_parent,
            metrics={}  # Will be updated after evaluation
        )

        return trial_id
