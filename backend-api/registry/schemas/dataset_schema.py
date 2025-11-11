"""
Dataset schema based on OpenAI Evals conventions.

Standard format: JSONL (JSON Lines)
Naming convention: <name>.<split>.<version>
  - name: Dataset identifier (e.g., 'termnorm_queries')
  - split: Data split (e.g., 'train', 'val', 'test', 'dev')
  - version: Version identifier (e.g., 'v0', 'v1')

Example: 'termnorm_queries.test.v0'

References:
- OpenAI Evals: https://github.com/openai/evals
- JSONL Format: https://jsonlines.org/
"""

from typing import Dict, List, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, validator
from enum import Enum
import re


class DataSplit(str, Enum):
    """Standard data split types (OpenAI Evals convention)."""
    TRAIN = "train"
    VAL = "val"
    TEST = "test"
    DEV = "dev"


class DatasetSample(BaseModel):
    """
    Single dataset sample (OpenAI Evals JSONL format).

    Standard fields:
    - input: Input data (could be dict with 'query', 'terms', etc.)
    - ideal: Expected output (string or list of acceptable answers)
    - metadata: Optional additional information

    Reference: https://github.com/openai/evals/blob/main/evals/registry/data/README.md
    """
    input: Dict[str, Any] = Field(..., description="Input data for the sample")
    ideal: Optional[Any] = Field(None, description="Expected output (ground truth)")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

    # Domain-specific fields (TermNorm)
    sample_id: Optional[str] = Field(None, description="Unique sample identifier")
    category: Optional[str] = Field(None, description="Sample category for analysis")
    source: Optional[str] = Field(None, description="Source of the sample (e.g., 'production_logs')")


class DatasetMetadata(BaseModel):
    """
    Dataset metadata and configuration.

    Follows OpenAI Evals naming convention: <name>.<split>.<version>
    """
    dataset_id: str = Field(..., description="Full dataset identifier (name.split.version)")
    name: str = Field(..., description="Dataset name")
    split: DataSplit = Field(..., description="Data split type")
    version: str = Field(..., description="Version identifier (e.g., v0, v1)")

    description: str = Field(default="", description="Dataset description")
    created_at: datetime = Field(..., description="Creation timestamp")
    created_by: str = Field(..., description="Creator identifier")

    # File information
    file_path: str = Field(..., description="Path to JSONL file")
    num_samples: int = Field(..., description="Total number of samples")

    # Schema information
    input_schema: Optional[Dict[str, Any]] = Field(None, description="JSON schema for input field")
    output_schema: Optional[Dict[str, Any]] = Field(None, description="JSON schema for ideal field")

    # Statistics
    categories: List[str] = Field(default_factory=list, description="List of categories in dataset")
    sources: List[str] = Field(default_factory=list, description="Data sources")

    # Tags
    tags: Dict[str, str] = Field(default_factory=dict, description="Custom tags")

    @validator("dataset_id")
    def validate_dataset_id(cls, v, values):
        """
        Validate dataset_id follows OpenAI Evals convention.

        Format: <name>.<split>.<version>
        Example: termnorm_queries.test.v0
        """
        pattern = r"^[\w-]+\.(train|val|test|dev)\.v\d+$"
        if not re.match(pattern, v):
            raise ValueError(
                f"dataset_id must follow format '<name>.<split>.<version>' "
                f"(e.g., 'termnorm_queries.test.v0'), got: {v}"
            )
        return v

    @classmethod
    def from_components(cls, name: str, split: DataSplit, version: str, **kwargs) -> "DatasetMetadata":
        """
        Create DatasetMetadata from components.

        Args:
            name: Dataset name (e.g., 'termnorm_queries')
            split: Data split (train/val/test/dev)
            version: Version (e.g., 'v0', 'v1')
            **kwargs: Additional metadata fields

        Returns:
            DatasetMetadata instance

        Example:
            metadata = DatasetMetadata.from_components(
                name="termnorm_queries",
                split=DataSplit.TEST,
                version="v0",
                description="Test queries for TermNorm evaluation",
                created_by="user@example.com",
                created_at=datetime.now(),
                file_path="registry/data/datasets/termnorm_queries.test.v0.jsonl",
                num_samples=50
            )
        """
        dataset_id = f"{name}.{split.value}.{version}"
        return cls(
            dataset_id=dataset_id,
            name=name,
            split=split,
            version=version,
            **kwargs
        )


class DatasetRegistry(BaseModel):
    """
    Dataset registry entry for tracking all datasets.

    The registry maintains an index of all available datasets.
    """
    datasets: Dict[str, DatasetMetadata] = Field(
        default_factory=dict,
        description="Map of dataset_id to metadata"
    )

    def register_dataset(self, metadata: DatasetMetadata) -> None:
        """Register a new dataset."""
        self.datasets[metadata.dataset_id] = metadata

    def get_dataset(self, dataset_id: str) -> Optional[DatasetMetadata]:
        """Retrieve dataset metadata by ID."""
        return self.datasets.get(dataset_id)

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
            List of matching datasets
        """
        results = list(self.datasets.values())

        if name:
            results = [d for d in results if d.name == name]
        if split:
            results = [d for d in results if d.split == split]
        if version:
            results = [d for d in results if d.version == version]

        return results

    def get_latest_version(self, name: str, split: DataSplit) -> Optional[DatasetMetadata]:
        """Get the latest version of a dataset."""
        matching = self.list_datasets(name=name, split=split)
        if not matching:
            return None

        # Sort by version (assuming v0, v1, v2, ...)
        def version_key(d: DatasetMetadata) -> int:
            return int(d.version.lstrip('v'))

        return sorted(matching, key=version_key, reverse=True)[0]
