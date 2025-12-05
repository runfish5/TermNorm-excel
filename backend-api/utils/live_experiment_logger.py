"""
Live experiment logger for real-time production logging.

Logs all new matches to the main production experiment in MLflow structure.
"""

import json
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

from utils.standards_logger import ExperimentManager, RunManager, TraceLogger


class LiveExperimentLogger:
    """
    Singleton logger for real-time production experiment logging.

    Maintains a single long-running experiment for production data.
    Creates a new run for each day or session.
    """

    def __init__(self, base_path: str = "logs/experiments"):
        self.base_path = Path(base_path)
        self.exp_manager = ExperimentManager(base_path=str(self.base_path))

        # Main production experiment (created once, reused)
        self.experiment_id = self._get_or_create_main_experiment()

        # Current run (changes daily or per session)
        self.current_run_id: Optional[str] = None
        self.current_run_date: Optional[str] = None
        self.run_manager: Optional[RunManager] = None
        self.trace_logger: Optional[TraceLogger] = None

    def _get_or_create_main_experiment(self) -> str:
        """Get or create the main production experiment."""
        experiment_name = "production_realtime"

        # Check if already exists
        experiments = self.exp_manager.list_experiments()
        for exp in experiments:
            if exp["name"] == experiment_name:
                return exp["experiment_id"]

        # Create new
        experiment_id = self.exp_manager.create_experiment(
            name=experiment_name,
            description="Real-time production logging (main experiment for all live matches)"
        )

        return experiment_id


    def _find_existing_daily_run(self, today: str) -> Optional[str]:
        """
        Check filesystem for existing run with today's date.

        Returns run_id if found, None otherwise.
        """
        # Path without /runs/ subdirectory (MLflow-compatible structure)
        exp_path = self.base_path / self.experiment_id

        if not exp_path.exists():
            return None

        run_name_prefix = f"production_{today}"

        # Check all runs (run directories are directly under experiment, not under /runs/)
        for run_dir in exp_path.iterdir():
            # Skip non-directories, special directories, and metadata files
            if not run_dir.is_dir() or run_dir.name in ("runs", "models", "tags", "traces"):
                continue

            meta_file = run_dir / "meta.yaml"
            if not meta_file.exists():
                continue

            # Read meta.yaml to check run name
            import yaml
            with open(meta_file, 'r') as f:
                meta = yaml.safe_load(f)

            # Check if this run is for today and still active
            if meta.get("run_name", "").startswith(run_name_prefix):
                # MLflow uses numeric status: 1=RUNNING, 3=FINISHED, 4=FAILED, 5=KILLED
                if meta.get("status") in [1, "RUNNING", None]:
                    return run_dir.name

        return None

    def _get_or_create_daily_run(self) -> str:
        """Get or create a run for the current day."""
        today = datetime.utcnow().strftime("%Y-%m-%d")

        # Check if we need a new run (in-memory check)
        if self.current_run_id and self.current_run_date == today:
            return self.current_run_id

        # Check filesystem for existing run for today (handles server restarts)
        existing_run_id = self._find_existing_daily_run(today)
        if existing_run_id:
            print(f"[EXPERIMENTS] Reusing existing run for {today}: {existing_run_id}")
            self.current_run_id = existing_run_id
            self.current_run_date = today

            # Reinitialize run_manager and trace_logger
            if not self.run_manager:
                self.run_manager = RunManager(self.experiment_id, base_path=str(self.base_path))
            self.run_manager.current_run_id = existing_run_id

            self.trace_logger = TraceLogger(
                run_id=self.current_run_id,
                experiment_id=self.experiment_id,
                base_path=str(self.base_path),
            )

            return self.current_run_id

        # Create new daily run
        if not self.run_manager:
            self.run_manager = RunManager(self.experiment_id, base_path=str(self.base_path))

        run_name = f"production_{today}"

        # Get current hyperparameters from environment
        from core.llm_providers import LLM_PROVIDER, LLM_MODEL

        params = {
            "llm_provider": LLM_PROVIDER,
            "llm_model": LLM_MODEL,
            "temperature": 0.0,
            "pipeline_version": "3-tier",
            "date": today,
        }

        tags = {
            "source": "live_production",
            "logging_mode": "realtime",
            "date": today,
        }

        self.current_run_id = self.run_manager.start_run(
            run_name=run_name,
            params=params,
            tags=tags,
        )

        self.current_run_date = today

        # Create trace logger for this run
        self.trace_logger = TraceLogger(
            run_id=self.current_run_id,
            experiment_id=self.experiment_id,
            base_path=str(self.base_path),
        )

        return self.current_run_id

    def log_match(self, record: Dict[str, Any]) -> str:
        """
        Log a match to the current run's evaluation_results.jsonl and create trace.

        Args:
            record: Activity log record with source, target, confidence, etc.

        Returns:
            trace_id
        """
        # Ensure we have a current run
        run_id = self._get_or_create_daily_run()

        # Create trace from record
        trace_id = self._create_trace_from_record(record)

        # Create evaluation result entry
        eval_result = {
            "query": record.get("source"),
            "predicted": record.get("target"),
            "method": record.get("method"),
            "confidence": record.get("confidence", 0),
            "latency_ms": record.get("total_time", 0) * 1000,
            "timestamp": record.get("timestamp"),
            "session_id": record.get("session_id"),
            "trace_id": trace_id,
        }

        # Append to evaluation_results.jsonl
        self.run_manager.log_artifact(run_id, "evaluation_results.jsonl", [eval_result])

        # Update run metrics (aggregate)
        self._update_run_metrics(run_id, record)

        return trace_id

    def _create_trace_from_record(self, record: Dict[str, Any]) -> str:
        """Create detailed trace from activity record."""
        trace_id = self.trace_logger.start_trace(
            query=record.get("source"),
            session_id=record.get("session_id"),
        )

        # Add web search observation (if present)
        if record.get("web_sources"):
            self.trace_logger.add_observation(
                trace_id=trace_id,
                obs_type="span",
                name="web_search",
                input_data={"query": record["source"]},
                output_data={
                    "sources": record["web_sources"],
                    "status": record.get("web_search_status", "unknown"),
                    "num_sources": len(record["web_sources"]),
                },
                metadata={"search_method": "Brave Search API"},
            )

        # Add entity profiling observation (if present)
        if record.get("entity_profile"):
            self.trace_logger.add_generation(
                trace_id=trace_id,
                name="entity_profiling",
                model=record.get("llm_provider", "unknown"),
                input_data={
                    "query": record["source"],
                    "web_content": record.get("web_sources", []),
                },
                output_data=record["entity_profile"],
            )

        # Add token matching observation (if present)
        if record.get("token_matches"):
            self.trace_logger.add_observation(
                trace_id=trace_id,
                obs_type="span",
                name="token_matching",
                input_data={"entity_profile": record.get("entity_profile")},
                output_data={
                    "candidates": record["token_matches"],
                    "num_candidates": len(record["token_matches"]),
                },
                metadata={"fuzzy_threshold": 0.7},
            )

        # Add LLM ranking observation (if present)
        if record.get("candidates"):
            self.trace_logger.add_generation(
                trace_id=trace_id,
                name="llm_ranking",
                model=record.get("llm_provider", "unknown"),
                input_data={
                    "entity_profile": record.get("entity_profile"),
                    "candidates": record.get("token_matches", []),
                },
                output_data={
                    "ranked_candidates": record["candidates"],
                    "top_candidate": record["target"],
                },
            )

        # Add scores
        self.trace_logger.add_score(
            trace_id=trace_id,
            name="confidence",
            value=record.get("confidence", 0),
            data_type="numeric",
        )

        self.trace_logger.add_score(
            trace_id=trace_id,
            name="latency_ms",
            value=record.get("total_time", 0) * 1000,
            data_type="numeric",
        )

        # End trace
        self.trace_logger.end_trace(
            trace_id=trace_id,
            final_output={
                "target": record["target"],
                "method": record["method"],
                "confidence": record.get("confidence", 0),
            },
            status="SUCCESS",
        )

        return trace_id

    def _update_run_metrics(self, run_id: str, record: Dict[str, Any]):
        """Update aggregate metrics for the run."""
        # Read existing evaluation results to compute aggregate metrics
        # Path without /runs/ subdirectory (MLflow-compatible structure)
        run_path = self.base_path / self.experiment_id / run_id
        results_file = run_path / "artifacts" / "evaluation_results.jsonl"

        if not results_file.exists():
            return

        # Read all results
        results = []
        with open(results_file, 'r') as f:
            for line in f:
                results.append(json.loads(line))

        # Compute aggregate metrics
        total = len(results)
        if total == 0:
            return

        avg_confidence = sum(r.get("confidence", 0) for r in results) / total
        avg_latency = sum(r.get("latency_ms", 0) for r in results) / total

        # Count by method
        methods = {}
        for r in results:
            method = r.get("method", "unknown")
            methods[method] = methods.get(method, 0) + 1

        # Update metrics
        metrics = {
            "num_queries": total,
            "avg_confidence": avg_confidence,
            "avg_latency_ms": avg_latency,
            **{f"count_{method}": count for method, count in methods.items()},
        }

        self.run_manager.log_metrics(run_id, metrics)

    def end_run(self):
        """End the current run (called at shutdown or end of day)."""
        if self.current_run_id and self.run_manager:
            self.run_manager.end_run(self.current_run_id, status="FINISHED")
            self.current_run_id = None
            self.current_run_date = None


# Singleton instance
_live_logger: Optional[LiveExperimentLogger] = None


def get_live_logger() -> LiveExperimentLogger:
    """Get or create the singleton live experiment logger."""
    global _live_logger
    if _live_logger is None:
        _live_logger = LiveExperimentLogger()
    return _live_logger


def log_to_experiments(record: Dict[str, Any]) -> str:
    """
    Convenience function to log a match to the main production experiment.

    Args:
        record: Activity log record

    Returns:
        trace_id
    """
    logger = get_live_logger()
    return logger.log_match(record)
