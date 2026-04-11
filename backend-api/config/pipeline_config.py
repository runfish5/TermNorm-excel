"""Centralized pipeline.json loader — single read at import time."""

import json
from pathlib import Path

_config = json.loads((Path(__file__).parent / "pipeline.json").read_text())


def get_pipeline_config():
    """Return the full pipeline config dict."""
    return _config


def get_node_config(name):
    """Return config for a named node (e.g. 'web_search', 'llm_ranking')."""
    return _config["nodes"][name]["config"]


def get_pipeline_steps(name):
    """Return step list for a named pipeline (e.g. 'default')."""
    return _config["pipelines"][name]


def get_cache_config():
    """Return cache section."""
    return _config.get("cache", {})


def get_llm_defaults():
    """Return llm_defaults section."""
    return _config.get("llm_defaults", {})


def get_session_required_steps() -> set[str]:
    """Return node names that require an active session (terms index)."""
    return {
        name
        for name, node in _config.get("nodes", {}).items()
        if node.get("requires_session", False)
    }


def get_node_input_keys(name: str) -> list[str]:
    """Return declared input_keys for a node (from optimizer block).

    These are *data* keys (e.g. ``entity_profile``, ``candidate_ranking``),
    not node names.
    """
    return _config["nodes"].get(name, {}).get("optimizer", {}).get("input_keys", [])


def get_node_output_keys(name: str) -> list[str]:
    """Return data keys a node produces (from observation_mappings)."""
    mappings = _config["nodes"].get(name, {}).get("optimizer", {}).get("observation_mappings", [])
    return [m["pipeline_key"] for m in mappings if "pipeline_key" in m]


def validate_step_dependencies(
    steps: list[str],
    pre_available: set[str] | None = None,
) -> list[str]:
    """Return node names in *steps* whose input_keys aren't satisfied.

    ``input_keys`` are *data* keys (e.g. ``entity_profile``), so we track
    which data keys each prior step produces (from ``observation_mappings``)
    plus the node name itself.  *pre_available* seeds the set (e.g.,
    precomputed output keys).
    """
    available: set[str] = set(pre_available) if pre_available else set()
    violations: list[str] = []
    for name in steps:
        deps = get_node_input_keys(name)
        if deps and any(k not in available for k in deps):
            violations.append(name)
        # Add this node's name + the data keys it produces
        available.add(name)
        available.update(get_node_output_keys(name))
    return violations
