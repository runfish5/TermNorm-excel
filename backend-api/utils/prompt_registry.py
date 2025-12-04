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
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime


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
        metadata: Dict[str, Any] = None
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
            "created_at": datetime.utcnow().isoformat() + "Z",
            "template_variables": template_variables or [],
            "metadata": metadata or {}
        }

        with open(prompt_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        print(f"[PROMPT_REGISTRY] Registered {family} v{version}")

    def get_prompt(self, family: str, version: Optional[int] = None) -> str:
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

        prompt_file = self.base_path / family / str(version) / "prompt.txt"

        if not prompt_file.exists():
            raise FileNotFoundError(f"Prompt not found: {family} v{version}")

        return prompt_file.read_text(encoding="utf-8")

    def get_metadata(self, family: str, version: Optional[int] = None) -> Dict:
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
        version: Optional[int] = None,
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
_registry: Optional[PromptRegistry] = None


def get_prompt_registry() -> PromptRegistry:
    """Get or create singleton prompt registry."""
    global _registry
    if _registry is None:
        _registry = PromptRegistry()
    return _registry


def initialize_default_prompts():
    """
    Initialize default prompts from research_and_rank code.

    This extracts the hardcoded prompts and registers them as v1.
    """
    registry = get_prompt_registry()

    # ========================================================================
    # ENTITY PROFILING PROMPT - v1
    # ========================================================================
    entity_profiling_template = """You are a comprehensive technical database API specialized in exhaustive entity profiling. Extract ALL possible information about '{{query}}' from the research data and return it in this exact JSON format:
{{format_string}}

CRITICAL SPELLING REQUIREMENT: In ALL arrays, after each term, immediately add its US/GB spelling variant if different. Example: ["colour", "color", "analyse", "analyze"]. This is MANDATORY for every array field.

CORE CONCEPT IDENTIFICATION: Within '{{query}}', certain words carry more semantic weight than others. Material names, product codes, and specifications describe WHAT is involved, but other terms describe the fundamental NATURE of what is being expressed. Identify the single word that defines the conceptual essence - typically the term that indicates an activity, action, method, or process rather than an object or material. Output only this one defining word.

PROFESSIONAL CLASSIFICATION ALIASES: Generate the full spectrum of expert-level references for this entity, spanning precise technical descriptors to broader categorical terms. These terms stem from domain-specific terminology and industry-standard nomenclature that professionals recognize. Include approximations and near-equivalent terms that experts use when exact terminology doesn't exist, accepting that some terms may not be perfect equivalents but represent the best available expert terminology for referencing similar concepts.

GENERIC TECHNICAL INFERENCE INSTRUCTION: Given the product or technical description '{{query}}', perform comprehensive analysis to extract and infer:

1. **Explicit Information**: Directly stated specifications, dimensions, materials, codes, and properties
2. **Implicit Information**: Commonly associated materials, manufacturing processes, applications, and technical characteristics that are standard for this type of product/component, even if not explicitly mentioned
3. **Manufacturing Processes**: Both stated and inferred processes based on product type, materials, and specifications
4. **Material Composition**: Complete material breakdown including standard/typical materials used in such products
5. **Applications & Use Cases**: Direct and derived applications based on product characteristics

**Include domain knowledge**: Draw from technical standards, industry practices, and material science to infer missing but relevant information.

CRITICAL INSTRUCTIONS FOR RICH ATTRIBUTE COLLECTION:
- MAXIMIZE diversity: Include ALL synonyms, trade names, scientific names, abbreviations, acronyms, regional terms, industry terminology
- COMPREHENSIVE extraction: Capture every property, specification, feature, attribute, including numerical values and compositional data
- PRIORITIZE completeness over brevity: Aim for 5-10+ items per array field - be thorough, not minimal
---
RESEARCH DATA:
{{combined_text}}
---
REMEMBER: Every term must be followed by its US/GB variant if different. Return only the JSON object with ALL fields maximally populated."""

    registry.register_prompt(
        family="entity_profiling",
        version=1,
        template=entity_profiling_template,
        description="Extract comprehensive entity profile from web research data with US/GB spelling variants",
        template_variables=["query", "format_string", "combined_text"],
        metadata={
            "author": "TermNorm Team",
            "use_case": "Web research to structured entity profile",
            "model_recommendation": "llama-3.3-70b or gpt-4",
            "temperature": 0.0
        }
    )

    # ========================================================================
    # LLM RANKING PROMPT - v1
    # ========================================================================
    llm_ranking_template = """You are a candidate evaluation expert.

TASK 1: Analyze profile and core concept (PRIMARY FACTOR - 70% WEIGHT)
- Summarize the profile in 1-2 sentences capturing key details
- Identify the entity_category from the profile
- Think step-by-step: What are the most important distinguishing features of this entity?
- CRITICAL: Prioritize candidates that match the core_concept: '{{core_concept}}'
- Higher match = more of the distinguishing features present in the candidate name

TASK 2: Evaluate candidate matches (20 candidates provided)
- Each candidate will receive a relevance_score from 0.0 to 1.0
- 0.95+ : Exact or near-perfect semantic match (contains most/all distinguishing features + matches core_concept)
- 0.80-0.94 : Strong match (contains several key features + aligns with core_concept)
- 0.50-0.79 : Moderate match (contains some features OR loosely relates to core_concept)
- 0.00-0.49 : Weak/poor match (missing most features, doesn't match core_concept)

ENTITY PROFILE (JSON):
{{entity_profile_json}}

CANDIDATE MATCHES TO EVALUATE:
{{matches}}

IMPORTANT: Return a valid JSON response matching this exact structure:
{
    "reasoning": "[1-2 sentences explaining profile, entity_category, and key features]",
    "ranked_candidates": [
        {
            "rank": 1,
            "candidate": "...",
            "relevance_score": 0.95,
            "rationale": "[Brief explanation - 1 sentence]"
        }
    ]
}

Rules:
- Include ALL 20 candidates in ranked_candidates array
- Rank 1 = highest relevance_score
- relevance_score must decrease or stay equal as rank increases
- Return ONLY valid JSON, no other text"""

    registry.register_prompt(
        family="llm_ranking",
        version=1,
        template=llm_ranking_template,
        description="Rank candidate matches based on entity profile relevance with core concept weighting",
        template_variables=["core_concept", "entity_profile_json", "matches"],
        metadata={
            "author": "TermNorm Team",
            "use_case": "Candidate ranking for semantic matching",
            "model_recommendation": "llama-3.3-70b or gpt-4",
            "temperature": 0.0
        }
    )

    print("\n[PROMPT_REGISTRY] Initialized default prompts:")
    print("  - entity_profiling v1")
    print("  - llm_ranking v1")


if __name__ == "__main__":
    # Initialize default prompts
    initialize_default_prompts()

    # Test retrieval
    registry = get_prompt_registry()

    print("\n\nPrompt families:", registry.list_families())

    for family in registry.list_families():
        versions = registry.list_versions(family)
        print(f"\n{family}: versions {versions}")

        latest = registry.get_latest_version(family)
        meta = registry.get_metadata(family, latest)
        print(f"  Latest (v{latest}): {meta['description']}")
        print(f"  Variables: {meta['template_variables']}")
