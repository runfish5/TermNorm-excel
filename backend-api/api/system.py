"""
System API - Health checks, connection testing, and activity logging
"""
import logging
import os
import socket
from typing import Any
from fastapi import APIRouter, Body

from config.pipeline_config import get_pipeline_config
from config.settings import settings
from core import llm_providers
from services import match_database as match_db
from api.responses import _ok, _err

logger = logging.getLogger(__name__)

router = APIRouter()

EXPERIMENTS_PATH = __import__("pathlib").Path("logs/experiments")


def _get_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def _get_connection_info():
    environment = settings.environment_type
    local_ip = _get_local_ip()
    if environment in ("cloud", "network"):
        return ("Cloud API" if environment == "cloud" else "Network API",
                f"http://{local_ip}:8000", environment)
    return "Local API", "http://localhost:8000", environment


def _read_yaml(file_path) -> dict:
    data = {}
    try:
        for line in file_path.read_text().splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                value = value.strip().strip('"')
                try:
                    value = int(value)
                except ValueError:
                    if value == "None":
                        value = None
                data[key] = value
    except Exception:
        pass
    return data


@router.get("/health")
async def health() -> dict[str, Any]:
    """Health check endpoint - returns server status and environment info"""
    connection_type, connection_url, environment = _get_connection_info()
    return _ok("Server online", data={
        "provider": llm_providers.LLM_PROVIDER,
        "connection_type": connection_type,
        "connection_url": connection_url,
        "environment": environment,
    })


@router.get("/status")
async def status() -> dict[str, Any]:
    """Status endpoint — returns current server state for external tools."""
    db = match_db.get_db()

    # Scan experiments on disk
    experiments = []
    mappings_count = 0
    if EXPERIMENTS_PATH.exists():
        for exp_dir in EXPERIMENTS_PATH.iterdir():
            if not exp_dir.is_dir():
                continue
            meta_file = exp_dir / "meta.yaml"
            if not meta_file.exists():
                continue
            exp_id = exp_dir.name
            mappings_path = exp_dir / "mappings.tsv"
            exp_mappings = 0
            if mappings_path.exists():
                exp_mappings = max(0, sum(1 for _ in open(mappings_path)) - 1)
            mappings_count += exp_mappings
            experiments.append({"id": exp_id, "mappings": exp_mappings})

    pipeline_cfg = get_pipeline_config()

    return _ok("Server status", data={
        "match_database_identifiers": len(db),
        "match_database_aliases": sum(len(entry.get("aliases", {})) for entry in db.values()),
        "experiments_count": len(experiments),
        "mappings_count": mappings_count,
        "experiments": experiments,
        "pipeline_version": pipeline_cfg.get("version", "unknown"),
        "llm_provider": llm_providers.LLM_PROVIDER,
        "llm_model": llm_providers.LLM_MODEL,
    })


@router.get("/settings")
async def get_settings() -> dict[str, Any]:
    return _ok("Settings retrieved", data={
        "available_providers": llm_providers.get_available_providers(),
        "current_provider": llm_providers.LLM_PROVIDER,
        "current_model": llm_providers.LLM_MODEL,
        "brave_api_enabled": settings.use_brave_api,
    })


@router.put("/settings")
async def update_settings(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    updated = {}
    if "provider" in payload and "model" in payload:
        os.environ["LLM_PROVIDER"] = payload["provider"]
        os.environ["LLM_MODEL"] = payload["model"]
        llm_providers.LLM_PROVIDER = payload["provider"]
        llm_providers.LLM_MODEL = payload["model"]
        updated["provider"] = payload["provider"]
        updated["model"] = payload["model"]
        logger.info(f"LLM provider changed to {payload['provider']}/{payload['model']}")
    if "brave_api" in payload:
        settings.use_brave_api = payload["brave_api"]
        updated["brave_api"] = payload["brave_api"]
        logger.info(f"Brave API {'enabled' if payload['brave_api'] else 'disabled'}")
    if not updated:
        return _err("No valid settings provided")
    return _ok("Settings updated", data=updated)


@router.get("/matches/{identifier}")
async def get_match_details(identifier: str) -> dict[str, Any]:
    db = match_db.get_db()
    if not db:
        return _err("Match database not loaded")
    entry = db.get(identifier)
    if not entry:
        return _err(f"No entry found for identifier: {identifier}")
    return _ok("Match details retrieved", data={
        "identifier": identifier,
        "entity_profile": entry.get("entity_profile"),
        "aliases": entry.get("aliases", {}),
        "web_sources": entry.get("web_sources", []),
        "last_updated": entry.get("last_updated"),
    })


@router.get("/history")
async def get_processed_entries() -> dict[str, Any]:
    db = match_db.get_db()
    return _ok(f"Retrieved {len(db)} processed entries", data={"entries": db})


@router.get("/cache")
async def get_cache_status() -> dict[str, Any]:
    db = match_db.get_db()
    return _ok("Cache status retrieved", data={
        "match_database": {
            "identifiers": len(db),
            "aliases": sum(len(entry["aliases"]) for entry in db.values()),
        },
        "cache_metadata": match_db.get_cache_metadata().get_summary(),
    })


@router.post("/cache/rebuild")
async def rebuild_cache() -> dict[str, Any]:
    identifiers_count = match_db.rebuild()
    return _ok(f"Cache rebuilt with {identifiers_count} identifiers", data={"identifiers": identifiers_count})
