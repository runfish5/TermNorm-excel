"""In-process request-throughput meter — no external metrics store.

Records ``/matches`` arrival times in a bounded in-memory window and reports
load over the **1m / 5m / 15m** windows — the same triple Unix ``uptime`` and
Dropwizard Metrics' ``Meter`` report, so the numbers read the way anyone who's
watched a server expects. It rides the existing ``/status`` endpoint (machine
shape) and the console ``[LOAD]`` line; there is deliberately no side-car
metrics daemon, exporter, or on-disk series — just process memory, pruned to
the longest window.
"""
from __future__ import annotations

import time
from collections import deque
from threading import Lock

# (minutes, seconds) for each reported window — the load-average convention.
_WINDOWS: tuple[tuple[int, int], ...] = ((1, 60), (5, 300), (15, 900))
_MAX_AGE = 900  # longest window; stamps older than this are dropped

_stamps: deque[float] = deque()
_total = 0
_lock = Lock()


def _prune(now: float) -> None:
    cutoff = now - _MAX_AGE
    while _stamps and _stamps[0] < cutoff:
        _stamps.popleft()


def record() -> None:
    """Mark one request. O(1) amortized; monotonic clock (immune to wall-clock steps)."""
    global _total
    now = time.monotonic()
    with _lock:
        _stamps.append(now)
        _total += 1
        _prune(now)


def snapshot() -> dict[str, float | int]:
    """Dropwizard-Meter-shaped: lifetime ``count`` + per-minute ``rate_{1,5,15}m``."""
    now = time.monotonic()
    with _lock:
        _prune(now)
        stamps = list(_stamps)
        total = _total
    out: dict[str, float | int] = {"count": total}
    for minutes, secs in _WINDOWS:
        cutoff = now - secs
        n = sum(1 for s in stamps if s >= cutoff)
        out[f"rate_{minutes}m"] = round(n / minutes, 2)  # requests per minute
    return out


def format_load() -> str:
    """Human line body: ``12 / 8 / 3 req/min · 1m 5m 15m``."""
    s = snapshot()
    return f"{s['rate_1m']:g} / {s['rate_5m']:g} / {s['rate_15m']:g} req/min · 1m 5m 15m"
