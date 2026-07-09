# ./backend-api/utils/utils.py
"""Small shared helpers (string flattening, UTC timestamps) + the ANSI palette.

Console color is level-only (WARNING/ERROR tags, applied by
``core.logging.ConsoleFormatter``) plus the ``[RESP]`` outcome word painted via
``core.log_format.paint``. That's the whole palette — add a constant only when a
new level/outcome genuinely needs it, not for decorative per-stage color.
"""

from datetime import datetime, timezone


def utcnow_iso() -> str:
    """UTC now as an ISO-8601 string with a ``Z`` suffix (e.g. ``2026-07-09T12:00:00.000000Z``).

    Sole producer of stored timestamps. ``match_database`` compares them LEXICOGRAPHICALLY, so
    the ``Z`` form is load-bearing — a ``+00:00`` offset would sort before existing ``…Z`` values
    and silently break the staleness guard. Format-identical to the old
    ``datetime.utcnow().isoformat() + "Z"`` it replaces, minus the deprecation.
    """
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def flatten_strings(data, exclude=None):
    """Recursively extract all strings from nested dict/list, excluding specified keys."""
    if exclude is None:
        exclude = {'_metadata'}
    
    if isinstance(data, dict):
        return [s for k, v in data.items() if k not in exclude for s in flatten_strings(v, exclude)]
    elif isinstance(data, list):
        return [s for item in data for s in flatten_strings(item, exclude)]
    else:
        return [str(data)]



GREEN   = '\033[32m'   # ok outcome word
YELLOW  = '\033[33m'   # warn outcome word + WARNING level
BRIGHT_RED = '\033[91m'  # fail outcome word + ERROR level
RESET   = '\033[0m'