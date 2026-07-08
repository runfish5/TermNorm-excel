"""Shared formatting primitives for the request/pipeline log stream.

One stage taxonomy, one field grammar. Tags are 4-char padded so columns
align under ``'%(asctime)s %(message)s'`` (set in :mod:`core.logging`).

Field grammar:

* Separator: ``" · "`` between fields.
* Field shape: ``key=value`` for named fields; bare strings for identifiers
  (node name, model token, HTTP status phrase).
* Lists: ``[a,b,c]`` via :func:`fmt_list` (no Python ``repr``).
* Continuations: indent under the timestamp+tag column via :func:`continuation`.
"""
from __future__ import annotations

from typing import Any, Iterable

from utils.utils import RESET

# Stage tags — the ONE tag vocabulary for the request/pipeline log stream.
# All 4 inner chars so columns align under '%(asctime)s %(message)s'.
TAG_REQ = "[REQ ]"   # request entry — one per /matches call
TAG_CFG = "[CFG ]"   # caller's node_config overrides (post-merge effective values)
TAG_STEP = "[STEP]"  # non-terminal step result
TAG_LLM = "[LLM ]"   # LLM call dispatch (per node)
TAG_LLM_ERR = "[LLM!]"  # LLM call failure (rate limit, timeout, 4xx, 5xx)
TAG_RESP = "[RESP]"  # final response summary block
TAG_PIPE = "[PIPE]"  # the request runner narrating itself (step progress, batch, direct-prompt)
TAG_WEB = "[WEB ]"   # web search / scrape
TAG_DB = "[DB  ]"    # match-database cache load / rebuild
TAG_AUTH = "[AUTH]"  # request authentication
TAG_LOAD = "[LOAD]"  # throughput heartbeat (1m/5m/15m request rate)

# All tags — the console formatter builds its detection regex from these.
# Console color is level-only (warning=yellow, error=red); stage tags are
# neutral so the eye isn't pulled to every line. The one INFO-level color is
# the [RESP] outcome word, painted below.
TAGS: tuple[str, ...] = (
    TAG_REQ, TAG_CFG, TAG_STEP, TAG_LLM, TAG_LLM_ERR,
    TAG_RESP, TAG_PIPE, TAG_WEB, TAG_DB, TAG_AUTH, TAG_LOAD,
)


def paint(text: str, color: str) -> str:
    """Wrap ``text`` in an ANSI color + reset.

    The **one** sanctioned in-body colorizer, for genuinely content-derived
    color the tag/level formatter can't infer — currently only the ``[RESP]``
    outcome word (ok/warn/fail). Decorative coloring belongs in the formatter.
    """
    return f"{color}{text}{RESET}"

# Width of "HH:MM:SS [TAG ] " — used to indent continuation lines so the
# relationship between header and body is visually obvious. The console
# formatter prepends "%(asctime)s " (8+1 chars) before the message; tags
# are 6 chars (e.g. "[LLM!]") + 1 trailing space. Total: 16 chars.
_CONTINUATION_INDENT = " " * 16


def fmt_fields(*pairs: tuple[str, Any] | str | None) -> str:
    """Join ``key=value`` pairs and bare identifiers with ``" · "``.

    Each argument is one of:

    * ``("key", value)`` — rendered ``key=value`` if value is not None.
    * ``"identifier"`` — rendered as-is (e.g. node name, status phrase).
    * ``None`` — dropped, lets callers conditionally include fields.
    """
    parts: list[str] = []
    for p in pairs:
        if p is None:
            continue
        if isinstance(p, tuple):
            k, v = p
            if v is None:
                continue
            parts.append(f"{k}={v}")
        else:
            parts.append(p)
    return " · ".join(parts)


def fmt_list(items: Iterable[Any] | None) -> str:
    """Render an iterable as ``[a,b,c]`` — no Python ``repr``, no quotes."""
    if items is None:
        return "[]"
    return "[" + ",".join(str(i) for i in items) + "]"


def continuation(body: str, label: str | None = None) -> str:
    """Indent a (possibly multi-line) body under the timestamp+tag column.

    Used for the second line of two-line events — most commonly LLM error
    bodies that carry full upstream detail. Preserves embedded newlines
    by indenting each line consistently.
    """
    prefix = f"{_CONTINUATION_INDENT}{label}: " if label else _CONTINUATION_INDENT
    if "\n" not in body:
        return prefix + body
    lines = body.splitlines()
    if not lines:
        return prefix
    head = prefix + lines[0]
    tail = [_CONTINUATION_INDENT + line for line in lines[1:]]
    return "\n".join([head, *tail])
