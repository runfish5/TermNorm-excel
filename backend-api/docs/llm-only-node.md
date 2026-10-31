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
text; with one it is the `answer_fields` slots, destructured (reading a declared
field is not judging it): one slot's value, or with several the JSON object of them. An **empty, declined, or schema-violating answer
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
| `max_tokens` | `8192` | Output cap, reasoning included. Required and sent on every request; no retry removes or raises it — a truncated reply comes back as `finish_reason: length`. A `null` override is refused (400 `invalid_spend_cap`) |
| `input_bytes` | `31000` | **Spend cap, not an axis.** UTF-8 bytes of one request's prompt text (system + user message, plus the response schema when sent natively). Over it, the request is refused before it is sent (413 `input_too_large`). Kept under 32k tokens, the length past which some hosts bill a whole request at a dearer tier — a caller holding the bound pays for that tier otherwise |
| `max_price` | `null` | **Spend cap, not an axis.** `{"prompt": usd, "completion": usd}` per million tokens; on `provider: openrouter` only, sent as `extra_body.provider.max_price` with `require_parameters: true` |
| `reasoning_effort` | `"medium"` | `none` / `default` / `low` / `medium` / `high` — `default` sends nothing, `none` turns reasoning off; only reasoning models honor it |
| `seed` | `null` | Forwarded to the provider. Set it on any dataset whose noise floor you intend to read — an unseeded benchmark cannot tell a real lift from run-to-run variance |
| `response_format` | `"text"` | **Not an axis here.** `output_schema` decides the mode; PromptPotter owns the text↔structured toggle and spends it by choosing whether to send a schema at all. What is left for this key is the mistake it refuses: `"json"` with no schema RAISES, because a structure was promised and none was declared |
| `output_schema` | `null` | JSON Schema, and the node's MODE: present → structured (`output_format: "schema"`, shape rendered into the prompt), absent → prose. **Not optimizer-tunable** — PromptPotter strips it via `SCHEMA_OWNED_FIELDS` |
| `answer_fields` | — | Which schema properties carry the answer, as a list. **Required** when `output_schema` is set, and validated against it. One field answers with its value; several answer with the JSON object of them, in declared order |

Defined in `config/pipeline.json` under `nodes.llm_only`. Registered in
`pipelines.llm_only: ["llm_only"]` so PromptPotter can select it by name
via `GET /pipeline`.

## Structured answers — the node's second prompt

Declaring `output_schema` + `answer_fields` stops the answer being scraped out of
prose. One schema object feeds **both** the prompt block and the decoder, so the
two can never disagree (the rule `call_llm_for_ranking` already follows).

What the schema *teaches* matters as much as what it compels: `format_string_from_schema`
renders field order, `enum` values and `description` strings in **declaration order** into
the prompt, because constrained decoding is provider-dependent (Groq does not honor `enum`).
Put reasoning fields *above* the answer —
fields generate in order, so an answer emitted first is only rationalised afterwards. Never
sort a schema's properties or its enum values; order is the lever.

An enum and its `description` both render (`"A" | "B"  // when to pick which`). They are not
rivals: the enum is the value space, the description is the rule for choosing within it. Drop
the gloss and the description axis would exist for some fields and not others, decided by
nothing but which of them happen to be enums.

```json
"llm_only": {"output_schema": {"type": "object", "properties": {
    "reasoning": {"type": "string", "description": "Work through the premises step by step."},
    "answer":    {"type": "string", "enum": ["TRUE", "FALSE", "Uncertain"]}}},
  "answer_fields": ["answer"]}
```

A response missing any of `answer_fields`, or one that is not an object, is a NO_RESULT —
excluded from accuracy, not scored as a wrong answer.

With several fields the answer is the object of them, e.g. `"answer_fields": ["type_of_document",
"requires_action", "extract_depth"]` answers `{"type_of_document": "invoice", "requires_action": true,
"extract_depth": 2}`; every other slot rides in `reasoning_trace`, ungraded. An empty string inside
the object is a value, so only a single empty slot is a NO_RESULT.

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
   the caller's `usage_out` dict with `attempts` (provider requests sent)
   and `input` / `output` token counts summed over all of them, plus
   (Groq/OpenAI only) the summed `reasoning` token count when the provider
   exposes `usage.completion_tokens_details.reasoning_tokens`, the last
   reply's normalized `finish_reason` (`length` / `stop` / `content_filter` /
   `tool_use` regardless of provider), and `max_tokens_requested`. The dict
   fills as requests go out, so a call that raises still reports what it
   billed. These flow through `step_tokens.llm_only` on the wire — on an
   error response too, as `data.step_tokens` — so
   PromptPotter's `classify_result()` can derive fatal codes
   (`reasoning_budget_exhausted`, `output_truncated`, `empty_response`,
   `content_filtered`) without string-matching backend warnings.
   Alongside them, `served_by` — WHICH upstream host answered, where the
   configured `provider` is a gateway that routes onward (OpenRouter puts
   it on the response root); absent for a provider that is its own host.
   A `:nitro` model picks the fastest host per call and hosts of one model
   disagree systematically, so without it two disagreeing runs cannot be
   asked whether they ran on the same silicon. PromptPotter banks it on
   `TokenUsageRecord.served_by`.
3. **`reasoning_effort` plumbing.** The `llm_call` signature accepts a
   `Literal["none","default","low","medium","high"] | None` argument and forwards every value
   but `"default"` — which sends no effort at all — as `params["reasoning_effort"]` on
   OpenAI-compatible providers; `"none"` switches reasoning off. `_step_llm_only` reads it from
   `cfg` and passes it through.
4. **Empty-output → NO_RESULT in `_step_llm_only`.** If the final answer
   is empty, declined, or (with a schema) missing one of its `answer_fields`, the step attaches a
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
