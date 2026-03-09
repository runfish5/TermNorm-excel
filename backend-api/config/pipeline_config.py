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
