"""Per-step terminal logging primitives for the research pipeline.

Two modes:

* **Short form** — one-line ``[STEP] ...`` log emitted by the dispatch loop
  after every non-terminal, non-skipped step. The middle columns are chosen
  per node type (llm / match-ranker / web-search / fuzzy / enricher / cache)
  so the information density is meaningful rather than forced into a
  universal shape.

* **Long form** — the multi-line ``[RESP] ...`` block, emitted exactly once
  per request by the runner via :func:`log_run_summary`.

Nodes themselves never touch logging — they return ``StepResult`` and the
runner decides what to print.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from core.log_format import TAG_RESP, TAG_STEP
from core.pipeline_context import PipelineContext, StepResult
from utils.utils import GREEN, RESET

logger = logging.getLogger(__name__)


# step name → node type (single source of truth for dispatch-loop lookup)
STEP_NODE_TYPE: dict[str, str] = {
    "cache_lookup":     "cache",
    "fuzzy_matching":   "fuzzy",
    "web_search":       "web-search",
    "entity_profiling": "enricher",
    "token_matching":   "fuzzy",
    "llm_ranking":      "match-ranker",
    "llm_only":         "llm",
}


def _preview(text: str, n: int = 40) -> str:
    text = (text or "").replace("\n", " ").strip()
    return text[:n] + ("…" if len(text) > n else "")


# ---------------------------------------------------------------------------
# Per-node-type short-form formatters
# ---------------------------------------------------------------------------

def _fmt_llm(name: str, elapsed: float, output: Any, warn: int) -> str:
    final = output.get("final_ranking", []) if isinstance(output, dict) else []
    top = final[0].get("candidate", "") if final else ""
    return f'{name} · {elapsed:.2f}s · {len(top)} chars · top="{_preview(top)}" · warn={warn}'


def _fmt_match_ranker(name: str, elapsed: float, output: Any, warn: int) -> str:
    ranked = output.get("ranked_candidates", []) if isinstance(output, dict) else []
    if ranked:
        top = ranked[0]
        top_name = top.get("candidate", "")
        score = top.get("relevance_score", 0) or 0
        return f'{name} · {elapsed:.2f}s · {len(ranked)} ranked · top="{_preview(top_name)}" ({score:.3f}) · warn={warn}'
    return f'{name} · {elapsed:.2f}s · 0 ranked · warn={warn}'


def _fmt_web_search(name: str, elapsed: float, output: Any, warn: int) -> str:
    n = len(output) if isinstance(output, list) else 0
    return f'{name} · {elapsed:.2f}s · {n} sites · warn={warn}'


def _fmt_fuzzy(name: str, elapsed: float, output: Any, warn: int) -> str:
    items = output if isinstance(output, list) else []
    if items:
        top_name, top_score = items[0]
        return f'{name} · {elapsed:.2f}s · {len(items)} cand · top="{_preview(top_name)}" ({top_score:.3f}) · warn={warn}'
    return f'{name} · {elapsed:.2f}s · 0 cand · warn={warn}'


def _fmt_enricher(name: str, elapsed: float, output: Any, warn: int) -> str:
    if isinstance(output, dict):
        entity = output.get("entity_name", "?")
        fields = len([k for k in output if not k.startswith("_")])
        return f'{name} · {elapsed:.2f}s · entity="{_preview(entity)}" · {fields} fields · warn={warn}'
    if isinstance(output, list):
        return f'{name} · {elapsed:.2f}s · {len(output)} items · warn={warn}'
    return f'{name} · {elapsed:.2f}s · warn={warn}'


def _fmt_cache(name: str, elapsed: float, output: Any, warn: int) -> str:
    hit = output is not None and output is not False
    return f'{name} · {elapsed:.2f}s · hit={hit} · warn={warn}'


_FORMATTERS: dict[str, Callable[[str, float, Any, int], str]] = {
    "llm":          _fmt_llm,
    "match-ranker": _fmt_match_ranker,
    "web-search":   _fmt_web_search,
    "fuzzy":        _fmt_fuzzy,
    "enricher":     _fmt_enricher,
    "cache":        _fmt_cache,
}


# ---------------------------------------------------------------------------
# Public primitives
# ---------------------------------------------------------------------------

def log_step_short(
    ctx: PipelineContext,
    step_name: str,
    node_type: str,
    result: StepResult,
) -> None:
    """Emit one ``[STEP]`` line summarizing a non-terminal step's output."""
    fmt = _FORMATTERS[node_type]
    rec = ctx._steps.get(step_name)
    warn_count = len(rec.warnings) if rec else 0
    body = fmt(step_name, result.elapsed, result.output, warn_count)
    logger.info(f"{GREEN}{TAG_STEP}{RESET} {body}")


def log_run_summary(ctx: PipelineContext, api_response: dict) -> None:
    """Emit the long-form ``[RESP]`` summary once per request."""
    logger.info(_summarize_response(api_response))


# ---------------------------------------------------------------------------
# Long-form summary (moved from research_pipeline.py — unchanged)
# ---------------------------------------------------------------------------

_LABEL_WIDTH = 9


def _row(label: str, body: str) -> str:
    return f"  {GREEN}{label:<{_LABEL_WIDTH}}{RESET} {body}"


def _approx_tokens(chars: int) -> int:
    return max(1, round(chars / 4)) if chars else 0


def _fmt_params(cfg: dict) -> str:
    """Compact LLM sampling-param summary for the RESP `llm` sub-row.

    Only emits values that deviate from the eval-run defaults — `t=0.0`,
    `fmt=text`, and an absent `max_tokens` are uninformative. Excludes
    `model` and `reasoning_effort` (already on `[LLM ]`). Returns "" when
    there's nothing new to say; the caller skips the row in that case.
    """
    parts: list[str] = []
    temp = cfg.get("temperature")
    if temp is not None and temp != 0.0:
        parts.append(f"temp={temp}")
    if cfg.get("max_tokens") is not None:
        parts.append(f"max={cfg['max_tokens']}")
    fmt = cfg.get("response_format")
    if fmt and fmt != "text":
        parts.append(f"fmt={fmt}")
    return " · ".join(parts)


def _summarize_response(resp: dict) -> str:
    """Compact, grouped structural summary of an API response for logging.

    Layout (one row per group, labels left-aligned). Sub-rows are emitted
    only when they carry information not already on [REQ ] / [LLM ]:

        [RESP] <status> · <total:.2f>s [→ <terminated_at> if early-termination]
          output     {final_ranking: {...}, entity_profile: {...}, candidate_ranking: {...}}
          llm        t=.. · max=.. · fmt=..       (model+reasoning live on [LLM ])
          steps      <per-step timings>            (multi-step pipelines only)
          status     <exec>/<req> steps · <N> warn[ (step: code)] · <non-success>
                                                   (only on warn / non-success)
    """
    data = resp.get("data", {})
    status = resp.get("status", "?")
    total = data.get("total_time")
    terminated = data.get("terminated_at")
    pp = data.get("pipeline_params", {}) or {}
    final_step = (pp.get("steps") or [None])[-1]
    header = f"{GREEN}{TAG_RESP} {status}"
    if total is not None:
        header += f" · {total:.2f}s"
    # Only show terminated_at on early termination — when the pipeline ran
    # all the way through, the operator already knows the last step from REQ.
    if terminated and terminated != final_step:
        header += f" → {terminated}"
    header += RESET
    lines = [header]

    # ---- output (nested-dict-style one-liner showing result shape) --------
    parts: list[str] = []

    ranked = data.get("final_ranking", [])
    if ranked:
        top = ranked[0]
        name = str(top.get("candidate", ""))
        preview = name.replace("\n", " ")[:50]
        suffix = "…" if len(name) > 50 else ""
        chars = len(name)
        tokens = _approx_tokens(chars)
        score = top.get("relevance_score")
        fr_inner = [
            f'{len(ranked)} items',
            f'top="{preview}{suffix}"',
            f'chars={chars}',
            f'tokens~{tokens}',
        ]
        if isinstance(score, (int, float)):
            fr_inner.append(f'score={score:.3f}')
        parts.append(f"final_ranking: {{{', '.join(fr_inner)}}}")

    ep = data.get("entity_profile")
    if isinstance(ep, dict):
        fields = [k for k in ep if not k.startswith("_")]
        entity = str(ep.get("entity_name", "?"))[:40]
        src = ep.get("_metadata", {}).get("sources_count", "?")
        ep_inner = [f'fields={fields}', f'entity="{entity}"', f'sources={src}']
        parts.append(f"entity_profile: {{{', '.join(ep_inner)}}}")

    tokens_cr = data.get("candidate_ranking", [])
    if tokens_cr:
        cr_scores = [c[1] for c in tokens_cr if isinstance(c, (list, tuple)) and len(c) > 1]
        cr_inner = [f'{len(tokens_cr)} items']
        if cr_scores:
            cr_inner.append(f'range={max(cr_scores):.3f}–{min(cr_scores):.3f}')
        parts.append(f"candidate_ranking: {{{', '.join(cr_inner)}}}")

    if parts:
        lines.append(_row("output", "{" + ", ".join(parts) + "}"))

    # ---- llm sampling params (model+reasoning+provider live on [LLM ]) ----
    # Prefer llm_only cfg; else entity_profiling / llm_ranking.
    llm_cfg: dict = {}
    for node in ("llm_only", "llm_ranking", "entity_profiling"):
        node_cfg = pp.get(node)
        if isinstance(node_cfg, dict) and node_cfg.get("model"):
            llm_cfg = node_cfg
            break
    if llm_cfg:
        body = _fmt_params(llm_cfg)
        if body:
            lines.append(_row("llm", body))

    # ---- timings (one step = skip that line) ------------------------------
    step_timings = data.get("step_timings", {})
    if step_timings and len(step_timings) > 1:
        timing_parts = []
        for step, t in step_timings.items():
            short = step.split("_")[0][:8]
            timing_parts.append(f"{short}={'skip' if t is None else f'{t:.2f}s'}")
        lines.append(_row("steps", " ".join(timing_parts)))

    # ---- status (only when something is interesting) ----------------------
    # Skip on clean runs: 1:1 step exec, no warnings, no non-success statuses.
    diag = data.get("diagnostics") or {}
    warnings = diag.get("warnings", []) if isinstance(diag, dict) else []
    statuses = diag.get("step_statuses", {}) if isinstance(diag, dict) else {}
    exec_steps = pp.get("steps") or list(statuses.keys())
    req_steps = pp.get("requested_steps") or exec_steps
    n_exec, n_req = len(exec_steps), len(req_steps)
    non_success = [f"{s}={st}" for s, st in statuses.items() if st != "success"]
    if warnings or non_success or n_exec != n_req:
        w_str = f"{len(warnings)} warn"
        if warnings:
            first = warnings[0]
            w_str += f" ({first['step']}: {first['code']})"
        status_tail = f" · {', '.join(non_success)}" if non_success else ""
        lines.append(_row("status", f"{n_exec}/{n_req} steps · {w_str}{status_tail}"))

    return "\n".join(lines)
