"""
Cache metadata tracking for match_database.json.

Tracks when cache was last updated and provides staleness detection.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional


class CacheMetadata:
    """
    Tracks metadata about the loaded match_database cache.

    Stores information about:
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
                "cache_version": "2.0",
                "last_updated": None,
                "last_rebuild_timestamp": None,
                "sources": {
                    "langfuse": {
                        "enabled": True,
                        "last_processed": None,
                        "traces_loaded": 0,
                    },
                },
                "statistics": {
                    "total_identifiers": 0,
                    "total_aliases": 0,
                    "total_records_processed": 0,
                },
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
        """Mark completion of cache rebuild and record statistics."""
        now = datetime.utcnow().isoformat() + "Z"

        self.metadata["last_updated"] = now
        self.metadata["rebuild_in_progress"] = False

        # Update langfuse source info
        if "langfuse" not in self.metadata["sources"]:
            self.metadata["sources"]["langfuse"] = {"enabled": True}
        self.metadata["sources"]["langfuse"]["last_processed"] = now
        self.metadata["sources"]["langfuse"]["traces_loaded"] = records_processed

        # Update statistics
        self.metadata["statistics"]["total_identifiers"] = identifiers_count
        self.metadata["statistics"]["total_aliases"] = aliases_count
        self.metadata["statistics"]["total_records_processed"] = records_processed

        self.save()

    def add_incremental_update(
        self,
        source: str,
        records_added: int,
        identifiers_added: int = 0,
        identifiers_updated: int = 0,
    ):
        """Record an incremental update (e.g., after logging a new match)."""
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

    def get_cache_age_seconds(self) -> Optional[float]:
        """Get age of cache in seconds since last update."""
        if not self.metadata.get("last_updated"):
            return None

        last_updated = datetime.fromisoformat(self.metadata["last_updated"].replace("Z", "+00:00"))
        now = datetime.utcnow().replace(tzinfo=last_updated.tzinfo)
        return (now - last_updated).total_seconds()

    def is_stale(self, max_age_seconds: int = 3600) -> bool:
        """Check if cache is stale (older than max_age_seconds)."""
        age = self.get_cache_age_seconds()
        if age is None:
            return True
        return age > max_age_seconds

    def get_summary(self) -> Dict:
        """Get human-readable summary of cache status."""
        age = self.get_cache_age_seconds()
        age_str = f"{age:.0f} seconds ago" if age else "never"

        # Handle both old and new metadata formats
        langfuse_source = self.metadata.get("sources", {}).get("langfuse", {})

        return {
            "cache_version": self.metadata.get("cache_version", "1.0"),
            "last_updated": self.metadata.get("last_updated", "never"),
            "age": age_str,
            "is_stale": self.is_stale(),
            "total_identifiers": self.metadata.get("statistics", {}).get("total_identifiers", 0),
            "total_aliases": self.metadata.get("statistics", {}).get("total_aliases", 0),
            "total_records": self.metadata.get("statistics", {}).get("total_records_processed", 0),
            "langfuse_traces_loaded": langfuse_source.get("traces_loaded", 0),
        }

    def __repr__(self):
        summary = self.get_summary()
        return (
            f"CacheMetadata("
            f"identifiers={summary['total_identifiers']}, "
            f"aliases={summary['total_aliases']}, "
            f"age={summary['age']}, "
            f"stale={summary['is_stale']})"
        )
