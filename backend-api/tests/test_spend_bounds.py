"""Spend-bound contract: what one /matches request can bill is known before it is
sent, and every provider request it did send is reported, on success and on failure.

A stub stands in for the provider SDK client, so nothing here reaches a provider.
"""

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

import httpx
import openai
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import core.llm_providers as llm

_REQUEST = httpx.Request("POST", "https://provider.test/v1/chat/completions")
_SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}}
_CAPS = {"max_tokens": 64, "input_bytes": 10_000, "max_price": None}
_TOKEN_LIMIT_BODY = {
    "error": {
        "code": "json_validate_failed",
        "message": "max completion tokens reached before generating a valid document",
    }
}


def _reply(content, *, tokens=(10, 5), cost=None, finish="stop"):
    usage = SimpleNamespace(
        prompt_tokens=tokens[0],
        completion_tokens=tokens[1],
        completion_tokens_details=None,
        cost=cost,
    )
    message = SimpleNamespace(content=content, reasoning=None)
    choice = SimpleNamespace(message=message, finish_reason=finish)
    return SimpleNamespace(choices=[choice], usage=usage, model_extra={})


def _status_error(cls, status, body=None):
    response = httpx.Response(status, request=_REQUEST)
    return cls("upstream failure", response=response, body=body)


class _Provider:
    """Plays ``outcomes`` back in order (the last one repeats); records every send."""

    def __init__(self, outcomes):
        self.outcomes = outcomes
        self.sent = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **params):
        self.sent.append(params)
        outcome = self.outcomes[min(len(self.sent), len(self.outcomes)) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    real_sleep = asyncio.sleep

    async def no_backoff(_delay):
        await real_sleep(0)

    monkeypatch.setattr(llm.asyncio, "sleep", no_backoff)

    def install(*outcomes):
        stub = _Provider(list(outcomes))
        monkeypatch.setattr(llm, "_client", lambda provider, api_key: stub)
        return stub

    return install


def _call(usage, **kwargs):
    messages = [{"role": "user", "content": "q"}]
    kwargs = {"provider": "groq", "model": "m", **_CAPS, **kwargs}
    return asyncio.run(llm.llm_call(messages, usage_out=usage, **kwargs))


def test_every_attempt_is_counted_and_its_usage_summed(provider):
    stub = provider(
        _status_error(openai.InternalServerError, 500),
        _reply('{"answer": 1}', tokens=(10, 5), cost=0.001),
        _reply('{"answer": "x"}', tokens=(30, 7), cost=0.002),
    )
    usage = {}
    assert _call(usage, output_format="schema", schema=_SCHEMA) == {"answer": "x"}
    assert usage["attempts"] == len(stub.sent) == 3
    assert (usage["input"], usage["output"]) == (40, 12)
    assert usage["cost_usd"] == pytest.approx(0.003)
    assert [p["max_tokens"] for p in stub.sent] == [64, 64, 64]


@pytest.mark.parametrize(
    "outcome",
    [
        _reply('{"answer": "cut of', finish="length"),
        _status_error(openai.BadRequestError, 400, _TOKEN_LIMIT_BODY),
    ],
    ids=["truncated_reply", "token_limit_error"],
)
def test_a_hit_output_cap_is_the_result_not_a_retry(provider, outcome):
    stub = provider(outcome)
    usage = {}
    with pytest.raises(HTTPException):
        _call(usage, output_format="schema", schema=_SCHEMA)
    assert usage["attempts"] == len(stub.sent) == 1
    assert usage["finish_reason"] == "length"
    assert stub.sent[0]["max_tokens"] == 64


@pytest.mark.parametrize(
    "failure, sends",
    [
        (openai.APITimeoutError(request=_REQUEST), 1),
        (openai.APIConnectionError(request=_REQUEST), 3),
    ],
    ids=["read_timeout_may_have_billed", "unsent_connection"],
)
def test_only_unbilled_failures_are_resent(provider, failure, sends):
    stub = provider(failure)
    usage = {}
    with pytest.raises(HTTPException) as err:
        _call(usage)
    assert err.value.status_code == 503
    assert usage["attempts"] == len(stub.sent) == sends


@pytest.mark.parametrize("name, routed", [("openrouter", True), ("groq", False)])
def test_max_price_routes_openrouter_only(provider, name, routed):
    stub = provider(_reply("ok"))
    price = {"prompt": 0.2, "completion": 0.8}
    _call({}, provider=name, max_price=price)
    routing = {"provider": {"max_price": price, "require_parameters": True}}
    assert stub.sent[0].get("extra_body") == (routing if routed else None)


@contextmanager
def _client():
    from main import app

    with TestClient(app, client=("127.0.0.1", 5555)) as c:
        yield c


def _llm_only(client, query_bytes):
    body = {"query": "x" * query_bytes, "steps": ["llm_only"]}
    return client.post("/matches", json=body)


def test_pipeline_serves_the_bound_matches_enforces(provider):
    stub = provider(_status_error(openai.InternalServerError, 500))
    with _client() as c:
        nodes = c.get("/pipeline").json()["data"]["nodes"]
        bound = nodes["llm_only"]["spend_bound"]
        at_cap = _llm_only(c, bound["input_bytes"])
        over_cap = _llm_only(c, bound["input_bytes"] + 1)

    web = nodes["web_search"]
    assert web["spend_bound"] == {
        "kind": "web",
        "queries": 1,
        "usd_per_query": web["config"]["usd_per_query"],
    }
    llm_nodes = [n for n in nodes.values() if n["type"] == "llm"]
    assert all(n["spend_bound"]["kind"] == "llm" for n in llm_nodes)
    # At the cap the request goes out, an always-failing provider drives it to the
    # served attempt bound, and the error envelope still reports every send.
    assert at_cap.status_code == 503
    spent = at_cap.json()["data"]["step_tokens"]["llm_only"]
    assert spent["attempts"] == bound["attempts"] == len(stub.sent)
    assert {p["max_tokens"] for p in stub.sent} == {bound["max_tokens"]}
    # One byte over, it is refused before any provider request.
    assert over_cap.status_code == 413
    assert over_cap.json()["code"] == "input_too_large"
    assert len(stub.sent) == bound["attempts"]
