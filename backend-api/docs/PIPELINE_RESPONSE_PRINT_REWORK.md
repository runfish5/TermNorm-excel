# Pipeline response-print rework — problem statement

## Context

Every request to `/matches` in this backend ends with a log dump of the
final response. Today the dump is hand-rolled inside
`api/research_pipeline.py` (the response-building path, around
`_build_response` / the `[RESPONSE] success — ...` log line) and it has
two problems:

1. **Every node that terminates the pipeline prints the same
   long-form block regardless of whether it's mid-pipeline or terminal.**
   The block looks like this:

   ```
   2026-04-14 11:41:08,157 - api.research_pipeline - INFO - [RESPONSE] success — LLM-only completed in 2.605s
     final_ranking      [1 items]  top: We need to determine if "the wolf calls the chihua... (0.000)
     timings            2.605s total | llm=2.6s
     pipeline           1/0 steps → llm_only
     diagnostics        1 warnings (llm_only: empty_content_reasoning_fallback) | all success
   ```

   That block is fine as a **summary of the whole run at the very end**,
   but it's wasteful when the node is one of several (e.g.
   `entity_profiling` inside the default pipeline) — we end up with one
   long block per step, all nearly-identical.

2. **The formatting is duplicated / ad-hoc per node.** `_step_llm_only`,
   `_step_ranking`, `_step_entity_profiling`, etc. each have their own
   logging of what they produced. There is no shared "how a node reports
   its output to the terminal" primitive, so every node grows its own
   snowflake.

What's good and should stay:
- The timing/diagnostics information density is right.
- Colored `[PIPELINE] <step>` banner lines are fine.
- The empty-content / reasoning-fallback warning line is useful.

## Goal

**One shared response-print primitive** for all nodes, with two modes:

- **Short form** — emitted after every node *except* the terminal one.
  Single line. Something like:
  `[STEP] llm_only · 2.6s · 1 cand · top="We need to determine…" · warn=1`
- **Long form** — emitted exactly once, at the end of the request, by
  the pipeline runner (not by individual nodes). Today's multi-line
  block is roughly the right shape; just moved to the runner and
  rendered from aggregated state, not per-node.

Rules:
1. A node never prints the long form. A node only emits its short-form
   line (via the shared primitive).
2. The pipeline runner decides which node is terminal and, after that
   node returns, renders the long-form summary from aggregated
   `PipelineContext` state (step timings, warnings, final_ranking,
   diagnostics).
3. The short form must be **standardized across node types** — one
   format string, parameterized by (step name, elapsed, candidate count,
   top candidate preview, warning count). No per-node flavor.
4. Preserve existing warning/error logging behavior — the short form
   does not *replace* warning logs, it complements them.
5. The `[PIPELINE] <step>` banner before a node starts is orthogonal to
   this work; leave it alone.

## What NOT to change

- The response JSON body (`final_ranking`, `node_outputs`,
  `step_timings`, `diagnostics`, etc.) — only the terminal logging.
- Langfuse tracing / observation wiring — unrelated.
- The `[LLM]` warnings from `core/llm_providers.py` (e.g. the
  `Empty content, falling back to reasoning field` line) — still wanted.
- Nodes that short-circuit (like `llm_only` with `terminates=True`) —
  they're terminal *and* they're the only node, so they get the
  long-form summary exactly once, via the runner.

## Critical files to read first

- `api/research_pipeline.py` — step functions (`_step_*`), the dispatch
  loop (~line 725), the response builder that currently writes the
  `[RESPONSE] success — ...` block. Find every place a step currently
  logs its own output summary.
- `core/pipeline_context.py` — `PipelineContext`, `StepResult`,
  `StepWarning`, `StepStatus`. The aggregate state needed for the
  long-form summary already lives here.
- `utils/langfuse_logger.py` — only to confirm the new print path
  doesn't collide with observation writing.

## Acceptance

- Single shared helper (e.g. `log_step_short(ctx, step_name, result)`
  and `log_run_summary(ctx)`) in `api/research_pipeline.py` or a new
  tiny module. Every step uses the same call; the runner calls the
  summary once after the terminal step.
- Running a default pipeline (`cache_lookup → fuzzy → web_search →
  entity_profiling → token_matching → llm_ranking`) produces one short
  line per intermediate step, one long-form summary at the end.
- Running `steps: ["llm_only"]` produces one long-form summary and no
  redundant short line (the terminal node *is* the only node).
- Running `steps: ["entity_profiling", "llm_ranking"]` produces one
  short line for `entity_profiling` and one long-form summary covering
  both steps.
- Existing `[LLM]` warnings still appear.
- No formatting divergence between step types — all short lines have
  the same columns in the same order.

## Delegation notes

This is a pure refactor of terminal-print behavior in the backend repo
at `C:/Users/dsacc/OfficeAddinApps/TermNorm-excel/backend-api/`. It does
not touch PromptPotter. Plan it, then execute; the acceptance bullets
above are the definition of done. Keep the diff small — shared helper
plus per-step call-site edits plus one runner call. Don't restructure
anything else you see in passing.
