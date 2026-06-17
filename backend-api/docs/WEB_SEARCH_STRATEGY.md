# Web Search Strategy

How the `web_search` → `entity_profiling` node turns one web query into the evidence
that grounds a match. This is the canonical explainer; config lives in
`config/pipeline.json` (node `web_search`), code in
`research_and_rank/web_generate_entity_profile.py`.

## The job

To match a query term (e.g. a supplier's `CuSn6` or `SJRG0022-PA-`) to the right entry in
the candidate library, the pipeline first builds a **structured entity profile** — a JSON
object of aliases, materials, processes, properties. That profile (a) widens candidate
recall (its alias/synonym fields become extra retrieval tokens) and (b) grounds the final
LLM ranking. The profile is only as good as the **evidence** fed to it. `web_search`
gathers that evidence.

## One metered query, three ways to use it

Every match issues **exactly one Brave Search query** — that is the metered, rate-limited
resource (Brave free tier: **2,000 queries/month, 1/sec**). Brave's response already
contains, for each result, a `url`, a `title`, and a `description` (a short text excerpt;
plus `extra_snippets` on paid plans). The `strategy` knob decides how that one response
becomes evidence:

| `strategy` | What it does | Evidence depth | Latency | LLM tokens | Brave cost |
|-----------|--------------|----------------|---------|------------|-----------|
| `snippets` | Use the text Brave already returned. No page fetches. | Shallow (a few lines/source) | Instant | Low | 1 query |
| `scrape` | Fetch the full pages behind the URLs. | Deep (full page text) | Slow | High | 1 query |
| `hybrid` *(default)* | Scrape, but fall back to the source's snippet when a page fails or the budget expires. | Deep where sites cooperate, snippet floor everywhere | Medium | Medium | 1 query |

**The cost trade is real but subtle.** All three issue the *same* one metered Brave query,
so none is "more expensive" on the scarce resource. `scrape` *amplifies* that one query
into ~`max_sites` free page-fetches (cheapest **per unit of evidence**), at the cost of
latency, reliability, and more LLM input tokens. `snippets` extracts less text per query
but is instant and cheaper on tokens. To make `snippets` match `scrape`'s depth you would
be tempted to fire *more* Brave queries per term — that is the one thing that burns the
free quota, so the design forbids it: **1 query/match, always.**

## Why this exists (the failure it replaces)

The original implementation discarded Brave's returned text and **always** full-page
scraped every URL. That caused:

- **Multi-minute hangs.** A junk query (`SJRG0022-PA-`) returned ~20 URLs; scraping all 20
  in parallel never completed; the client timed out at ~120s and retried forever — it read
  as a dead backend. The per-URL 5s timeout never bounded the *aggregate* batch or DNS
  resolution.
- **Lost evidence.** Aggressive filtering (skip PDFs, skip domains, min-text-length) threw
  away ~7 of 10 results, and the most relevant materials sources (matweb, basf, sabic) —
  often slow or PDF — were exactly the ones that timed out or were filtered.

The fixes, all live now:

1. **Hard aggregate scrape deadline (`scrape_budget`, default 20s).** The *whole* parallel
   scrape runs under one `asyncio.wait_for`; on overrun it returns whatever completed and
   degrades. A scrape batch can **never** approach the client timeout again. This is the
   single most important fix.
2. **Snippet fallback (`hybrid`).** A failed/slow page falls back to that result's Brave
   snippet, so the evidence set is never empty even when every scrape fails.
3. **PDF extraction (`extract_pdf`, default on).** Datasheets (the truest materials data)
   are PDFs; they used to be blanket-skipped. `pypdf` now extracts their text, under the
   same time budget. Fails soft to a snippet if a PDF is unreadable.
4. **Relaxed filters.** `skip_domains` trimmed to genuine junk (social/login); `.pdf`
   removed from `skip_extensions`; `min_page_text_length` lowered.

## Free to try — a foundational guarantee

- Every strategy works on the **Brave free tier** (`description` only; `extra_snippets` is
  used automatically if you ever upgrade — no code change).
- **1 Brave query per match** is a hard ceiling (asserted in tests via
  `web_cost.brave_queries`), so 2,000/month ≈ 2,000 matches/month free.
- With **no Brave key at all**, the node fails soft to LLM-knowledge-only and still
  produces a profile (lower recall, but the pipeline runs).
- A fresh tenant's first run uses the `llm_only` pipeline (no `web_search` at all) — fully
  free onboarding until the operator opts into web evidence.

## How the winner gets chosen

`strategy` is a **swept optimization axis** (exposed in the node's optimizer `param_keys`).
PromptPotter runs `strategy ∈ {snippets, scrape, hybrid}` over the LCA ground-truth set and
weighs match accuracy against the per-match `web_cost` block
(`{strategy, brave_queries, scrape_attempts, scrape_ok, scrape_failed, evidence_chars}`,
surfaced in the `/matches` response and as a langfuse observation). The default ships as
`hybrid` — it strictly dominates plain `scrape` on reliability at equal Brave cost — but the
data decides, not this doc. Re-sweep the `entity_profiling` prompt after changing strategy:
the evidence base changes, so the prompt's grounding/inference balance should be re-tuned.

## Config quick reference (`web_search.config`)

| Key | Meaning |
|-----|---------|
| `strategy` | `snippets` \| `scrape` \| `hybrid` |
| `scrape_budget` | Aggregate scrape deadline (s) — the hang ceiling |
| `extract_pdf` | Extract text from PDF datasheets (needs `pypdf`) |
| `pdf_max_pages` / `pdf_max_bytes` | Bounds on PDF extraction |
| `max_sites` | Max evidence sources kept (scraped or snippet) |
| `num_results` | Results requested from the one Brave query |
| `content_char_limit` | Max chars kept per evidence source |
| `query_prefix` / `query_suffix` | Search framing (swept; e.g. domain narrowing) |

Per-URL scrape bounds (`scrape_timeout`, `http_content_limit`, retries, jitter, UA pool,
`skip_domains`, `skip_extensions`, …) still apply to `scrape`/`hybrid`.
