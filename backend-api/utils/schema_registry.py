"""
Schema Registry - Versioned JSON schema management following the same pattern as prompt_registry.py.

Structure:
    logs/schemas/
    └── <schema_family>/
        └── <version>/
            ├── metadata.json
            └── schema.json
"""

import json
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime


class SchemaRegistry:
    """
    Manages versioned JSON schemas with metadata tracking.

    Mirrors the PromptRegistry pattern for consistency.
    """

    def __init__(self, base_path: str = "logs/schemas"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def register_schema(
        self,
        family: str,
        version: int,
        schema: Dict[str, Any],
        description: str = "",
        fields: List[str] = None,
        metadata: Dict[str, Any] = None
    ):
        """
        Register a new schema version.

        Args:
            family: Schema family name (e.g., "entity_profile")
            version: Version number (integer)
            schema: JSON schema dict
            description: Human-readable description
            fields: List of top-level field names in the schema
            metadata: Additional metadata (author, tags, etc.)
        """
        schema_dir = self.base_path / family / str(version)
        schema_dir.mkdir(parents=True, exist_ok=True)

        # Save schema
        with open(schema_dir / "schema.json", "w", encoding="utf-8") as f:
            json.dump(schema, f, indent=2)

        # Extract fields from schema if not provided
        if fields is None and "properties" in schema:
            fields = list(schema["properties"].keys())

        # Save metadata
        meta = {
            "version": version,
            "family": family,
            "description": description,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "fields": fields or [],
            "metadata": metadata or {}
        }

        with open(schema_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        print(f"[SCHEMA_REGISTRY] Registered {family} v{version}")

    def get_schema(self, family: str, version: Optional[int] = None) -> Dict[str, Any]:
        """
        Get JSON schema.

        Args:
            family: Schema family name
            version: Version number (if None, gets latest)

        Returns:
            Parsed JSON schema dict
        """
        if version is None:
            version = self.get_latest_version(family)

        schema_file = self.base_path / family / str(version) / "schema.json"

        if not schema_file.exists():
            raise FileNotFoundError(f"Schema not found: {family} v{version}")

        with open(schema_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_metadata(self, family: str, version: Optional[int] = None) -> Dict:
        """Get schema metadata."""
        if version is None:
            version = self.get_latest_version(family)

        meta_file = self.base_path / family / str(version) / "metadata.json"

        if not meta_file.exists():
            raise FileNotFoundError(f"Metadata not found: {family} v{version}")

        with open(meta_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_latest_version(self, family: str) -> int:
        """Get latest version number for a schema family."""
        family_dir = self.base_path / family

        if not family_dir.exists():
            raise FileNotFoundError(f"Schema family not found: {family}")

        versions = [
            int(d.name) for d in family_dir.iterdir()
            if d.is_dir() and d.name.isdigit()
        ]

        if not versions:
            raise FileNotFoundError(f"No versions found for: {family}")

        return max(versions)

    def list_families(self) -> List[str]:
        """List all schema families."""
        if not self.base_path.exists():
            return []

        return [
            d.name for d in self.base_path.iterdir()
            if d.is_dir()
        ]

    def list_versions(self, family: str) -> List[int]:
        """List all versions for a schema family."""
        family_dir = self.base_path / family

        if not family_dir.exists():
            return []

        versions = [
            int(d.name) for d in family_dir.iterdir()
            if d.is_dir() and d.name.isdigit()
        ]

        return sorted(versions)


# Singleton instance
_registry: Optional[SchemaRegistry] = None


def get_schema_registry() -> SchemaRegistry:
    """Get or create singleton schema registry."""
    global _registry
    if _registry is None:
        _registry = SchemaRegistry()
    return _registry


def initialize_default_schemas():
    """
    Initialize default schemas in the registry.

    Registers entity_profile and llm_ranking_output schemas as v1.
    Skips families that already exist.
    """
    registry = get_schema_registry()
    existing = set(registry.list_families())
    registered = []

    # ========================================================================
    # ENTITY PROFILE SCHEMA - v1
    # ========================================================================
    if "entity_profile" not in existing:
        entity_profile_schema = {
            "type": "object",
            "properties": {
                "entity_name": {"type": "string"},
                "core_concept": {"type": "string", "description": "The single word that defines what this expression represents"},
                "distinguishing_features": {"type": "array", "items": {"type": "string"}},
                "key_properties": {"type": "array", "items": {"type": "string"}},
                "technical_specifications": {"type": "array", "items": {"type": "string"}, "description": "Explicit technical specs, dimensions, codes, ratings, tolerances"},
                "alternative_names": {"type": "array", "items": {"type": "string"}},
                "classification_aliases": {"type": "array", "items": {"type": "string"}, "description": "Full spectrum of valid ways this entity could be referenced using expert-level terminology, from precise to generic"},
                "constituent_materials": {"type": "array", "items": {"type": "string"}, "description": "All materials that make up this product, both explicit and standard/typical materials inferred from domain knowledge"},
                "manufacturing_processes": {"type": "array", "items": {"type": "string"}, "description": "Both stated and inferred manufacturing processes based on product type, materials, and industry standards"},
                "applications": {"type": "array", "items": {"type": "string"}, "description": "Direct and derived applications based on product characteristics"},
                "notes": {"type": "array", "items": {"type": "string"}}
            },
            "required": [
                "entity_name", "core_concept",
                "distinguishing_features", "key_properties", "technical_specifications",
                "alternative_names", "classification_aliases",
                "constituent_materials", "manufacturing_processes",
                "applications", "notes"
            ]
        }
        registry.register_schema(
            family="entity_profile",
            version=1,
            schema=entity_profile_schema,
            description="Entity profile extraction schema for web research pipeline",
            metadata={
                "author": "system",
                "use_case": "Structured entity extraction from web research",
                "compatible_prompts": ["entity_profiling"]
            }
        )
        registered.append("entity_profile v1")

    # ========================================================================
    # LLM RANKING OUTPUT SCHEMA - v1
    # ========================================================================
    if "llm_ranking_output" not in existing:
        llm_ranking_output_schema = {
            "type": "object",
            "properties": {
                "profile_summary": {"type": "string", "description": "1-2 sentence summary of the entity profile"},
                "core_concept_description": {"type": "string", "description": "Description of the core concept match"},
                "ranked_candidates": {
                    "type": "array",
                    "description": "Candidates ranked by relevance score",
                    "items": {
                        "type": "object",
                        "properties": {
                            "candidate": {"type": "string"},
                            "core_concept_score": {"type": "number"},
                            "spec_score": {"type": "number"},
                            "evaluation_reasoning": {"type": "string"},
                            "key_match_factors": {"type": "array", "items": {"type": "string"}},
                            "spec_gaps": {"type": "array", "items": {"type": "string"}}
                        },
                        "required": ["candidate", "core_concept_score", "spec_score",
                                     "evaluation_reasoning", "key_match_factors"]
                    }
                }
            },
            "required": ["profile_summary", "core_concept_description", "ranked_candidates"]
        }
        registry.register_schema(
            family="llm_ranking_output",
            version=1,
            schema=llm_ranking_output_schema,
            description="LLM ranking step output schema — structured candidate evaluation",
            fields=["profile_summary", "core_concept_description", "ranked_candidates"],
            metadata={
                "author": "system",
                "use_case": "Structured output from LLM candidate ranking",
                "compatible_prompts": ["llm_ranking"]
            }
        )
        registered.append("llm_ranking_output v1")

    if registered:
        print(f"\n[SCHEMA_REGISTRY] Initialized default schemas: {', '.join(registered)}")
    else:
        print("[SCHEMA_REGISTRY] All default schemas already exist, skipping")


if __name__ == "__main__":
    # Initialize default schemas
    initialize_default_schemas()

    # Test retrieval
    registry = get_schema_registry()

    print("\n\nSchema families:", registry.list_families())

    for family in registry.list_families():
        versions = registry.list_versions(family)
        print(f"\n{family}: versions {versions}")

        latest = registry.get_latest_version(family)
        meta = registry.get_metadata(family, latest)
        print(f"  Latest (v{latest}): {meta['description']}")
        print(f"  Fields: {meta['fields']}")
