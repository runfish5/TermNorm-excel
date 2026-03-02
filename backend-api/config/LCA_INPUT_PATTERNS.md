# Domain Context: Life Cycle Assessment (LCA) Terminology

This document captures the real-world input patterns and matching challenges that TermNorm's normalization pipeline must handle when working with LCA databases (ecoinvent, GaBi, etc.).

## Free-form input characteristics

Users type cryptic shorthand drawn from industrial standards, trade catalogs, and chemical nomenclature. These inputs must be matched to rigidly formatted database entries.

### Industrial material codes
- Alloy designations: `CuZn36-MS-63-FS material no. 2.0335`, `EN AW-AL99,5 H14`
- Werkstoff numbers: `2.0335`, `1.4301`
- Temper/condition suffixes: `H14`, `T6`, `FS`

### Standard references
- DIN/ISO/IEC codes that encode material identity indirectly: `DIN 55468-1`, `IEC 60317-29`, `ISO 898-1`
- The standard number implies a material class (e.g., ISO 898-1 = carbon steel fasteners) but doesn't name it

### Brand and trade names
- Proprietary names requiring domain knowledge to decode:
  - `Makrolon 2805` = polycarbonate (Covestro)
  - `Ultramid A3SK` = PA66 (BASF)
  - `Delrin 500P` = POM/acetal (DuPont)
- Grade suffixes (`2805`, `A3SK`) distinguish variants but don't appear in LCA databases

### Chemical shorthand
- Polymer blends with fillers: `PA66+6-GFR30` (polyamide 66/6 blend, 30% glass fiber reinforced)
- Contact materials: `AgC3` (silver-graphite composite)
- Truncated IUPAC names, CAS numbers, chemical formulas embedded in free text

### Agricultural qualifiers
- Farming systems: `IP` (integrated production), `ÖLN` (proof of ecological performance), `organic`
- Supply chain stages: `at farm`, `at plant`, `at household`, `at regional storage`
- These qualifiers select among variants of the same product in the database

### Geographic scoping
- ecoinvent geography codes: `{GLO}` (global), `{RER}` (Europe), `{RNA}` (North America), `{CH}` (Switzerland)
- SimaPro-style suffixes: `/CH U`, `/RER S`
- The same product exists as multiple geographic variants; the correct match depends on project scope

### Mixed languages and formats
- German/French/English terms mixed within a single input
- Abbreviated units and quantities inline with material names
- Free-text notes appended to technical identifiers

## Matching challenges

### Structural mismatch
Inputs are unstructured shorthand; targets are rigidly formatted database entries with fixed naming conventions (e.g., `market for polyethylene, high density | polyethylene, high density | cut-off, U - RER`). No simple string similarity bridges this gap reliably.

### Domain knowledge required
- Brand names must be decoded: `Makrolon` requires knowing it's Covestro's polycarbonate brand
- Material composition codes don't appear in targets: `CuZn36` must be recognized as brass
- Standards references encode identity indirectly: `ISO 898-1` implies carbon steel, not a named material

### Synonym and naming evolution
- Database entries evolve across versions: `Arsenic` becomes `Arsenic, ion`
- Multiple valid names for the same substance: `aluminium` vs `aluminum`, `glass fibre` vs `glass fiber`
- Abbreviations vs full names: `PP` vs `polypropylene`, `PET` vs `polyethylene terephthalate`

### Geographic variants
- Identical products exist with different geography tags
- Selecting the right variant depends on project context, not just the input text

### No-match inputs
- Some inputs have no corresponding database entry (indicated by `--` in ground truth)
- The pipeline must recognize when no match exists rather than forcing a low-quality match

### Compositional inputs
- Inputs describing blends or composites (`PA66+6-GFR30`) may need to be decomposed into constituent materials
- The database may have the base polymer but not the specific filled/reinforced variant
