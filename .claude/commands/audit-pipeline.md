# Latent Parameter Transparency Audit

Enforce the principle: **a config file is not a list of what users change — it is a complete declaration of what the system assumes.**

**Target**: $ARGUMENTS (config file path, module, or "all")

---

## The Standard

A parameter that no current user will ever touch may be the single most critical lever for the next community that adopts this system. The system's primary use case creates invisible defaults — values so "obviously correct" for the current domain that nobody thinks to expose them. When the system migrates to a new domain, these are exactly the assumptions that break everything silently.

**Every assumption must be named. No implicit defaults. No buried constants.**

---

## Instructions

1. **Locate the master config** — identify the single source of truth for tunable parameters (e.g. `pipeline.json`, `config.yaml`, `settings.py`). If $ARGUMENTS specifies a path, use that. Otherwise infer from project structure.

2. **Map config entries to implementation** — trace each declared parameter to where it is consumed in code. Note any declared params that are *unused* (dead config).

3. **Perform deep assumption analysis** across all implementation files in scope. For each file, surface:

   - **Numeric literals** — magic numbers, thresholds, slice sizes, multipliers
   - **String constants** — hardcoded labels, format strings, algorithm names
   - **Function defaults** — `def f(x=value)` where value encodes a domain assumption
   - **Library kwargs not passed** — calls where available parameters are omitted, accepting library defaults silently
   - **Design-level assumptions** — domain choices that predate any parameter: what data is expected to look like, what language, what scale, what ontology. These may have no variable anywhere in the code.

4. **Classify every finding**:

   | Status | Meaning |
   |--------|---------|
   | `CONFIGURED` | Explicitly declared in master config |
   | `HARDCODED` | Tunable value in code, absent from config |
   | `IMPLICIT` | Library default accepted without being named |
   | `HIDDEN` | Library supports it, code doesn't pass it at all |
   | `ASSUMPTION` | Domain belief baked into design — no parameter exists yet, but a different use case would need one |

   `ASSUMPTION` is the hardest and most important category. Ask: *if this system were adopted by a different scientific community, a different language, a different scale — what would silently break first?*

5. **Output a structured report** per module:

```
## Module: <name>
File: <path>

### CONFIGURED
- `key`: <value> — <what it controls>

### HARDCODED
- `suggested_key`: <value> (line N) — <why it matters in a different context>

### IMPLICIT
- `suggested_key`: <library_default> (from <lib.function>) — <what it controls>

### HIDDEN  
- `param_name` (from <lib.function>) — <what it would do>

### ASSUMPTION
- <description of the domain belief> — <what breaks if the domain changes>
```

6. **Summary table**:

```
| Module | CONFIGURED | HARDCODED | IMPLICIT | HIDDEN | ASSUMPTION |
|--------|-----------|-----------|----------|--------|------------|
```

---

## Notes

- Prioritise parameters that affect output quality, correctness, or behaviour over infrastructure concerns (logging, retries)
- For `ASSUMPTION` findings: use the *timezone analogy* as your bar — would a reasonable engineer from a different domain be surprised this wasn't configurable?
- The goal is complete system transparency: scientific reproducibility, full portability, zero silent behavioural differences across deployment contexts