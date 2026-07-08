# ./backend-api/utils/utils.py
"""Shared ANSI color codes for console output.

Deliberately minimal: console color is level-only (WARNING/ERROR tags, applied
by ``core.logging.ConsoleFormatter``) plus the ``[RESP]`` outcome word painted
via ``core.log_format.paint``. That's the whole palette. Add a constant here
only when a new level/outcome genuinely needs it — not for decorative per-stage
color, which was deliberately removed.
"""

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