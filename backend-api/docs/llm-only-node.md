# `llm_only` node

Companion to PromptPotter's `docs/specs/m9-llm-only-unification.md`.
This doc describes the `llm_only` node as it lives in this backend.

## Purpose

A generation-only pipeline step: system prompt + user query in, text out.
Used by PromptPotter to run BBEH, GSM8K, and AIME benchmarks through the
same `/matches` endpoint, pipeline runner, and observability stack that
serves the full research-and-rank pipeline (`lca-termnorm`). One code
path, four datasets.

Not a replacement for `direct_prompt` (the TermNorm-Excel Add-In shortcut)
and not a generic chat endpoint. The node is a peer of `entity_profiling`
and `llm_ranking` — same node contract, same Langfuse span type, same
optimizer param shape.

## Contract

**Input:** raw query string (as the user turn) + `cfg["prompt"]`
(injected as system).

**Output:** `StepResult` whose `output` is
`{"final_ranking": [{"candidate": <text>, "score": 1.0}]}`. Single
synthetic candidate. Pipeline terminates after this step
(`terminates=True`) — the step is a ranker that short-circuits the rest
of the pipeline.

**Config keys** (all optimizer-tunable):

| Key | Default | Notes |
|---|---|---|
| `prompt` | `""` | System prompt — the main optimization target |
| `model` | `openai/gpt-oss-120b` | Any provider-backed model |
| `temperature` | `0.0` | |
| `max_tokens` | `null` | No default — provider's own output ceiling applies. Set explicitly only when you want to cap output; leaving it null stops TPM reservations from blowing the per-minute bucket on reasoning-heavy models. |
| `reasoning_effort` | `"medium"` | `low` / `medium` / `high` — only honored by OpenAI/Groq reasoning models |
| `response_format` | `"text"` | Or `"json"` for structured output |

Defined in `config/pipeline.json` under `nodes.llm_only`. Registered in
`pipelines.llm_only: ["llm_only"]` so PromptPotter can select it by name
via `GET /pipeline`.

## Reasoning-model handling

Groq `gpt-oss-120b`-family models can consume their available output
budget on hidden reasoning and return an empty `message.content`. This
node and the shared `llm_call` primitive surface the raw signal —
**they do not classify or substitute**. Classification (whether this is
fatal, and which fatal code applies) is PromptPotter's policy, derived
from the advisory + raw response shape we expose here.

1. **Empty-content advisory in `core/llm_providers.py`.** When the
   OpenAI/Groq path returns empty `content`, the client returns the
   empty string unchanged (no substitution from `message.reasoning` —
   the reasoning trace is internal monologue, not an answer). The
   event logs a warning and — if a `warnings` list was passed in —
   appends a single advisory of the form
   `"content_empty: finish_reason={fr} reasoning_chars={N}"`.
   Anthropic's path is unchanged (different failure mode).
2. **Raw response shape via `usage_out`.** Every `llm_call` populates
   the caller's `usage_out` dict with `input` / `output` token counts,
   plus (Groq/OpenAI only) `reasoning` token count when the provider
   exposes `usage.completion_tokens_details.reasoning_tokens`,
   normalized `finish_reason` (`length` / `stop` / `content_filter` /
   `tool_use` regardless of provider), and `max_tokens_requested`.
   These flow through `step_tokens.llm_only` on the wire so
   PromptPotter's `classify_result()` can derive fatal codes
   (`reasoning_budget_exhausted`, `output_truncated`, `empty_response`,
   `content_filtered`) without string-matching backend warnings.
3. **`reasoning_effort` plumbing.** The `llm_call` signature accepts a
   `Literal["low","medium","high"] | None` argument and forwards it as
   `params["reasoning_effort"]` on OpenAI/Groq. `_step_llm_only` reads
   it from `cfg` and passes it through.
4. **Empty-output guard in `_step_llm_only`.** If the final answer is
   empty, the step also attaches a
   `StepWarning("llm_only", "empty_output", ...)` and sets its
   `diagnostics.step_statuses.llm_only = "empty_output"`. This is
   independent of the `content_empty` advisory above — it is the
   step-level view, useful when classifiers want a coarser signal.
   The empty candidate is still returned — swallowing it would hide
   the failure mode.

## Langfuse

Inherits `langfuse_type: "generation"` from `pipeline.json`. Each call
produces a `generation`-type span alongside whatever the caller's root
trace is, with `model`, `input.query`, `output.final_ranking`, and
latency populated by the standard observation writer in
`utils/langfuse_logger.py`.

## Wire-format example

```bash
curl -s -X POST http://127.0.0.1:8000/matches \
  -H 'Content-Type: application/json' \
  -d '{"query":"What is 2+2? Answer with a single integer.",
       "steps":["llm_only"],
       "node_config":{"llm_only":{"reasoning_effort":"low"}}}'
```

Response contains `final_ranking[0].candidate` as a non-empty string.

## Non-goals

- Not a replacement for `direct_prompt`.
- Not a retrieval step. The pipeline runner already tolerates a
  `steps: ["llm_only"]` list with no upstream retrievers; no runner
  changes were needed for this node to ship.
- No speculative empty-content fallback on the Anthropic provider —
  only the Groq/OpenAI path exhibited the failure mode.
