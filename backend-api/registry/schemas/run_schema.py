"""
Run metadata schema based on MLflow conventions.

Standard fields:
- run_id: Unique identifier (UUID format, following MLflow convention)
- run_name: Human-readable name (stored as mlflow.runName tag in MLflow)
- experiment_id: Parent experiment identifier
- parameters: Key-value configuration (mlflow.log_param)
- metrics: Key-value performance measurements (mlflow.log_metric)
- tags: System and user metadata (mlflow tags)
- artifacts: Output files and objects

References:
- MLflow Tracking API: https://mlflow.org/docs/latest/tracking.html
- MLflow System Tags: https://mlflow.org/docs/latest/tracking.html#system-tags
"""

from typing import Dict, List, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class RunStatus(str, Enum):
    """Run lifecycle status (MLflow convention)."""
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"
    FAILED = "FAILED"
    KILLED = "KILLED"


class RunType(str, Enum):
    """Type of run for categorization."""
    EVALUATION = "evaluation"
    OPTIMIZATION = "optimization"
    PRODUCTION = "production"


class RunInfo(BaseModel):
    """
    Core run metadata (MLflow RunInfo structure).

    Based on MLflow's RunInfo object:
    https://mlflow.org/docs/latest/python_api/mlflow.entities.html#mlflow.entities.RunInfo
    """
    run_id: str = Field(..., description="Unique run identifier (UUID format)")
    run_name: str = Field(..., description="Human-readable run name")
    experiment_id: str = Field(..., description="Parent experiment ID")
    status: RunStatus = Field(default=RunStatus.RUNNING, description="Run lifecycle status")
    start_time: datetime = Field(..., description="Run start timestamp (ISO 8601)")
    end_time: Optional[datetime] = Field(None, description="Run end timestamp (ISO 8601)")
    artifact_uri: str = Field(..., description="Root directory for run artifacts")
    lifecycle_stage: str = Field(default="active", description="Run lifecycle stage (active/deleted)")


class RunData(BaseModel):
    """
    Run execution data (MLflow RunData structure).

    Based on MLflow's RunData object:
    https://mlflow.org/docs/latest/python_api/mlflow.entities.html#mlflow.entities.RunData
    """
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Run parameters (mlflow.log_param)")
    metrics: Dict[str, float] = Field(default_factory=dict, description="Run metrics (mlflow.log_metric)")
    tags: Dict[str, str] = Field(default_factory=dict, description="Run tags (mlflow.set_tag)")


class SystemTags:
    """
    MLflow system tags (standard keys).

    Reference: https://mlflow.org/docs/latest/tracking.html#system-tags
    """
    # Run relationship
    PARENT_RUN_ID = "mlflow.parentRunId"

    # Source information
    SOURCE_NAME = "mlflow.source.name"
    SOURCE_TYPE = "mlflow.source.type"
    SOURCE_GIT_COMMIT = "mlflow.source.git.commit"
    SOURCE_GIT_BRANCH = "mlflow.source.git.branch"

    # User information
    USER = "mlflow.user"

    # Note
    NOTE_CONTENT = "mlflow.note.content"

    # Run name (alternative storage)
    RUN_NAME = "mlflow.runName"


class Run(BaseModel):
    """
    Complete run representation (MLflow Run object).

    Combines RunInfo and RunData following MLflow convention:
    https://mlflow.org/docs/latest/python_api/mlflow.entities.html#mlflow.entities.Run
    """
    info: RunInfo
    data: RunData


class EvaluationRunMetadata(BaseModel):
    """
    Metadata specific to evaluation runs.

    Extends base run with evaluation-specific fields.
    """
    run_id: str
    run_type: RunType = Field(default=RunType.EVALUATION)
    dataset_name: str = Field(..., description="Dataset identifier (OpenAI Evals convention: name.split.version)")
    dataset_path: str = Field(..., description="Path to dataset file (JSONL format)")
    config: Dict[str, Any] = Field(default_factory=dict, description="Evaluation configuration")

    # Lineage (not applicable for base evaluation)
    parent_run_id: Optional[str] = Field(None, description="Parent run ID (mlflow.parentRunId)")


class OptimizationRunMetadata(BaseModel):
    """
    Metadata specific to optimization campaigns.

    Optimization runs contain multiple trial runs (parent-child structure).
    """
    run_id: str
    run_type: RunType = Field(default=RunType.OPTIMIZATION)
    campaign_name: str = Field(..., description="Human-readable campaign name")
    optimizer_config: Dict[str, Any] = Field(..., description="Optimizer algorithm configuration")
    initial_conditions: Dict[str, Any] = Field(..., description="Initial state (baseline run, seed prompts, etc.)")
    dataset_name: str = Field(..., description="Dataset identifier")
    dataset_path: str = Field(..., description="Path to dataset file")

    # Summary
    total_trials: int = Field(default=0, description="Total number of trials executed")
    best_trial_id: Optional[str] = Field(None, description="Run ID of best performing trial")


class TrialRunMetadata(BaseModel):
    """
    Metadata for individual optimization trials (child runs).

    Trials are child runs of an optimization campaign (parent run).
    Uses mlflow.parentRunId tag for relationship tracking.
    """
    run_id: str
    run_type: RunType = Field(default=RunType.OPTIMIZATION)
    trial_name: str = Field(..., description="Human-readable trial name")

    # Parent relationship (MLflow convention)
    parent_campaign_id: str = Field(..., description="Parent optimization campaign run_id (mlflow.parentRunId)")
    parent_trial_id: Optional[str] = Field(None, description="Parent trial if branching from another trial")

    # Lineage
    ancestor_trial_ids: List[str] = Field(default_factory=list, description="All ancestor trial IDs in lineage")
    branching_strategy: str = Field(..., description="Reason for creating this trial")

    # Configuration changes
    changes_from_parent: Dict[str, Any] = Field(default_factory=dict, description="Configuration changes from parent")
    config: Dict[str, Any] = Field(..., description="Complete trial configuration")

    # Dataset
    dataset_name: str
    dataset_path: str

    # Optimization metadata
    source_data: Optional[Dict[str, Any]] = Field(None, description="Data used for optimization (e.g., failed traces)")


class RunResults(BaseModel):
    """
    Structure for run results (OpenAI Evals JSONL convention).

    Each line in results JSONL file follows this schema.
    Reference: https://github.com/openai/evals
    """
    input: Dict[str, Any] = Field(..., description="Input data (query, terms, etc.)")
    expected: Optional[Any] = Field(None, description="Expected output (ideal)")
    output: Any = Field(..., description="Actual output from system")

    # Metrics for this sample
    metrics: Dict[str, float] = Field(default_factory=dict, description="Per-sample metrics")

    # Trace reference
    trace_file: Optional[str] = Field(None, description="Path to detailed trace file")

    # Metadata
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


class AggregateMetrics(BaseModel):
    """Aggregate metrics across all samples in a run."""
    total_samples: int
    metrics: Dict[str, float] = Field(..., description="Aggregated metric values")
    duration_seconds: float
    timestamp: datetime


class Lineage(BaseModel):
    """
    Lineage tracking for trial relationships.

    Tracks parent-child relationships and branching structure.
    Used in optimization campaigns to track trial evolution.
    """
    trial_id: str
    parent_trial_ids: List[str] = Field(default_factory=list, description="Direct parent trial(s)")
    children_trial_ids: List[str] = Field(default_factory=list, description="Direct children trials")
    branch_reason: str = Field(..., description="Reason for branching/creating this trial")
    changes: Dict[str, Any] = Field(default_factory=dict, description="Changes made in this trial")
    metrics: Dict[str, float] = Field(default_factory=dict, description="Key metrics for comparison")
