"""
Cache metadata tracking for match_database.json.

Tracks which experiments/runs are loaded in cache and when it was last updated.
Enables sophisticated cache synchronization and staleness detection.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Set


class CacheMetadata:
    """
    Tracks metadata about the loaded match_database cache.

    Stores information about:
    - Which experiments are included in the cache
    - Which runs from each experiment are included
    - When the cache was last updated
    - Total number of records loaded
    - Data freshness indicators
    """

    def __init__(self, metadata_path: Path = None):
        if metadata_path is None:
            metadata_path = Path(__file__).parent.parent / "logs" / "match_database_metadata.json"

        self.metadata_path = metadata_path
        self.metadata = self._load_metadata()

    def _load_metadata(self) -> Dict:
        """Load metadata from disk or create new."""
        if self.metadata_path.exists():
            with open(self.metadata_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        else:
            return {
                "cache_version": "1.0",
                "last_updated": None,
                "last_rebuild_timestamp": None,
                "sources": {
                    "activity.jsonl": {
                        "enabled": True,
                        "last_processed": None,
                        "records_loaded": 0,
                    },
                    "experiments": {
                        "enabled": False,  # Will enable after migration
                        "last_processed": None,
                        "experiments_loaded": [],
                    },
                },
                "statistics": {
                    "total_identifiers": 0,
                    "total_aliases": 0,
                    "total_records_processed": 0,
                },
                "data_sources": [],  # List of {type, path, timestamp, records_loaded}
            }

    def save(self):
        """Save metadata to disk."""
        self.metadata_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.metadata_path, 'w', encoding='utf-8') as f:
            json.dump(self.metadata, f, indent=2, ensure_ascii=False)

    def mark_rebuild_start(self, source_type: str):
        """Mark the start of a cache rebuild operation."""
        self.metadata["last_rebuild_timestamp"] = datetime.utcnow().isoformat() + "Z"
        self.metadata["rebuild_in_progress"] = True
        self.metadata["rebuild_source"] = source_type
        self.save()

    def mark_rebuild_complete(
        self,
        source_type: str,
        records_processed: int,
        identifiers_count: int,
        aliases_count: int,
        data_sources: List[Dict] = None,
    ):
        """
        Mark completion of cache rebuild and record statistics.

        Args:
            source_type: "activity.jsonl" or "experiments"
            records_processed: Number of records processed
            identifiers_count: Number of unique identifiers in cache
            aliases_count: Number of alias mappings
            data_sources: List of source details (experiments, runs, files)
        """
        now = datetime.utcnow().isoformat() + "Z"

        self.metadata["last_updated"] = now
        self.metadata["rebuild_in_progress"] = False

        # Update source-specific info
        if source_type == "activity.jsonl":
            self.metadata["sources"]["activity.jsonl"]["last_processed"] = now
            self.metadata["sources"]["activity.jsonl"]["records_loaded"] = records_processed
        elif source_type == "experiments":
            self.metadata["sources"]["experiments"]["last_processed"] = now
            if data_sources:
                self.metadata["sources"]["experiments"]["experiments_loaded"] = [
                    ds for ds in data_sources if ds.get("type") == "experiment"
                ]

        # Update statistics
        self.metadata["statistics"]["total_identifiers"] = identifiers_count
        self.metadata["statistics"]["total_aliases"] = aliases_count
        self.metadata["statistics"]["total_records_processed"] = records_processed

        # Update data sources list
        if data_sources:
            self.metadata["data_sources"] = data_sources

        self.save()

    def add_incremental_update(
        self,
        source: str,
        records_added: int,
        identifiers_added: int = 0,
        identifiers_updated: int = 0,
    ):
        """
        Record an incremental update (e.g., after logging a new match).

        Args:
            source: Source of update ("frontend", "backend_pipeline", etc.)
            records_added: Number of new records
            identifiers_added: Number of new identifiers created
            identifiers_updated: Number of existing identifiers updated
        """
        now = datetime.utcnow().isoformat() + "Z"
        self.metadata["last_updated"] = now

        # Track incremental updates
        if "incremental_updates" not in self.metadata:
            self.metadata["incremental_updates"] = []

        self.metadata["incremental_updates"].append({
            "timestamp": now,
            "source": source,
            "records_added": records_added,
            "identifiers_added": identifiers_added,
            "identifiers_updated": identifiers_updated,
        })

        # Keep only last 100 incremental updates
        if len(self.metadata["incremental_updates"]) > 100:
            self.metadata["incremental_updates"] = self.metadata["incremental_updates"][-100:]

        self.save()

    def get_loaded_experiments(self) -> List[str]:
        """Get list of experiment IDs currently loaded in cache."""
        if self.metadata["sources"]["experiments"]["enabled"]:
            return [
                exp["experiment_id"]
                for exp in self.metadata["sources"]["experiments"]["experiments_loaded"]
            ]
        return []

    def get_loaded_runs(self, experiment_id: str) -> List[str]:
        """Get list of run IDs loaded from a specific experiment."""
        if not self.metadata["sources"]["experiments"]["enabled"]:
            return []

        for exp in self.metadata["sources"]["experiments"]["experiments_loaded"]:
            if exp.get("experiment_id") == experiment_id:
                return exp.get("runs_loaded", [])

        return []

    def is_experiment_loaded(self, experiment_id: str) -> bool:
        """Check if an experiment is currently loaded in cache."""
        return experiment_id in self.get_loaded_experiments()

    def is_run_loaded(self, experiment_id: str, run_id: str) -> bool:
        """Check if a specific run is loaded in cache."""
        return run_id in self.get_loaded_runs(experiment_id)

    def get_cache_age_seconds(self) -> Optional[float]:
        """
        Get age of cache in seconds since last update.

        Returns None if cache has never been updated.
        """
        if not self.metadata.get("last_updated"):
            return None

        last_updated = datetime.fromisoformat(self.metadata["last_updated"].replace("Z", "+00:00"))
        now = datetime.utcnow().replace(tzinfo=last_updated.tzinfo)
        return (now - last_updated).total_seconds()

    def is_stale(self, max_age_seconds: int = 3600) -> bool:
        """
        Check if cache is stale (older than max_age_seconds).

        Args:
            max_age_seconds: Maximum age before considering stale (default: 1 hour)

        Returns:
            True if stale or never updated, False otherwise
        """
        age = self.get_cache_age_seconds()
        if age is None:
            return True
        return age > max_age_seconds

    def needs_sync_with_experiments(self, experiments_path: Path) -> bool:
        """
        Check if cache needs to be synced with experiments structure.

        Compares loaded experiments against what exists on disk.

        Returns:
            True if there are new experiments/runs not in cache
        """
        if not experiments_path.exists():
            return False

        if not self.metadata["sources"]["experiments"]["enabled"]:
            # If experiments not enabled but directory exists, needs sync
            return True

        # Get experiments on disk
        disk_experiments = set()
        for exp_dir in experiments_path.iterdir():
            if exp_dir.is_dir():
                disk_experiments.add(exp_dir.name)

        # Get loaded experiments
        loaded_experiments = set(self.get_loaded_experiments())

        # Check if there are new experiments
        return not disk_experiments.issubset(loaded_experiments)

    def get_summary(self) -> Dict:
        """Get human-readable summary of cache status."""
        age = self.get_cache_age_seconds()
        age_str = f"{age:.0f} seconds ago" if age else "never"

        summary = {
            "cache_version": self.metadata["cache_version"],
            "last_updated": self.metadata.get("last_updated", "never"),
            "age": age_str,
            "is_stale": self.is_stale(),
            "total_identifiers": self.metadata["statistics"]["total_identifiers"],
            "total_aliases": self.metadata["statistics"]["total_aliases"],
            "total_records": self.metadata["statistics"]["total_records_processed"],
            "sources": {
                "activity.jsonl": {
                    "enabled": self.metadata["sources"]["activity.jsonl"]["enabled"],
                    "records_loaded": self.metadata["sources"]["activity.jsonl"]["records_loaded"],
                },
                "experiments": {
                    "enabled": self.metadata["sources"]["experiments"]["enabled"],
                    "experiments_count": len(self.get_loaded_experiments()),
                },
            },
        }

        return summary

    def __repr__(self):
        summary = self.get_summary()
        return (
            f"CacheMetadata("
            f"identifiers={summary['total_identifiers']}, "
            f"aliases={summary['total_aliases']}, "
            f"age={summary['age']}, "
            f"stale={summary['is_stale']})"
        )
