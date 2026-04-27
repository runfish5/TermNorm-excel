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

# Stage tags — all 4 chars so columns align.
TAG_REQ = "[REQ ]"   # request entry — one per /matches call
TAG_STEP = "[STEP]"  # non-terminal step result
TAG_LLM = "[LLM ]"   # LLM call dispatch (per node)
TAG_LLM_ERR = "[LLM!]"  # LLM call failure (rate limit, timeout, 4xx, 5xx)
TAG_RESP = "[RESP]"  # final response summary block

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
