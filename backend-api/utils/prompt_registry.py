"""
Prompt Registry - Versioned prompt management following MLflow best practices.

Structure:
    logs/prompts/
    └── <prompt_family>/
        └── <version>/
            ├── metadata.json
            └── prompt.txt (or prompt.yml for GitHub Models format)
"""

import json
import logging
from pathlib import Path
from typing import Any
from utils.utils import utcnow_iso

logger = logging.getLogger(__name__)


def substitute_vars(template: str, **variables: str) -> str:
    """Fill ``{{name}}`` placeholders in a caller-supplied prompt template.

    The one substitution path for the custom-prompt escape hatch (a node overriding the registry
    prompt via ``config.prompt``); the registry path renders through :meth:`PromptRegistry.render_prompt`.
    Unknown placeholders are left intact so an injection check can flag them.
    """
    for name, value in variables.items():
        template = template.replace(f"{{{{{name}}}}}", value)
    return template


class PromptRegistry:
    """
    Manages versioned prompts with metadata tracking.

    Compatible with MLflow Prompt Registry format.
    """

    def __init__(self, base_path: str = "logs/prompts"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def register_prompt(
        self,
        family: str,
        version: int,
        template: str,
        description: str = "",
        template_variables: list = None,
        metadata: dict[str, Any] = None
    ):
        """
        Register a new prompt version.

        Args:
            family: Prompt family name (e.g., "entity_profiling", "llm_ranking")
            version: Version number (integer)
            template: Prompt template text with {{variable}} placeholders
            description: Human-readable description
            template_variables: List of variable names used in template
            metadata: Additional metadata (author, tags, etc.)
        """
        prompt_dir = self.base_path / family / str(version)
        prompt_dir.mkdir(parents=True, exist_ok=True)

        # Save prompt template
        with open(prompt_dir / "prompt.txt", "w", encoding="utf-8") as f:
            f.write(template)

        # Save metadata
        meta = {
            "version": version,
            "family": family,
            "description": description,
            "created_at": utcnow_iso(),
            "template_variables": template_variables or [],
            "metadata": metadata or {}
        }

        with open(prompt_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        logger.info(f"[PROMPT_REGISTRY] Registered {family} v{version}")

    def get_prompt(self, family: str, version: int | None = None) -> str:
        """
        Get prompt template.

        Args:
            family: Prompt family name
            version: Version number (if None, gets latest)

        Returns:
            Prompt template text
        """
        if version is None:
            version = self.get_latest_version(family)

        version_dir = self.base_path / family / str(version)
        canonical_file = version_dir / "canonical.json"
        if canonical_file.exists():
            with open(canonical_file, "r", encoding="utf-8") as f:
                template = json.load(f)
            # Match PromptPotter's PromptTemplate.render(): join the 6 canonical
            # string fields with blank lines, skipping empty ones.
            six_fields = (
                "persona",
                "task_intent",
                "problem_description",
                "instruction",
                "thinking_style",
                "answer_format",
            )
            return "\n\n".join(v for f in six_fields if (v := template.get(f)))

        prompt_file = version_dir / "prompt.txt"
        if not prompt_file.exists():
            raise FileNotFoundError(f"Prompt not found: {family} v{version}")

        return prompt_file.read_text(encoding="utf-8")

    def get_metadata(self, family: str, version: int | None = None) -> dict:
        """Get prompt metadata."""
        if version is None:
            version = self.get_latest_version(family)

        meta_file = self.base_path / family / str(version) / "metadata.json"

        if not meta_file.exists():
            raise FileNotFoundError(f"Metadata not found: {family} v{version}")

        with open(meta_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_latest_version(self, family: str) -> int:
        """Get latest version number for a prompt family."""
        family_dir = self.base_path / family

        if not family_dir.exists():
            raise FileNotFoundError(f"Prompt family not found: {family}")

        versions = [
            int(d.name) for d in family_dir.iterdir()
            if d.is_dir() and d.name.isdigit()
        ]

        if not versions:
            raise FileNotFoundError(f"No versions found for: {family}")

        return max(versions)

    def list_families(self) -> list:
        """List all prompt families."""
        if not self.base_path.exists():
            return []

        return [
            d.name for d in self.base_path.iterdir()
            if d.is_dir()
        ]

    def list_versions(self, family: str) -> list:
        """List all versions for a prompt family."""
        family_dir = self.base_path / family

        if not family_dir.exists():
            return []

        versions = [
            int(d.name) for d in family_dir.iterdir()
            if d.is_dir() and d.name.isdigit()
        ]

        return sorted(versions)

    def render_prompt(
        self,
        family: str,
        version: int | None = None,
        **kwargs
    ) -> str:
        """
        Render prompt template with variables.

        Args:
            family: Prompt family name
            version: Version number (if None, uses latest)
            **kwargs: Template variables

        Returns:
            Rendered prompt text
        """
        template = self.get_prompt(family, version)

        # Replace {{variable}} placeholders
        for key, value in kwargs.items():
            template = template.replace(f"{{{{{key}}}}}", str(value))

        return template


# Singleton instance
_registry: PromptRegistry | None = None


def get_prompt_registry() -> PromptRegistry:
    """Get or create singleton prompt registry."""
    global _registry
    if _registry is None:
        _registry = PromptRegistry()
    return _registry


if __name__ == "__main__":
    # Inspection only. Prompts are authored on disk (canonical.json) and git-tracked; nothing
    # bootstraps them from Python, so editing a Python literal would NOT change the live prompt.
    registry = get_prompt_registry()

    logger.info("Prompt families: %s", registry.list_families())

    for family in registry.list_families():
        versions = registry.list_versions(family)
        logger.info("%s: versions %s", family, versions)

        latest = registry.get_latest_version(family)
        meta = registry.get_metadata(family, latest)
        logger.info("  Latest (v%d): %s", latest, meta['description'])
        logger.info("  Variables: %s", meta['template_variables'])
