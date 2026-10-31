"""The slot contract `llm_only` shares with PromptPotter: `answer_fields` picks what is posted back.

A stub stands in for ``llm_call``, so nothing here reaches a provider.
"""

import asyncio
import json

import pytest

import api.pipeline_steps as steps
from core.pipeline_context import PipelineContext

_SCHEMA = {
    "type": "object",
    "properties": {
        "rationale": {"type": "string"},
        "type_of_document": {"type": "string"},
        "requires_action": {"type": "boolean"},
        "extract_depth": {"type": "integer"},
    },
}


def _run(monkeypatch, reply, answer_fields):
    async def _llm_call(**_kwargs):
        return reply

    monkeypatch.setattr(steps, "llm_call", _llm_call)
    cfg = {
        "provider": "groq",
        "model": "m",
        "temperature": 0.0,
        "response_format": "json",
        "max_tokens": 64,
        "input_bytes": 10_000,
        "max_price": None,
        "output_schema": _SCHEMA,
        "answer_fields": answer_fields,
    }
    ctx = PipelineContext("q", "u", ["llm_only"], {})
    return asyncio.run(steps._step_llm_only("q", cfg, ctx)).output


def test_one_slot_answers_with_its_value(monkeypatch):
    out = _run(monkeypatch, {"rationale": "r", "requires_action": True}, ["requires_action"])
    assert out["final_ranking"] == [{"candidate": "true", "relevance_score": 1.0}]
    assert "rationale: r" in out["reasoning_trace"]


def test_several_slots_answer_with_their_object_in_declared_order(monkeypatch):
    reply = {
        "rationale": "an invoice",
        "extract_depth": 2,
        "type_of_document": "Rechnung",
        "requires_action": False,
    }
    fields = ["type_of_document", "requires_action", "extract_depth"]
    out = _run(monkeypatch, reply, fields)
    answer = out["final_ranking"][0]["candidate"]
    assert list(json.loads(answer).items()) == [
        ("type_of_document", "Rechnung"),
        ("requires_action", False),
        ("extract_depth", 2),
    ]
    assert out["reasoning_trace"] == "rationale: an invoice", "a graded slot leaked into the working"


def test_an_empty_string_inside_the_object_is_a_value(monkeypatch):
    out = _run(monkeypatch, {"type_of_document": "", "requires_action": False}, ["type_of_document", "requires_action"])
    assert json.loads(out["final_ranking"][0]["candidate"]) == {"type_of_document": "", "requires_action": False}


def test_a_missing_slot_is_no_result(monkeypatch):
    out = _run(monkeypatch, {"type_of_document": "invoice"}, ["type_of_document", "requires_action"])
    assert out["final_ranking"] == []


def test_an_undeclared_field_is_refused(monkeypatch):
    with pytest.raises(ValueError, match="not properties of output_schema"):
        _run(monkeypatch, {}, ["type_of_document", "nope"])
