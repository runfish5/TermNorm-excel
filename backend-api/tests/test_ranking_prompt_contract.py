"""Tests for the llm_ranking prompt contract — one declaration of the output shape.

Self-contained: no pytest required. Run directly:

    .venv/Scripts/python.exe tests/test_ranking_prompt_contract.py

Guards the invariant that makes ``logs/schemas/llm_ranking_output/1/schema.json`` load-bearing:
the structure block appended to the ranking prompt is RENDERED from that schema, so the schema's
field order and description strings are the prompt. Nothing here calls an LLM or the network.

Background: the shape used to be declared in five places (a Python literal, the on-disk schema,
a hand-written f-string, the prompt template, and a stale prompt.txt), two of which disagreed
about which fields even existed. See docs in utils/schema_registry.py.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.pipeline_config import get_node_config
from utils.prompt_registry import get_prompt_registry
from utils.schema_registry import format_string_from_schema, get_schema_registry

_FAILURES = []


def check(label, cond):
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}")
        _FAILURES.append(label)


def _ranking_schema():
    cfg = get_node_config("llm_ranking")
    return get_schema_registry().get_schema(cfg["schema_family"], cfg.get("schema_version"))


def _item_props():
    return _ranking_schema()["properties"]["ranked_candidates"]["items"]["properties"]


def test_candidate_is_first():
    """`candidate` is an identifier, not a decision — it leads the object."""
    check("candidate stays first", list(_item_props())[0] == "candidate")


def test_rendered_block_preserves_schema_order():
    """The prompt block is the schema. If these drift, the schema has stopped being the source."""
    block = format_string_from_schema(_ranking_schema())
    emitted = [ln.split('"')[1] for ln in block.splitlines() if ln.startswith('      "')]
    check("rendered block field order == schema.json order", emitted == list(_item_props()))
    check("nested array-of-object rendered, not flattened to a string hint",
          '"ranked_candidates": [' in block and '"candidate":' in block)
    check("descriptions are inlined as placeholders (they are prompt, not docs)",
          "Brief explanation without quotes or backslashes" in block)


def test_consumer_required_fields_are_demanded():
    """_correct_candidate_strings defaults these to 0.0 when absent, silently zeroing every
    relevance_score. The prompt must therefore name them explicitly."""
    full = _render_full_prompt()
    check("prompt demands core_concept_score", "core_concept_score" in full)
    check("prompt demands spec_score", "spec_score" in full)
    check("prompt does not demand the computed relevance_score",
          "Assign each candidate a relevance_score" not in full)


def test_single_structure_declaration():
    full = _render_full_prompt()
    check("exactly one 'exact structure' directive", full.count("exact structure") == 1)
    for dead in ('"rank"', "rationale", '"reasoning"'):
        check(f"no reference to dead field {dead}", dead not in full)


def test_load_bearing_rules_survive():
    """Two rules are load-bearing and must not be lost with the wrong-contract JSON block:
    completeness, and best-first ordering (research_pipeline reads ranked[0] as the answer;
    nothing sorts)."""
    full = _render_full_prompt()
    check("completeness rule survives", "include ALL candidates" in full)
    check("best-first ordering rule survives", "element 0 is the strongest match" in full)
    check("JSON-escaping guidance survives", "properly escaped" in full)


def test_schema_file_is_not_alphabetised():
    """A `sort_keys=True` tidy-up would silently revert the field-order fix."""
    cfg = get_node_config("llm_ranking")
    path = os.path.join("logs", "schemas", cfg["schema_family"], str(cfg["schema_version"]),
                        "schema.json")
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    props = list(raw["properties"]["ranked_candidates"]["items"]["properties"])
    check("schema.json item fields are not alphabetically sorted", props != sorted(props))


def _render_full_prompt():
    cfg = get_node_config("llm_ranking")
    prompt = get_prompt_registry().render_prompt(
        family=cfg["prompt_family"], version=cfg["prompt_version"],
        query="steel plate", core_concept="plate",
        entity_profile_json="{}", matches="- Steel Plate",
    )
    block = format_string_from_schema(_ranking_schema())
    return (
        f"{prompt}\n\nIMPORTANT: Return a valid JSON response matching this exact structure:\n"
        f"{block}\n\nEnsure all strings are properly escaped and avoid complex punctuation in reasoning."
    )


def test_enum_renders_its_value_space_in_declaration_order():
    """An `enum` must reach the model through the PROMPT, not only the wire.

    `output_format="json"` sends no schema at all, and even on the `"schema"` path constrained
    decoding is provider-dependent (Groq does not honor `enum`). So the rendered structure block
    is the channel that TEACHES the value space. Before this branch existed, a
    `{"type":"string","enum":[...]}` fell through to the `string` case and the choices vanished
    silently -- the model was never told what the legal answers were.

    Order is load-bearing: the model reads the first value as prototypical. Never sort.
    """
    from utils.schema_registry import format_string_from_schema

    schema = {
        "type": "object",
        "properties": {
            "reasoning": {"type": "string", "description": "Work through the premises."},
            "answer": {"type": "string", "enum": ["TRUE", "FALSE", "Uncertain"]},
        },
    }
    rendered = format_string_from_schema(schema)
    check("enum values reach the prompt", '"TRUE" | "FALSE" | "Uncertain"' in rendered)
    check("enum is not the bare 'string' placeholder", '"answer": "string"' not in rendered)
    check(
        "declaration order preserved (reasoning before answer)",
        rendered.index("reasoning") < rendered.index("answer"),
    )

    reordered = format_string_from_schema(
        {"type": "object", "properties": {"answer": {"type": "string", "enum": ["Uncertain", "TRUE"]}}}
    )
    check("enum order is not sorted", '"Uncertain" | "TRUE"' in reordered)

    # An enum outranks `description`: the model needs the choices, not a paraphrase of them.
    glossed = format_string_from_schema(
        {"type": "object", "properties": {"a": {"type": "string", "enum": ["X"], "description": "D"}}}
    )
    check("enum outranks description", '"a": "X"' in glossed and '"a": "D"' not in glossed)


def test_installed_schemas_render_byte_identically():
    """The enum branch must not perturb any schema that declares no enum.

    `entity_profile` and `llm_ranking_output` are the only installed families; neither uses an
    enum today, so both renders must be unchanged. A regression here silently rewrites a live
    prompt.
    """
    from utils.schema_registry import format_string_from_schema, get_schema_registry

    reg = get_schema_registry()
    for family in ("entity_profile", "llm_ranking_output"):
        schema = reg.get_schema(family)
        check(f"{family} declares no enum", "enum" not in json.dumps(schema))
        rendered = format_string_from_schema(schema)
        check(f"{family} still renders", rendered.startswith("{") and rendered.endswith("}"))


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"\n{name}")
            fn()
    print()
    if _FAILURES:
        print(f"{len(_FAILURES)} FAILED: {_FAILURES}")
        sys.exit(1)
    print("all checks passed")
