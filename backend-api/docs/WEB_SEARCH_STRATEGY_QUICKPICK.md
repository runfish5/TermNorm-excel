# Which web-search strategy? (30-second guide)

> **Status: provisional (new in v1.2.0).** This is a young, still-moving concept — usable and
> shipping, but not yet settled. It may be simplified later (see the note at the bottom). Read this
> before picking `web_search.config.strategy` in `pipeline.json`. Full rationale:
> [`WEB_SEARCH_STRATEGY.md`](./WEB_SEARCH_STRATEGY.md).

## The idea in one line

Every match makes **exactly one** web search (one metered Brave query). The `strategy` setting only
decides **how much of that one result you actually read** — from "just the preview text" to "open and
read the full pages." More reading = better evidence, but slower and more tokens.

## Pick one

| Pick… | When | Trade-off |
|-------|------|-----------|
| **`snippets`** | You want it **fast and cheap**, and the search previews already say enough (common names, well-indexed terms). | Shallowest evidence — just the few lines Brave shows. Instant, fewest tokens, never hangs. |
| **`scrape`** | You need **maximum depth** — obscure part numbers, datasheets, spec tables that only exist on the actual page. | Slowest, most tokens. A site that's down or slow simply yields nothing for that source. |
| **`hybrid`** *(default)* | You're **not sure** / want a safe general default. | Reads full pages where it can, falls back to the preview where it can't. Never empty, never hangs. Medium cost. Start here. |

**Rule of thumb:** start on **`hybrid`**. Drop to `snippets` if you want speed/cost and accuracy holds.
Move to `scrape` only if you've confirmed the answers live in full page text the previews miss.

## Good to know

- **Cost is the same on the scarce resource.** All three make the *same* single Brave query, so none
  burns more of the free quota (2,000 queries/month). They differ only in page-fetch time and how many
  tokens the evidence adds to the LLM call. The way to *actually* blow the quota is firing more queries
  per term — the design forbids that: **one query per match, always.**
- **You don't pick this per-cell.** It's a config knob (`pipeline.json` → node `web_search`), not a
  button in the Excel add-in. Set it once for a project, or let the optimizer sweep it.
- **Let the optimizer choose.** Each match reports a `web_cost` block (queries, scrape successes/
  failures, evidence size). PromptPotter reads that against accuracy on your ground truth to pick the
  most-efficiently-true mode for *your* data — often better than guessing.

## Why "provisional"

The three names are really **two behaviors** — read-previews (`snippets`) vs read-pages (`scrape`) —
with `hybrid` being `scrape` plus a "fall back to the preview on failure" safety net. And whether web
evidence is gathered *at all* is already decided elsewhere (which pipeline/steps run). So this knob
overlaps with existing controls and may be folded into something simpler. **Use it, but don't wire
hard dependencies on the exact three-way shape** — if it changes, `hybrid` (the safe default) is the
behavior most likely to survive.
