"""Startup banner — introduces the service to anyone watching the boot.

Rendered once from ``main.py::startup_event`` after FastAPI wires up and the
match database has loaded. Tall narrow column; stacks values when needed.
"""

from __future__ import annotations

import sys

from config.pipeline_config import get_pipeline_config, get_pipeline_steps
from config.settings import settings
from core.llm_providers import get_available_providers
from services.match_database import get_cache_metadata, get_db

_WIDTH = 38
_LABEL_COL = 7      # "Mode   " / "Cache  " / "Logs   "
_INDENT = " "       # 1-space left margin; content cols ≈ _WIDTH - 1

_TAGLINE = (
    "Terminology normalization for",
    "the Excel add-in. Matches free",
    "terms against a cached base",
    "via a 6-step hybrid pipeline.",
)

_ENDPOINTS = (
    ("GET",  "/status",         "health + config snapshot"),
    ("GET",  "/pipeline",       "pipeline config + nodes"),
    ("POST", "/matches",        "term → entity match"),
    ("GET",  "/experiments",    "trace history + replay"),
    ("POST", "/pipeline/trace", "lifecycle hooks"),
)

_KNOWN_PROVIDERS = ("groq", "openai", "anthropic")
_PROVIDER_SHORT = {"anthropic": "anth"}  # keep keys row under width


def _rule(title: str = "") -> str:
    if not title:
        return "─" * _WIDTH
    head = f"─── {title} "
    return head + "─" * max(3, _WIDTH - len(head))


def _kv(label: str, value: str) -> list[str]:
    """Single-line KV; wraps to stacked continuation lines if value overflows."""
    head = f"{_INDENT}{label:<{_LABEL_COL}}"
    budget = _WIDTH - len(head)
    lines: list[str] = []
    words = value.split(" ")
    current = ""
    for w in words:
        piece = w if not current else " " + w
        if current and len(current) + len(piece) > budget:
            lines.append(head + current if not lines else (" " * len(head)) + current)
            current = w
        else:
            current += piece
    if current:
        lines.append(head + current if not lines else (" " * len(head)) + current)
    return lines


def _section(label: str, body_lines: list[str]) -> list[str]:
    """Header label, then indented body lines."""
    out = [f"{_INDENT}{label}"]
    out.extend(f"{_INDENT}  {line}" for line in body_lines)
    return out


def _humanize_age(seconds: float | None) -> str:
    if seconds is None:
        return "never"
    s = int(seconds)
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60}m ago"
    if s < 96 * 3600:
        return f"{s // 3600}h ago"
    return f"{s // 86400}d ago"


def _provider_flags() -> str:
    active = set(get_available_providers())
    return " ".join(
        f"{_PROVIDER_SHORT.get(p, p)} {'✓' if p in active else '✗'}"
        for p in _KNOWN_PROVIDERS
    )


def _pipeline_body() -> list[str]:
    """Arrow chain wrapped to ~32 cols, each continuation starts with `→`."""
    arrow = " → "
    limit = _WIDTH - 4  # indent + section indent
    lines: list[str] = []
    current = ""
    for i, step in enumerate(get_pipeline_steps("default")):
        piece = step if i == 0 else arrow + step
        if current and len(current) + len(piece) > limit:
            lines.append(current)
            current = "→ " + step
        else:
            current += piece
    if current:
        lines.append(current)
    return lines


def _cache_body() -> list[str]:
    meta = get_cache_metadata()
    summary = meta.get_summary()
    identifiers = len(get_db()) or summary["total_identifiers"]
    aliases = summary["total_aliases"]
    age = _humanize_age(meta.get_cache_age_seconds())
    stale = summary["is_stale"] and age != "never"
    return [
        f"{identifiers} identifiers · {aliases} aliases",
        f"{age}{' · stale' if stale else ''}",
    ]


def _mode_body() -> list[str]:
    mode = settings.environment_type
    host = "0.0.0.0" if mode == "network" else settings.host
    reload_on = settings.reload or "--reload" in " ".join(sys.argv)
    return [
        f"{mode} · reload {'on' if reload_on else 'off'}",
        f"http://{host}:{settings.port}",
    ]


def _endpoint_rows() -> list[str]:
    rows: list[str] = []
    for verb, path, desc in _ENDPOINTS:
        rows.append(f"{verb:<5}{path}")
        rows.append(f"     {desc}")
    return rows


def print_startup_banner() -> None:
    # Windows consoles default to cp1252 — force UTF-8 so box-drawing renders.
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass

    version = get_pipeline_config().get("version", "")
    title = f"TermNorm Backend {version}".rstrip()

    out: list[str] = []
    out.append("")
    out.append(_rule(title))
    out.append("")
    out.extend(f"{_INDENT}{line}" for line in _TAGLINE)
    out.append("")
    out.extend(_section("Mode", _mode_body()))
    out.extend(_kv("Keys", _provider_flags()))
    out.extend(_section("Pipeline", _pipeline_body()))
    out.extend(_section("Cache", _cache_body()))
    out.extend(_kv("Auth", "IP · config/users.json"))
    out.extend(_kv("Logs", "logs/app.log"))
    out.append("")
    out.extend(_section("Endpoints", _endpoint_rows()))
    out.append("")
    out.append(f"{_INDENT}try: curl :{settings.port}/status")
    out.append("")
    out.append(_rule())

    print("\n".join(out))
    sys.stdout.flush()
