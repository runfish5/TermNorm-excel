"""
MLflow Tracking Adapter for TermNorm Pipeline

Provides decorators and utilities to track prompt optimization experiments
without modifying core business logic.
"""

import mlflow
from mlflow.tracking import MlflowClient
from functools import wraps
import time
import json
from typing import Dict, Any, Optional, Callable
from pathlib import Path
import os


class TermNormMLflowAdapter:
    """Adapter for tracking TermNorm experiments with MLflow"""

    def __init__(self,
                 tracking_uri: str = "file:./mlruns",
                 experiment_name: str = "termnorm_prompt_optimization"):
        """
        Initialize MLflow tracking

        Args:
            tracking_uri: MLflow tracking URI (default: local file storage)
            experiment_name: Name of the experiment
        """
        self.tracking_uri = tracking_uri
        self.experiment_name = experiment_name

        mlflow.set_tracking_uri(tracking_uri)
        mlflow.set_experiment(experiment_name)

        self.client = MlflowClient(tracking_uri)

    def track_pipeline(self, run_name: str = "research_and_match") -> Callable:
        """
        Decorator to track entire pipeline execution

        Usage:
            @adapter.track_pipeline("pipeline_run")
            async def research_and_match(...):
                ...
        """
        def decorator(func: Callable) -> Callable:
            @wraps(func)
            async def wrapper(*args, **kwargs):
                with mlflow.start_run(run_name=run_name):
                    # Extract request payload
                    payload = kwargs.get("payload", {})
                    query = payload.get("query", "")
                    terms = payload.get("terms", [])

                    # Log parameters
                    mlflow.log_param("query", query[:100])  # Truncate long queries
                    mlflow.log_param("num_terms", len(terms))
                    mlflow.log_param("endpoint", "research_and_match")

                    # Get LLM provider from environment
                    try:
                        from config.settings import LLM_PROVIDER, LLM_MODEL
                        mlflow.log_param("llm_provider", LLM_PROVIDER)
                        mlflow.log_param("llm_model", LLM_MODEL)
                    except:
                        # Fallback if imports fail
                        mlflow.log_param("llm_provider", os.getenv("LLM_PROVIDER", "unknown"))
                        mlflow.log_param("llm_model", os.getenv("LLM_MODEL", "unknown"))

                    # Execute pipeline
                    start_time = time.time()
                    try:
                        result = await func(*args, **kwargs)
                        elapsed_time = time.time() - start_time

                        # Log success metrics
                        mlflow.log_metric("total_time_seconds", elapsed_time)
                        mlflow.log_metric("status_code", 200)

                        # Extract and log result metrics
                        if isinstance(result, dict) and result.get("status") == "success":
                            data = result.get("data", {})
                            candidates = data.get("ranked_candidates", [])

                            mlflow.log_metric("num_candidates", len(candidates))

                            if candidates:
                                top_candidate = candidates[0]
                                mlflow.log_metric("top1_core_score",
                                                 top_candidate.get("core_concept_score", 0))
                                mlflow.log_metric("top1_spec_score",
                                                 top_candidate.get("spec_score", 0))
                                mlflow.log_param("top1_candidate",
                                                top_candidate.get("candidate", "")[:50])

                            # Log web search status
                            web_status = data.get("web_search_status", "unknown")
                            mlflow.log_param("web_search_status", web_status)

                            # Log timing breakdown if available
                            if "timing" in data:
                                timing = data["timing"]
                                for key, value in timing.items():
                                    if isinstance(value, (int, float)):
                                        mlflow.log_metric(f"timing_{key}_seconds", value)

                        # Log result artifact (truncated for large results)
                        result_to_log = result
                        if isinstance(result, dict):
                            # Create a copy with truncated data if needed
                            result_copy = result.copy()
                            if "data" in result_copy and isinstance(result_copy["data"], dict):
                                data_copy = result_copy["data"].copy()
                                # Truncate large fields
                                if "entity_profile" in data_copy and isinstance(data_copy["entity_profile"], str):
                                    if len(data_copy["entity_profile"]) > 10000:
                                        data_copy["entity_profile"] = data_copy["entity_profile"][:10000] + "...[truncated]"
                                result_copy["data"] = data_copy
                            result_to_log = result_copy

                        mlflow.log_dict(result_to_log, "pipeline_result.json")

                        return result

                    except Exception as e:
                        elapsed_time = time.time() - start_time
                        mlflow.log_metric("total_time_seconds", elapsed_time)
                        mlflow.log_metric("status_code", 500)
                        mlflow.log_param("error_type", type(e).__name__)
                        mlflow.log_param("error_message", str(e)[:500])
                        raise

            return wrapper
        return decorator

    def track_component(self, component_name: str, log_output: bool = False) -> Callable:
        """
        Decorator to track individual pipeline components

        Usage:
            @adapter.track_component("web_profiling", log_output=True)
            async def web_generate_entity_profile(...):
                ...
        """
        def decorator(func: Callable) -> Callable:
            @wraps(func)
            async def wrapper(*args, **kwargs):
                # Only create nested run if parent run exists
                active_run = mlflow.active_run()
                if active_run:
                    with mlflow.start_run(run_name=component_name, nested=True):
                        mlflow.log_param("component", component_name)

                        start_time = time.time()
                        result = await func(*args, **kwargs)
                        elapsed_time = time.time() - start_time

                        mlflow.log_metric(f"{component_name}_duration_seconds", elapsed_time)

                        if log_output and isinstance(result, (dict, list)):
                            # Truncate large outputs
                            output_str = json.dumps(result)
                            if len(output_str) > 10000:
                                output_str = output_str[:10000] + "...[truncated]"
                                result_truncated = json.loads(output_str) if output_str.endswith("}") or output_str.endswith("]") else {"truncated": True, "preview": output_str}
                                mlflow.log_dict({"result": result_truncated}, f"{component_name}_output.json")
                            else:
                                mlflow.log_dict({"result": result}, f"{component_name}_output.json")

                        return result
                else:
                    # No active run, execute without tracking
                    return await func(*args, **kwargs)

            return wrapper
        return decorator

    def log_prompt_template(self, template_name: str, template_content: str):
        """Log a prompt template as an artifact"""
        mlflow.log_text(template_content, f"prompts/{template_name}.txt")

    def log_prompt_config(self, config: Dict[str, Any]):
        """Log prompt configuration parameters"""
        for key, value in config.items():
            if isinstance(value, (str, int, float, bool)):
                mlflow.log_param(f"prompt_{key}", value)

    def compare_runs(self, run_ids: list[str]) -> list[Dict[str, Any]]:
        """
        Compare multiple runs and return comparison data

        Args:
            run_ids: List of MLflow run IDs to compare

        Returns:
            List of dictionaries with run data
        """
        runs_data = []
        for run_id in run_ids:
            try:
                run = self.client.get_run(run_id)
                runs_data.append({
                    "run_id": run_id,
                    "run_name": run.data.tags.get("mlflow.runName", "unnamed"),
                    "params": run.data.params,
                    "metrics": run.data.metrics,
                    "start_time": run.info.start_time,
                    "status": run.info.status
                })
            except Exception as e:
                print(f"Error fetching run {run_id}: {e}")
        return runs_data

    def get_best_run(self, metric_name: str, ascending: bool = False) -> Optional[str]:
        """
        Get the best run ID based on a metric

        Args:
            metric_name: Name of the metric to optimize
            ascending: If True, lower is better; if False, higher is better

        Returns:
            Run ID of the best run, or None if no runs found
        """
        experiment = self.client.get_experiment_by_name(self.experiment_name)
        if not experiment:
            return None

        order = "ASC" if ascending else "DESC"
        runs = self.client.search_runs(
            experiment_ids=[experiment.experiment_id],
            order_by=[f"metrics.{metric_name} {order}"],
            max_results=1
        )

        return runs[0].info.run_id if runs else None

    def get_experiment_summary(self) -> Dict[str, Any]:
        """Get summary statistics for the current experiment"""
        experiment = self.client.get_experiment_by_name(self.experiment_name)
        if not experiment:
            return {"error": "Experiment not found"}

        runs = self.client.search_runs(
            experiment_ids=[experiment.experiment_id],
            max_results=1000
        )

        if not runs:
            return {"total_runs": 0}

        # Calculate aggregate statistics
        total_runs = len(runs)
        avg_time = sum(run.data.metrics.get("total_time_seconds", 0) for run in runs) / total_runs

        return {
            "experiment_name": self.experiment_name,
            "total_runs": total_runs,
            "avg_total_time_seconds": avg_time,
            "latest_run": runs[0].info.run_id if runs else None
        }


# Global instance for easy import
tracker = TermNormMLflowAdapter()
