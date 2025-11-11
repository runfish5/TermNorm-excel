"""
Experiment Registry System

Industry-standard experiment tracking following MLflow and OpenAI Evals conventions.

Main Components:
- Registry: Unified interface for all tracking operations
- Schemas: Pydantic models following MLflow/OpenAI Evals standards
- Managers: Specialized managers for experiments, runs, datasets, lineage

Key Features:
- MLflow-compatible run tracking (run_id, experiment_id, parameters, metrics, tags)
- OpenAI Evals-compatible datasets (JSONL format, name.split.version naming)
- Parent-child run relationships (mlflow.parentRunId)
- Lineage tracking for optimization workflows
- Filesystem-based storage (no database required)

Quick Start:
    from registry import Registry, ExperimentType, RunType, DataSplit

    # Initialize registry
    registry = Registry()

    # Create experiment
    exp_id = registry.create_experiment(
        name="baseline_evaluation",
        experiment_type=ExperimentType.EVALUATION
    )

    # Create run
    run_id = registry.create_run(
        experiment_id=exp_id,
        run_name="baseline_v1",
        run_type=RunType.EVALUATION,
        dataset_name="queries.test.v0",
        dataset_path="registry/data/datasets/queries.test.v0.jsonl",
        config={"model": "llama-3.3-70b"}
    )

    # Log parameters and metrics
    registry.log_params(run_id, {"prompt_version": "v1"})
    registry.log_metrics(run_id, {"mrr": 0.85, "hit@5": 0.92})

    # Finish run
    registry.finish_run(run_id)

References:
- MLflow: https://mlflow.org/docs/latest/tracking.html
- OpenAI Evals: https://github.com/openai/evals
"""

from .registry import Registry

from .schemas import (
    # Run schemas
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
    # Experiment schemas
    Experiment,
    ExperimentMetadata,
    ExperimentType,
    LifecycleStage,
    OptimizationCampaignMetadata,
    EvaluationExperimentMetadata,
    # Dataset schemas
    DatasetSample,
    DatasetMetadata,
    DatasetRegistry,
    DataSplit,
)

__version__ = "1.0.0"

__all__ = [
    # Main interface
    "Registry",
    # Run types
    "Run",
    "RunInfo",
    "RunData",
    "RunStatus",
    "RunType",
    "SystemTags",
    "EvaluationRunMetadata",
    "OptimizationRunMetadata",
    "TrialRunMetadata",
    "RunResults",
    "AggregateMetrics",
    "Lineage",
    # Experiment types
    "Experiment",
    "ExperimentMetadata",
    "ExperimentType",
    "LifecycleStage",
    "OptimizationCampaignMetadata",
    "EvaluationExperimentMetadata",
    # Dataset types
    "DatasetSample",
    "DatasetMetadata",
    "DatasetRegistry",
    "DataSplit",
]
