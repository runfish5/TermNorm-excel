"""Endpoint contract smoke tests for the /sessions · /matches · /prompts highway.

These lock the request/response CONTRACT the PromptPotter connector depends on —
IP auth, the session envelope (the stable ``no_session`` code PP self-heals on),
the single success-envelope shape, and pre-LLM validation — WITHOUT triggering
any real LLM or web call. They are the regression net for splitting
``api/research_pipeline.py`` (the god-file / Arc 5 refactor): moving the session
store, the step registry, or the response builder must keep every assertion here
green.

IP → user mapping comes from ``config/users.json``:
  127.0.0.1     → admin      (used for session-bearing tests)
  192.168.1.100 → user_001   (used for the no-session test — never given a session)
The default TestClient host is "testclient", which IP auth rejects; each client
is built with an explicit authorized ``client=(ip, port)``.
"""
from contextlib import contextmanager

from fastapi.testclient import TestClient


@contextmanager
def _client(ip: str):
    """A TestClient whose request.client.host is *ip* (drives IP-based auth)."""
    from main import app
    with TestClient(app, client=(ip, 5555)) as c:
        yield c


def test_unauthorized_ip_is_rejected():
    with _client("10.0.0.99") as c:
        r = c.post("/sessions", json={"terms": ["x"]})
    assert r.status_code == 403
    body = r.json()
    assert body["status"] == "error"
    assert body["code"] == 403


def test_sessions_handshake_creates_session():
    with _client("127.0.0.1") as c:
        r = c.post("/sessions", json={"terms": ["Steel Pipe DN50", "Copper Elbow"]})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert body["data"]["term_count"] == 2


def test_sessions_requires_terms():
    with _client("127.0.0.1") as c:
        r = c.post("/sessions", json={})
    assert r.status_code == 400


def test_matches_without_session_returns_stable_no_session_code():
    # user_001 (192.168.1.100) is authorized but never handed a session, so a
    # full-pipeline /matches must fail with the *machine-readable* code the PP
    # connector keys its re-POST /sessions + retry self-heal on — not a bare 400.
    with _client("192.168.1.100") as c:
        r = c.post("/matches", json={"query": "Steel Pipe DN50"})
    assert r.status_code == 400
    body = r.json()
    assert body["status"] == "error"
    assert body["code"] == "no_session"
    # The full detail dict is preserved verbatim in the envelope (PP reads it).
    assert body["detail"]["code"] == "no_session"


def test_matches_success_envelope_shape(monkeypatch):
    # Guards the response builder + dispatch loop on a non-LLM terminal
    # (fuzzy_matching). Persistence is stubbed so the run has zero file-I/O side
    # effects regardless of which terminal node the pipeline settles on.
    import api.research_pipeline as rp
    monkeypatch.setattr(rp, "update_match_database", lambda *a, **k: None)
    monkeypatch.setattr(rp, "log_pipeline", lambda *a, **k: None)

    with _client("127.0.0.1") as c:
        c.post("/sessions", json={"terms": ["Steel Pipe DN50", "Copper Elbow"]})
        r = c.post("/matches", json={"query": "Steel Pipe DN50", "steps": ["fuzzy_matching"]})

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    data = body["data"]
    # The ONE canonical /matches shape (see _response_data): these keys exist for
    # every terminal — a consumer never special-cases on node count.
    assert isinstance(data["final_ranking"], list)
    assert "diagnostics" in data
    assert data["pipeline_params"]["requested_steps"] == ["fuzzy_matching"]


def test_prompts_rejects_empty_query():
    # /prompts (direct_prompt) validates before any LLM dispatch: an empty query
    # is a 400, not a 200-with-error and not a wasted LLM call.
    with _client("127.0.0.1") as c:
        r = c.post("/prompts", json={"user_prompt": "normalize it"})
    assert r.status_code == 400
