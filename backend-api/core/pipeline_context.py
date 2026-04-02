"""Structured pipeline execution context.

Accumulates per-step diagnostics (status, timing, warnings) as a request
flows through the research pipeline.  Replaces the ad-hoc dict surgery that
previously assembled step_timings and swallowed step-level error details.

Usage in the /matches handler::

    ctx = PipelineContext(query, user_id, requested_steps, params)
    ...
    ctx.record_step("web_search", StepStatus.FAILED, elapsed=ws_time,
                     warnings=[StepWarning("web_search", "scrape_failed", msg)])
    ...
    diagnostics = ctx.build_diagnostics()   # → response["data"]["diagnostics"]
    timings     = ctx.step_timings          # → backward-compat step_timings dict
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class StepStatus(str, Enum):
    SUCCESS = "success"
    DEGRADED = "degraded"      # ran but with reduced quality (e.g. no web content)
    FAILED = "failed"          # caught exception, used fallback
    SKIPPED = "skipped"        # step not in requested pipeline
    PRECOMPUTED = "precomputed"  # output supplied by caller (partial caching)


@dataclass(frozen=True)
class StepWarning:
    step: str       # pipeline step name (e.g. "web_search")
    code: str       # machine-readable code (e.g. "scrape_failed")
    message: str    # human-readable detail
    details: tuple = ()  # optional structured data (e.g. failed URLs + reasons)
    stats: tuple = ()    # frozen key-value pairs for structured numerics (e.g. min/usable/fetched/requested)


@dataclass
class _StepRecord:
    status: StepStatus
    elapsed: float | None  # seconds; None when skipped/failed-before-timing
    warnings: list[StepWarning] = field(default_factory=list)


class PipelineContext:
    """Accumulates step execution results throughout a /matches request."""

    def __init__(
        self,
        query: str,
        user_id: str,
        requested_steps: list[str],
        params: dict,
    ):
        self.query = query
        self.user_id = user_id
        self.requested_steps = requested_steps
        self.params = params
        self._start = time.time()
        self._steps: dict[str, _StepRecord] = {}

    # -- recording ----------------------------------------------------------

    def record_step(
        self,
        name: str,
        status: StepStatus,
        elapsed: float | None = None,
        warnings: list[StepWarning] | None = None,
    ) -> None:
        # Preserve warnings from prior add_warning() calls
        merged = list(self._steps[name].warnings) if name in self._steps else []
        merged.extend(warnings or [])
        self._steps[name] = _StepRecord(
            status=status,
            elapsed=elapsed,
            warnings=merged,
        )

    def add_warning(self, step: str, code: str, message: str,
                    details: list | None = None,
                    stats: dict | None = None) -> None:
        """Append a warning to an already-recorded step, or create a stub."""
        w = StepWarning(step, code, message,
                        details=tuple(details) if details else (),
                        stats=tuple(stats.items()) if stats else ())
        if step in self._steps:
            self._steps[step].warnings.append(w)
        else:
            # Step not yet recorded — store warning for later merge
            self._steps[step] = _StepRecord(
                status=StepStatus.DEGRADED, elapsed=None, warnings=[w],
            )

    # -- queries ------------------------------------------------------------

    @property
    def total_time(self) -> float:
        return round(time.time() - self._start, 2)

    @property
    def step_timings(self) -> dict[str, float | None]:
        """Backward-compatible {step_name: elapsed_or_None} dict."""
        return {name: rec.elapsed for name, rec in self._steps.items()}

    @property
    def warnings(self) -> list[StepWarning]:
        out: list[StepWarning] = []
        for rec in self._steps.values():
            out.extend(rec.warnings)
        return out

    @property
    def executed_steps(self) -> list[str]:
        return [n for n, r in self._steps.items() if r.status != StepStatus.SKIPPED]

    @property
    def terminated_at(self) -> str | None:
        executed = self.executed_steps
        return executed[-1] if executed else None

    # -- response builders --------------------------------------------------

    def build_diagnostics(self) -> dict:
        """Structured diagnostics payload for the API response."""
        warnings_list = []
        for w in self.warnings:
            d = {"step": w.step, "code": w.code, "message": w.message}
            if w.details:
                d["details"] = list(w.details)
            if w.stats:
                d["stats"] = dict(w.stats)
            warnings_list.append(d)
        return {
            "step_statuses": {
                name: rec.status.value for name, rec in self._steps.items()
            },
            "warnings": warnings_list,
        }
