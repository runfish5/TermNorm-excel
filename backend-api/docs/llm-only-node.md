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
| `max_tokens` | `16000` | Big default — reasoning models need headroom |
| `reasoning_effort` | `"medium"` | `low` / `medium` / `high` — only honored by OpenAI/Groq reasoning models |
| `response_format` | `"text"` | Or `"json"` for structured output |

Defined in `config/pipeline.json` under `nodes.llm_only`. Registered in
`pipelines.llm_only: ["llm_only"]` so PromptPotter can select it by name
via `GET /pipeline`.

## Reasoning-model handling

Groq `gpt-oss-120b`-family models can consume the entire `max_tokens`
budget on hidden reasoning and return an empty `message.content`. This
node and the shared `llm_call` primitive handle that explicitly — never
silently:

1. **Empty-content fallback in `core/llm_providers.py`.** When the
   OpenAI/Groq path returns empty `content`, the client reads
   `message.reasoning` and uses it as the answer if present. The event
   logs a warning and — if a `warnings` list was passed in — appends
   `"empty_content_reasoning_fallback"`. Anthropic's path is unchanged
   (different failure mode).
2. **`reasoning_effort` plumbing.** The `llm_call` signature accepts a
   `Literal["low","medium","high"] | None` argument and forwards it as
   `params["reasoning_effort"]` on OpenAI/Groq. `_step_llm_only` reads
   it from `cfg` and passes it through.
3. **Empty-output guard in `_step_llm_only`.** If the final answer is
   still empty after the fallback, the step attaches a
   `StepWarning("llm_only", "empty_output", ...)` and sets its
   `diagnostics.step_statuses.llm_only = "empty_output"` so
   PromptPotter's `EmptyOutputCheck` escalation path can fire and feed
   the failure to L2 as a self-healing signal. The empty candidate is
   still returned — swallowing it would hide the failure mode.

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
       "node_config":{"llm_only":{"max_tokens":16000,"reasoning_effort":"low"}}}'
```

Response contains `final_ranking[0].candidate` as a non-empty string.

## Non-goals

- Not a replacement for `direct_prompt`.
- Not a retrieval step. The pipeline runner already tolerates a
  `steps: ["llm_only"]` list with no upstream retrievers; no runner
  changes were needed for this node to ship.
- No speculative empty-content fallback on the Anthropic provider —
  only the Groq/OpenAI path exhibited the failure mode.
