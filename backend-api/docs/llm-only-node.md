# `llm_only` node

Companion to PromptPotter's `docs/specs/m9-llm-only-unification.md`.
This doc describes the `llm_only` node as it lives in this backend.

## Purpose

A generation-only pipeline step: system prompt + user query in, an answer out —
free text, or a named slot on a declared schema (see **Structured answers**).
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
`{"final_ranking": [{"candidate": <answer>, "relevance_score": 1.0}]}` — a
single synthetic candidate carrying the answer through. The scoring matcher
decides HIT/MISS; this node never does. Without a schema `<answer>` is the raw
text; with one it is the `answer_field` slot, destructured (reading a declared
field is not judging it). An **empty, declined, or schema-violating answer
yields `{"final_ranking": []}`** — the structural NO_RESULT shared with the
multi-node path, not a confident empty candidate, and never a wrong answer.
Pipeline terminates after this step (`terminates=True`) — the step is a ranker
that short-circuits the rest of the pipeline.

**Config keys** (optimizer-tunable except where noted):

| Key | Default | Notes |
|---|---|---|
| `prompt` | `""` | System prompt — the main optimization target |
| `model` | `openai/gpt-oss-120b` | Any provider-backed model |
| `temperature` | `0.0` | |
| `max_tokens` | `null` | No default — provider's own output ceiling applies. Set explicitly only when you want to cap output; leaving it null stops TPM reservations from blowing the per-minute bucket on reasoning-heavy models. |
| `reasoning_effort` | `"medium"` | `low` / `medium` / `high` — only honored by OpenAI/Groq reasoning models |
| `response_format` | `"text"` | Or `"json"` for free-form JSON. Ignored when `output_schema` is set |
| `output_schema` | `null` | JSON Schema. Sets `output_format: "schema"` and renders the shape into the prompt. **Not optimizer-tunable** — PromptPotter strips it via `SCHEMA_OWNED_FIELDS` |
| `answer_field` | — | Which schema property carries the answer. **Required** when `output_schema` is set, and validated against it |

Defined in `config/pipeline.json` under `nodes.llm_only`. Registered in
`pipelines.llm_only: ["llm_only"]` so PromptPotter can select it by name
via `GET /pipeline`.

## Structured answers — the node's second prompt

Declaring `output_schema` + `answer_field` stops the answer being scraped out of
prose. One schema object feeds **both** the prompt block and the decoder, so the
two can never disagree (the rule `call_llm_for_ranking` already follows).

What the schema *teaches* matters as much as what it compels: `format_string_from_schema`
renders field order and `enum` values in **declaration order** into the prompt, because
constrained decoding is provider-dependent (Groq does not honor `enum`) and on the
`"json"` path no schema is sent at all. Put reasoning fields *above* the answer — fields
generate in order, so an answer emitted first is only rationalised afterwards. Never sort
a schema's properties or its enum values; order is the lever.

```json
"llm_only": {"output_schema": {"type": "object", "properties": {
    "reasoning": {"type": "string", "description": "Work through the premises step by step."},
    "answer":    {"type": "string", "enum": ["TRUE", "FALSE", "Uncertain"]}}},
  "answer_field": "answer"}
```

A response missing `answer_field`, or one that is not an object, is a NO_RESULT —
excluded from accuracy, not scored as a wrong answer.

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
4. **Empty-output → NO_RESULT in `_step_llm_only`.** If the final answer
   is empty, declined, or (with a schema) missing its `answer_field`, the step attaches a
   `StepWarning("llm_only", "empty_output", ...)`, returns
   `status=DEGRADED`, and emits `final_ranking: []` — the structural
   NO_RESULT. It does NOT return an empty candidate at `relevance_score 1.0`:
   that read downstream as a confident MISS and hid the decline. This is the
   step-level companion to the `content_empty` advisory above; the matcher
   scores `[]` as NO_RESULT, so the failure mode surfaces rather than passing
   as a wrong answer.

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
