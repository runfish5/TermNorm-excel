# WP 6.0a: Simplify Fuzzy Matcher + Confidence Constants

> Parent: [Pipeline Composability Overview](README.md)

**Goal:** Remove overparameterization before codifying config in pipeline JSON.

---

## Current State

`src/matchers/matchers.js` — `findFuzzyMatch()` does forward search at 0.7, then reverse search at 0.5:

```js
// Current (line 94)
export function findFuzzyMatch(value, forward, reverse,
    forwardThreshold = FUZZY_THRESHOLDS.FORWARD,
    reverseThreshold = FUZZY_THRESHOLDS.REVERSE) {
  // 1. Forward search: find best match in forward mappings at 0.7
  const fwd = findBestMatch(normalized, forward, forwardThreshold);
  if (fwd) return { ... direction: 'forward' };

  // 2. Reverse search: find best match in reverse mappings at 0.5 (looser)
  const rev = findBestMatch(normalized, reverse, reverseThreshold);
  if (rev) return { ... direction: 'reverse' };

  return null;
}
```

`src/config/config.js` — three fuzzy thresholds:

```js
export const FUZZY_THRESHOLDS = {
  FORWARD: 0.7,      // Minimum similarity for source→target matching
  REVERSE: 0.5,      // Minimum similarity for target→source verification
  DEFAULT: 0.6,      // Default threshold for general fuzzy operations
};
```

`src/services/normalizer.js` — wrapper that passes both thresholds:

```js
export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse,
    FUZZY_THRESHOLDS.FORWARD, FUZZY_THRESHOLDS.REVERSE);
}
```

## Target

Single-direction search, single threshold. Search all mapping keys (both forward and reverse) in one pass at the same threshold.

## Changes

### `src/config/config.js`

Replace `FUZZY_THRESHOLDS` object with single constant + deprecated alias:

```js
export const FUZZY_THRESHOLD = 0.7;
/** @deprecated Use FUZZY_THRESHOLD */
export const FUZZY_THRESHOLDS = {
  FORWARD: FUZZY_THRESHOLD,
  REVERSE: FUZZY_THRESHOLD,
  DEFAULT: FUZZY_THRESHOLD,
};
```

### `src/matchers/matchers.js`

- Import `FUZZY_THRESHOLD` instead of `FUZZY_THRESHOLDS`
- `findBestMatch()` default `threshold = FUZZY_THRESHOLD`
- `findFuzzyMatch()`: single `threshold` param (default 0.7), same for both passes
- Remove `direction` field from returned objects
- Return `matched_key` for both forward and reverse

### `src/services/normalizer.js`

- Drop explicit threshold args from `findFuzzyMatch()` wrapper
- Update `logMatch()` call: `matched_key` instead of `direction`
- Remove `FUZZY_THRESHOLDS` import

## Behavioral Change

Terms that previously matched only via reverse search at 0.5 threshold will now require 0.7 similarity. If they were genuinely good matches, they'll still match. If they were marginal (0.5-0.69 similarity), they'll fall through to LLM research — which produces better results anyway.

## Impact on Logging

`backend-api/utils/langfuse_logger.py` — `log_fuzzy_match()` accepts `direction` parameter. After this change, direction will always be `None`. No code change needed — the field becomes unused but harmless. Phase 3 refactors this function anyway.

## Verification

1. `npm test` passes
2. Start TermNorm backend + open Excel add-in
3. Match terms that previously hit fuzzy (not cache, not LLM)
4. Verify matches still work — same terms match, similar confidence scores
5. Check that no errors in console
