"""
Dataset manager for handling evaluation datasets.

Follows OpenAI Evals conventions:
- JSONL format for datasets
- Naming: <name>.<split>.<version>
- Standard fields: input, ideal, metadata

References:
- OpenAI Evals: https://github.com/openai/evals
- JSONL: https://jsonlines.org/
"""

import json
import jsonlines
from pathlib import Path
from typing import Dict, List, Optional, Iterator
from datetime import datetime

from registry.schemas import (
    DatasetSample,
    DatasetMetadata,
    DatasetRegistry,
    DataSplit,
)


class DatasetManager:
    """
    Manager for dataset creation, loading, and querying.

    Responsibilities:
    - Create new datasets
    - Load datasets from JSONL
    - Query dataset metadata
    - Validate dataset format
    """

    def __init__(self, registry_root: Path):
        """
        Initialize dataset manager.

        Args:
            registry_root: Root directory for registry data
        """
        self.registry_root = Path(registry_root)
        self.datasets_dir = self.registry_root / "datasets"
        self.datasets_dir.mkdir(parents=True, exist_ok=True)

        # Registry index
        self.registry_file = self.datasets_dir / "datasets_registry.json"
        self.registry = self._load_registry()

    def _load_registry(self) -> DatasetRegistry:
        """Load dataset registry from disk."""
        if self.registry_file.exists():
            with open(self.registry_file, 'r') as f:
                data = json.load(f)
            return DatasetRegistry(**data)
        else:
            return DatasetRegistry()

    def _save_registry(self) -> None:
        """Save dataset registry to disk."""
        with open(self.registry_file, 'w') as f:
            json.dump(self.registry.dict(), f, indent=2, default=str)

    def create_dataset(
        self,
        name: str,
        split: DataSplit,
        version: str,
        samples: List[DatasetSample],
        description: str = "",
        created_by: str = "system",
        tags: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> DatasetMetadata:
        """
        Create a new dataset.

        Args:
            name: Dataset name (e.g., 'termnorm_queries')
            split: Data split (train/val/test/dev)
            version: Version identifier (e.g., 'v0', 'v1')
            samples: List of dataset samples
            description: Human-readable description
            created_by: Creator identifier
            tags: Optional tags
            **kwargs: Additional metadata fields

        Returns:
            DatasetMetadata

        Example:
            samples = [
                DatasetSample(
                    input={"query": "stainless steel pipe", "terms": ["steel pipe", ...]},
                    ideal="stainless piping",
                    metadata={"category": "materials"}
                ),
                ...
            ]

            metadata = manager.create_dataset(
                name="termnorm_queries",
                split=DataSplit.TEST,
                version="v0",
                samples=samples,
                description="Test queries for evaluation",
                created_by="user@example.com"
            )
        """
        # Generate dataset_id
        dataset_id = f"{name}.{split.value}.{version}"

        # Check if already exists
        if self.registry.get_dataset(dataset_id):
            raise ValueError(f"Dataset {dataset_id} already exists")

        # Create JSONL file
        file_path = self.datasets_dir / f"{dataset_id}.jsonl"

        with jsonlines.open(file_path, mode='w') as writer:
            for sample in samples:
                writer.write(sample.dict())

        # Collect statistics
        categories = set()
        sources = set()
        for sample in samples:
            if sample.category:
                categories.add(sample.category)
            if sample.source:
                sources.add(sample.source)

        # Create metadata
        metadata = DatasetMetadata.from_components(
            name=name,
            split=split,
            version=version,
            description=description,
            created_by=created_by,
            created_at=datetime.now(),
            file_path=str(file_path),
            num_samples=len(samples),
            categories=list(categories),
            sources=list(sources),
            tags=tags or {},
            **kwargs
        )

        # Register dataset
        self.registry.register_dataset(metadata)
        self._save_registry()

        return metadata

    def load_dataset(self, dataset_id: str) -> Optional[List[DatasetSample]]:
        """
        Load dataset samples from JSONL file.

        Args:
            dataset_id: Dataset identifier (name.split.version)

        Returns:
            List of DatasetSample objects or None if not found
        """
        metadata = self.registry.get_dataset(dataset_id)
        if not metadata:
            return None

        file_path = Path(metadata.file_path)
        if not file_path.exists():
            return None

        samples = []
        with jsonlines.open(file_path) as reader:
            for obj in reader:
                samples.append(DatasetSample(**obj))

        return samples

    def stream_dataset(self, dataset_id: str) -> Optional[Iterator[DatasetSample]]:
        """
        Stream dataset samples (for large datasets).

        Args:
            dataset_id: Dataset identifier

        Yields:
            DatasetSample objects
        """
        metadata = self.registry.get_dataset(dataset_id)
        if not metadata:
            return None

        file_path = Path(metadata.file_path)
        if not file_path.exists():
            return None

        def sample_generator():
            with jsonlines.open(file_path) as reader:
                for obj in reader:
                    yield DatasetSample(**obj)

        return sample_generator()

    def get_dataset_metadata(self, dataset_id: str) -> Optional[DatasetMetadata]:
        """
        Get dataset metadata.

        Args:
            dataset_id: Dataset identifier

        Returns:
            DatasetMetadata or None if not found
        """
        return self.registry.get_dataset(dataset_id)

    def list_datasets(
        self,
        name: Optional[str] = None,
        split: Optional[DataSplit] = None,
        version: Optional[str] = None
    ) -> List[DatasetMetadata]:
        """
        List datasets with optional filtering.

        Args:
            name: Filter by dataset name
            split: Filter by data split
            version: Filter by version

        Returns:
            List of DatasetMetadata
        """
        return self.registry.list_datasets(name=name, split=split, version=version)

    def get_latest_version(self, name: str, split: DataSplit) -> Optional[DatasetMetadata]:
        """
        Get latest version of a dataset.

        Args:
            name: Dataset name
            split: Data split

        Returns:
            DatasetMetadata for latest version or None
        """
        return self.registry.get_latest_version(name, split)

    def append_samples(self, dataset_id: str, samples: List[DatasetSample]) -> None:
        """
        Append samples to an existing dataset.

        Args:
            dataset_id: Dataset identifier
            samples: List of samples to append
        """
        metadata = self.registry.get_dataset(dataset_id)
        if not metadata:
            raise ValueError(f"Dataset {dataset_id} not found")

        file_path = Path(metadata.file_path)

        # Append to JSONL
        with jsonlines.open(file_path, mode='a') as writer:
            for sample in samples:
                writer.write(sample.dict())

        # Update metadata
        metadata.num_samples += len(samples)

        # Update statistics
        categories = set(metadata.categories)
        sources = set(metadata.sources)
        for sample in samples:
            if sample.category:
                categories.add(sample.category)
            if sample.source:
                sources.add(sample.source)

        metadata.categories = list(categories)
        metadata.sources = list(sources)

        # Save registry
        self._save_registry()

    def validate_dataset(self, dataset_id: str) -> Dict[str, any]:
        """
        Validate dataset format and completeness.

        Args:
            dataset_id: Dataset identifier

        Returns:
            Validation report dict with issues and statistics
        """
        metadata = self.registry.get_dataset(dataset_id)
        if not metadata:
            return {"error": f"Dataset {dataset_id} not found"}

        file_path = Path(metadata.file_path)
        if not file_path.exists():
            return {"error": f"Dataset file not found: {file_path}"}

        issues = []
        stats = {
            "total_samples": 0,
            "samples_with_ideal": 0,
            "samples_with_metadata": 0,
            "unique_categories": set(),
            "unique_sources": set(),
        }

        with jsonlines.open(file_path) as reader:
            for i, obj in enumerate(reader):
                stats["total_samples"] += 1

                # Check required fields
                if "input" not in obj:
                    issues.append(f"Sample {i}: missing 'input' field")

                # Check ideal
                if "ideal" in obj and obj["ideal"] is not None:
                    stats["samples_with_ideal"] += 1

                # Check metadata
                if "metadata" in obj and obj["metadata"]:
                    stats["samples_with_metadata"] += 1

                # Collect categories and sources
                if "category" in obj and obj["category"]:
                    stats["unique_categories"].add(obj["category"])
                if "source" in obj and obj["source"]:
                    stats["unique_sources"].add(obj["source"])

        stats["unique_categories"] = list(stats["unique_categories"])
        stats["unique_sources"] = list(stats["unique_sources"])

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "statistics": stats
        }
