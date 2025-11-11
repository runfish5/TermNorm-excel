"""
Experiment metadata schema based on MLflow conventions.

An experiment is a collection of runs grouped by objective/purpose.

Standard fields:
- experiment_id: Unique identifier
- name: Human-readable experiment name
- artifact_location: Root directory for experiment artifacts
- lifecycle_stage: active or deleted
- tags: Experiment-level metadata

References:
- MLflow Experiments: https://mlflow.org/docs/latest/tracking.html#organizing-runs-in-experiments
- MLflow Experiment API: https://mlflow.org/docs/latest/python_api/mlflow.html#mlflow.create_experiment
"""

from typing import Dict, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class LifecycleStage(str, Enum):
    """Experiment lifecycle stage (MLflow convention)."""
    ACTIVE = "active"
    DELETED = "deleted"


class ExperimentType(str, Enum):
    """Type of experiment for categorization."""
    EVALUATION = "evaluation"
    OPTIMIZATION = "optimization"
    PRODUCTION = "production"


class Experiment(BaseModel):
    """
    Experiment metadata (MLflow Experiment structure).

    Based on MLflow's Experiment object:
    https://mlflow.org/docs/latest/python_api/mlflow.entities.html#mlflow.entities.Experiment
    """
    experiment_id: str = Field(..., description="Unique experiment identifier")
    name: str = Field(..., description="Experiment name (unique within tracking server)")
    artifact_location: str = Field(..., description="Root artifact directory for experiment runs")
    lifecycle_stage: LifecycleStage = Field(default=LifecycleStage.ACTIVE, description="Lifecycle stage")
    tags: Dict[str, str] = Field(default_factory=dict, description="Experiment-level tags")
    creation_time: datetime = Field(..., description="Experiment creation timestamp")
    last_update_time: datetime = Field(..., description="Last update timestamp")


class ExperimentMetadata(BaseModel):
    """
    Extended experiment metadata with domain-specific fields.

    Adds fields specific to evaluation/optimization workflows.
    """
    experiment_id: str
    name: str
    experiment_type: ExperimentType
    description: str = Field(default="", description="Human-readable description")
    tags: Dict[str, str] = Field(default_factory=dict)

    # Context
    created_by: str = Field(..., description="User who created the experiment")
    created_at: datetime
    updated_at: datetime

    # Configuration
    default_config: Dict[str, any] = Field(default_factory=dict, description="Default configuration for runs")

    # Statistics (computed)
    total_runs: int = Field(default=0, description="Total runs in experiment")
    active_runs: int = Field(default=0, description="Currently running")
    completed_runs: int = Field(default=0, description="Successfully completed runs")
    failed_runs: int = Field(default=0, description="Failed runs")


class OptimizationCampaignMetadata(ExperimentMetadata):
    """
    Metadata for optimization campaign experiments.

    An optimization campaign is an experiment containing multiple trial runs.
    """
    experiment_type: ExperimentType = Field(default=ExperimentType.OPTIMIZATION)

    # Optimization specific
    baseline_run_id: Optional[str] = Field(None, description="Baseline evaluation run ID")
    optimizer_algorithm: str = Field(..., description="Optimization algorithm (e.g., breadth_first_tree_search)")
    target_metric: str = Field(..., description="Primary metric to optimize (e.g., mrr)")
    target_threshold: Optional[float] = Field(None, description="Target metric threshold for early stopping")

    # Progress
    current_best_run_id: Optional[str] = Field(None, description="Current best trial run ID")
    current_best_metric: Optional[float] = Field(None, description="Current best metric value")
    improvement_over_baseline: Optional[float] = Field(None, description="Improvement vs baseline")


class EvaluationExperimentMetadata(ExperimentMetadata):
    """
    Metadata for evaluation experiments.

    Standard evaluation experiments without optimization.
    """
    experiment_type: ExperimentType = Field(default=ExperimentType.EVALUATION)

    # Evaluation specific
    dataset_name: str = Field(..., description="Primary dataset used")
    evaluation_metrics: list[str] = Field(default_factory=list, description="Metrics tracked (e.g., mrr, hit@5)")
