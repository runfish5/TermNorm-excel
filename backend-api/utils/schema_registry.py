"""
Schema Registry - Versioned JSON schema management following the same pattern as prompt_registry.py.

Structure:
    logs/schemas/
    └── <schema_family>/
        └── <version>/
            ├── metadata.json
            └── schema.json

The on-disk ``schema.json`` is the ONLY source of truth. It is git-tracked, so a fresh clone
always has it; there is no bootstrap-from-Python path and no code that writes a v2.

FIELD ORDER IS LOAD-BEARING — never ``json.dump(..., sort_keys=True)`` a schema, and never
"tidy" a schema file by alphabetising it. The model generates fields in the order it reads
them, so each field becomes context for the next: evidence placed above a score conditions
that score, while evidence placed below it can only rationalise a number already emitted.
``format_string_from_schema`` renders these files straight into the prompt, so a reorder here
silently changes model behaviour. Same for ``description`` strings: they are prompt text, not
documentation, and for ``enum`` VALUE order — the model reads the first as prototypical.
(``enum`` values themselves are the wire contract; their order and the descriptions are not.)
See the PromptPotter note ``docs/concepts/structured-output.md``.
"""

import json
import logging
from pathlib import Path
from typing import Any
from datetime import datetime

logger = logging.getLogger(__name__)


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
        schema: dict[str, Any],
        description: str = "",
        fields: list[str] = None,
        metadata: dict[str, Any] = None
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

        # Save schema. NO sort_keys — field order is the lever (see module docstring).
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

        logger.info(f"[SCHEMA_REGISTRY] Registered {family} v{version}")

    def get_schema(self, family: str, version: int | None = None) -> dict[str, Any]:
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

    def get_metadata(self, family: str, version: int | None = None) -> dict:
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

    def list_families(self) -> list[str]:
        """List all schema families."""
        if not self.base_path.exists():
            return []

        return [
            d.name for d in self.base_path.iterdir()
            if d.is_dir()
        ]

    def list_versions(self, family: str) -> list[int]:
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
_registry: SchemaRegistry | None = None


def get_schema_registry() -> SchemaRegistry:
    """Get or create singleton schema registry."""
    global _registry
    if _registry is None:
        _registry = SchemaRegistry()
    return _registry


def _render_value(prop: dict[str, Any], indent: int) -> str:
    """Render one property's placeholder. ``indent`` is the column of the key line."""
    prop_type = prop.get("type", "string")

    # An `enum` IS the field's value space; a `description` is the rule for CHOOSING within it.
    # They are not rivals, so render BOTH — dropping the gloss would make the description axis
    # measure a channel that exists for some fields and not others, purely by which of them
    # happen to be enums. Rendered in DECLARATION ORDER — order is load-bearing here exactly as
    # it is for properties (the model reads the first value as prototypical), so never sort.
    #
    # This block is the whole reason the enum reaches the model at all on the free-form path:
    # `output_format="json"` sends no schema, and even on the `"schema"` path constrained
    # decoding is provider-dependent (Groq does not honor `enum`). The prompt TEACHES the value
    # space where the grammar does not COMPEL it.
    enum_values = prop.get("enum")
    if isinstance(enum_values, list) and enum_values:
        rendered = " | ".join(
            f'"{v}"' if isinstance(v, str) else json.dumps(v) for v in enum_values
        )
        gloss = prop.get("description")
        return f"{rendered}  // {gloss}" if gloss else rendered

    if prop_type == "string":
        # A `description` is prompt text, not documentation: it lands inside the field-filling
        # loop, adjacent to the slot it governs. Prefer it over the bare "string" placeholder.
        return f'"{prop.get("description", "string")}"'
    if prop_type in ("number", "integer"):
        return prop_type
    if prop_type == "boolean":
        return "true/false"
    if prop_type == "object":
        return _render_object(prop, indent) if "properties" in prop else '{"object"}'
    if prop_type == "array":
        items = prop.get("items", {})
        if items.get("type") == "object" and "properties" in items:
            pad = " " * indent
            return f'[\n{pad}  {_render_object(items, indent + 2)}\n{pad}]'
        return '["array of strings"]'
    return f'"{prop_type}"'


def _render_object(schema: dict[str, Any], indent: int) -> str:
    """Render an object body. ``indent`` is the column its closing brace sits at."""
    pad = " " * (indent + 2)
    lines = [
        f'{pad}"{name}": {_render_value(prop, indent + 2)}'
        for name, prop in schema["properties"].items()
    ]
    return "{\n" + ",\n".join(lines) + "\n" + " " * indent + "}"


def format_string_from_schema(schema: dict[str, Any]) -> str:
    """Render a JSON schema as the example structure block for an LLM prompt.

    This is what makes ``schema.json`` load-bearing rather than decorative: the emitted block
    preserves the schema's property ORDER and inlines its ``description`` strings, both of
    which steer generation (see module docstring). Recurses into arrays-of-objects.

    Scalar placeholders come from ``description`` when present; arrays render as a shape hint.
    """
    if "properties" not in schema:
        raise ValueError("Schema must contain 'properties' field")
    return _render_object(schema, 0)


if __name__ == "__main__":
    # Inspection only. Schemas are authored on disk and git-tracked; nothing bootstraps them
    # from Python, and nothing writes a v2 (see module docstring).
    registry = get_schema_registry()

    logger.info("Schema families: %s", registry.list_families())

    for family in registry.list_families():
        versions = registry.list_versions(family)
        logger.info("%s: versions %s", family, versions)

        latest = registry.get_latest_version(family)
        meta = registry.get_metadata(family, latest)
        logger.info("  Latest (v%d): %s", latest, meta['description'])
        logger.info("  Fields: %s", meta['fields'])
