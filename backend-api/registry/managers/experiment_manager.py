"""
Experiment manager for creating and tracking experiments.

Follows MLflow experiment management conventions:
- Unique experiment_id (numerical or UUID)
- Experiments group related runs
- Lifecycle management (active/deleted)

References:
- MLflow Experiments: https://mlflow.org/docs/latest/tracking.html#organizing-runs-in-experiments
"""

import json
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
import uuid

from registry.schemas import (
    Experiment,
    ExperimentMetadata,
    ExperimentType,
    LifecycleStage,
    OptimizationCampaignMetadata,
    EvaluationExperimentMetadata,
)


class ExperimentManager:
    """
    Manager for experiment lifecycle and metadata.

    Responsibilities:
    - Create new experiments
    - Load/save experiment metadata
    - Query experiments
    - Track experiment statistics
    """

    def __init__(self, registry_root: Path):
        """
        Initialize experiment manager.

        Args:
            registry_root: Root directory for registry data
                          (e.g., backend-api/registry/data)
        """
        self.registry_root = Path(registry_root)
        self.experiments_dir = self.registry_root / "experiments"
        self.experiments_dir.mkdir(parents=True, exist_ok=True)

        # Index file (fast lookup)
        self.index_file = self.experiments_dir / "experiments_index.json"
        self._load_index()

    def _load_index(self) -> None:
        """Load experiment index from disk."""
        if self.index_file.exists():
            with open(self.index_file, 'r') as f:
                self.index = json.load(f)
        else:
            self.index = {}

    def _save_index(self) -> None:
        """Save experiment index to disk."""
        with open(self.index_file, 'w') as f:
            json.dump(self.index, f, indent=2, default=str)

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
            name: Experiment name (should be unique)
            experiment_type: Type of experiment (evaluation/optimization/production)
            description: Human-readable description
            created_by: User who created the experiment
            tags: Optional experiment-level tags
            **kwargs: Additional experiment-specific fields

        Returns:
            experiment_id: Unique experiment identifier

        Example:
            experiment_id = manager.create_experiment(
                name="baseline_evaluation",
                experiment_type=ExperimentType.EVALUATION,
                description="Baseline prompt performance evaluation",
                created_by="user@example.com",
                dataset_name="termnorm_queries.test.v0"
            )
        """
        # Generate experiment_id (MLflow uses incrementing integers, we use UUID)
        experiment_id = str(uuid.uuid4())

        # Check for duplicate name
        if any(exp["name"] == name for exp in self.index.values()):
            raise ValueError(f"Experiment with name '{name}' already exists")

        # Create experiment directory
        experiment_dir = self.experiments_dir / experiment_id
        experiment_dir.mkdir(parents=True, exist_ok=True)

        # Create artifact directory
        artifact_location = str(experiment_dir / "artifacts")
        Path(artifact_location).mkdir(exist_ok=True)

        # Create metadata
        now = datetime.now()
        if experiment_type == ExperimentType.EVALUATION:
            metadata = EvaluationExperimentMetadata(
                experiment_id=experiment_id,
                name=name,
                experiment_type=experiment_type,
                description=description,
                tags=tags or {},
                created_by=created_by,
                created_at=now,
                updated_at=now,
                **kwargs
            )
        elif experiment_type == ExperimentType.OPTIMIZATION:
            metadata = OptimizationCampaignMetadata(
                experiment_id=experiment_id,
                name=name,
                experiment_type=experiment_type,
                description=description,
                tags=tags or {},
                created_by=created_by,
                created_at=now,
                updated_at=now,
                **kwargs
            )
        else:
            metadata = ExperimentMetadata(
                experiment_id=experiment_id,
                name=name,
                experiment_type=experiment_type,
                description=description,
                tags=tags or {},
                created_by=created_by,
                created_at=now,
                updated_at=now,
                **kwargs
            )

        # Save metadata
        metadata_file = experiment_dir / "metadata.json"
        with open(metadata_file, 'w') as f:
            json.dump(metadata.dict(), f, indent=2, default=str)

        # Update index
        self.index[experiment_id] = {
            "experiment_id": experiment_id,
            "name": name,
            "experiment_type": experiment_type.value,
            "artifact_location": artifact_location,
            "created_at": now.isoformat(),
        }
        self._save_index()

        return experiment_id

    def get_experiment(self, experiment_id: str) -> Optional[ExperimentMetadata]:
        """
        Get experiment metadata by ID.

        Args:
            experiment_id: Experiment identifier

        Returns:
            ExperimentMetadata or None if not found
        """
        if experiment_id not in self.index:
            return None

        experiment_dir = self.experiments_dir / experiment_id
        metadata_file = experiment_dir / "metadata.json"

        if not metadata_file.exists():
            return None

        with open(metadata_file, 'r') as f:
            data = json.load(f)

        # Reconstruct appropriate metadata type
        exp_type = ExperimentType(data["experiment_type"])
        if exp_type == ExperimentType.EVALUATION:
            return EvaluationExperimentMetadata(**data)
        elif exp_type == ExperimentType.OPTIMIZATION:
            return OptimizationCampaignMetadata(**data)
        else:
            return ExperimentMetadata(**data)

    def get_experiment_by_name(self, name: str) -> Optional[ExperimentMetadata]:
        """
        Get experiment by name.

        Args:
            name: Experiment name

        Returns:
            ExperimentMetadata or None if not found
        """
        experiment_id = None
        for exp_id, exp_info in self.index.items():
            if exp_info["name"] == name:
                experiment_id = exp_id
                break

        if experiment_id:
            return self.get_experiment(experiment_id)
        return None

    def list_experiments(
        self,
        experiment_type: Optional[ExperimentType] = None
    ) -> List[ExperimentMetadata]:
        """
        List all experiments with optional filtering.

        Args:
            experiment_type: Filter by experiment type

        Returns:
            List of ExperimentMetadata
        """
        experiments = []
        for experiment_id in self.index.keys():
            metadata = self.get_experiment(experiment_id)
            if metadata:
                if experiment_type is None or metadata.experiment_type == experiment_type:
                    experiments.append(metadata)

        return experiments

    def update_experiment_stats(
        self,
        experiment_id: str,
        total_runs: Optional[int] = None,
        active_runs: Optional[int] = None,
        completed_runs: Optional[int] = None,
        failed_runs: Optional[int] = None,
        **kwargs
    ) -> None:
        """
        Update experiment statistics.

        Args:
            experiment_id: Experiment identifier
            total_runs: Total runs count
            active_runs: Active runs count
            completed_runs: Completed runs count
            failed_runs: Failed runs count
            **kwargs: Additional fields to update
        """
        metadata = self.get_experiment(experiment_id)
        if not metadata:
            raise ValueError(f"Experiment {experiment_id} not found")

        # Update stats
        if total_runs is not None:
            metadata.total_runs = total_runs
        if active_runs is not None:
            metadata.active_runs = active_runs
        if completed_runs is not None:
            metadata.completed_runs = completed_runs
        if failed_runs is not None:
            metadata.failed_runs = failed_runs

        # Update custom fields
        for key, value in kwargs.items():
            if hasattr(metadata, key):
                setattr(metadata, key, value)

        # Update timestamp
        metadata.updated_at = datetime.now()

        # Save
        experiment_dir = self.experiments_dir / experiment_id
        metadata_file = experiment_dir / "metadata.json"
        with open(metadata_file, 'w') as f:
            json.dump(metadata.dict(), f, indent=2, default=str)

    def delete_experiment(self, experiment_id: str) -> None:
        """
        Mark experiment as deleted (soft delete).

        Args:
            experiment_id: Experiment identifier
        """
        if experiment_id not in self.index:
            raise ValueError(f"Experiment {experiment_id} not found")

        # Remove from index
        del self.index[experiment_id]
        self._save_index()

        # Could also mark as deleted in metadata if needed
        # (MLflow uses lifecycle_stage field)
