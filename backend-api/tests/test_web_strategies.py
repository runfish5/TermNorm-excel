"""Tests for the strategy-driven web evidence gathering (snippets / scrape / hybrid).

Self-contained: no pytest / pytest-asyncio required. Run directly:

    .venv/Scripts/python.exe tests/test_web_strategies.py

Each ``test_*`` is sync and drives async code via ``asyncio.run`` so the file is
also pytest-discoverable if pytest is later added. All LLM + network calls are
stubbed — nothing here touches Brave or a provider. See docs/WEB_SEARCH_STRATEGY.md.
"""
import asyncio
import os
import sys
import time
from contextlib import contextmanager

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import research_and_rank.web_generate_entity_profile as web  # noqa: E402

SCHEMA = {
    "type": "object",
    "properties": {"core_concept": {"type": "string"}, "entity_name": {"type": "string"}},
    "required": ["core_concept"],
}

# Custom prompt → exercise the no-registry path (keeps the test off the prompt registry).
EP_CFG = {
    "raw_content_limit": 5000,
    "provider": "groq",
    "model": "openai/gpt-oss-120b",
    "temperature": 0.3,
    "output_schema": SCHEMA,
    "prompt": "Profile {{query}} from:\n{{combined_text}}\nReturn {{format_string}}",
}


def _ws_cfg(strategy, **over):
    cfg = {
        "strategy": strategy, "scrape_budget": 0.5, "extract_pdf": False,
        "max_sites": 3, "num_results": 5, "content_char_limit": 200,
        "brave_api_timeout": 5, "query_prefix": "", "query_suffix": "",
    }
    cfg.update(over)
    return cfg


class FakeResp:
    def __init__(self, status=200, headers=None, json_data=None, body=b"", text=""):
        self.status_code = status
        self.headers = headers or {}
        self._json = json_data
        self._body = body
        self.text = text

    def json(self):
        return self._json

    def iter_content(self, chunk_size=8192):
        for i in range(0, len(self._body), chunk_size):
            yield self._body[i:i + chunk_size]

    def close(self):
        pass


def _brave_results(with_extra_snippets):
    r = [
        {"url": "https://matweb.com/x", "title": "MatWeb CuSn6",
         "description": "CuSn6 is a tin bronze used for springs."},
        {"url": "https://example.com/y", "title": "Example",
         "description": "Generic bronze info."},
    ]
    if with_extra_snippets:
        r[0]["extra_snippets"] = ["Density 8.8 g/cm3", "EN CW452K"]
    return r


@contextmanager
def _patched(brave_results, scrape_impl=None):
    """Stub Brave + provider + (optionally) scrape. Restores on exit."""
    orig_get = web.requests.get
    orig_llm = web.llm_call
    orig_scrape = web.scrape_url
    orig_use = web.settings.use_brave_api
    orig_key = web.settings.brave_search_api_key

    def fake_get(url, **kw):
        if "api.search.brave.com" in url:
            return FakeResp(json_data={"web": {"results": brave_results}})
        html = b"<html><head><title>Scraped</title></head><body>" + b"materials data " * 30 + b"</body></html>"
        return FakeResp(headers={"Content-Type": "text/html"}, body=html)

    async def fake_llm(**kwargs):
        if kwargs.get("usage_out") is not None:
            kwargs["usage_out"].update({"input": 10, "output": 5})
        return {"core_concept": "spring", "entity_name": "CuSn6"}

    web.requests.get = fake_get
    web.llm_call = fake_llm
    web.settings.use_brave_api = True
    web.settings.brave_search_api_key = "test-key"
    if scrape_impl is not None:
        web.scrape_url = scrape_impl
    try:
        yield
    finally:
        web.requests.get = orig_get
        web.llm_call = orig_llm
        web.scrape_url = orig_scrape
        web.settings.use_brave_api = orig_use
        web.settings.brave_search_api_key = orig_key


def _assert_contract(debug):
    assert "scraped_sources" in debug["inputs"], "missing inputs.scraped_sources"
    for w in debug["warnings"]:
        for k in ("step", "code", "message", "kind"):
            assert k in w, f"warning missing {k}: {w}"
    assert "web_search_elapsed" in debug
    assert "llm_elapsed" in debug
    assert "scraped_content" in debug
    assert "web_cost" in debug


# --- _brave_search returns full records (free + paid payloads) ----------------

def test_brave_search_returns_records_free_tier():
    with _patched(_brave_results(with_extra_snippets=False)):
        recs, _ = web._brave_search("CuSn6", num_results=5)
    assert len(recs) == 2
    assert recs[0]["url"] == "https://matweb.com/x"
    assert recs[0]["title"] == "MatWeb CuSn6"
    assert "tin bronze" in recs[0]["snippet"]           # description harvested
    assert "\n" not in recs[1]["snippet"] or recs[1]["snippet"]  # single-line ok


def test_brave_search_uses_extra_snippets_when_present():
    with _patched(_brave_results(with_extra_snippets=True)):
        recs, _ = web._brave_search("CuSn6", num_results=5)
    assert "Density 8.8 g/cm3" in recs[0]["snippet"]     # paid extra_snippets folded in
    assert "EN CW452K" in recs[0]["snippet"]


# --- Brave 429 surfaces the real reason on the canonical warning channel ------

def test_brave_429_surfaces_rate_limited_warning():
    """A Brave 429 must reach the consumer as code=rate_limited/kind=transient
    carrying the real body — not the old generic 'No web evidence — no results'."""
    @contextmanager
    def _patched_429():
        orig_get, orig_llm = web.requests.get, web.llm_call
        orig_use, orig_key = web.settings.use_brave_api, web.settings.brave_search_api_key

        def fake_get(url, **kw):
            assert "api.search.brave.com" in url  # only the Brave call happens — no scrape on []
            return FakeResp(status=429, text="rate limit exceeded")

        async def fake_llm(**kwargs):
            if kwargs.get("usage_out") is not None:
                kwargs["usage_out"].update({"input": 10, "output": 5})
            return {"core_concept": "spring", "entity_name": "CuSn6"}

        web.requests.get, web.llm_call = fake_get, fake_llm
        web.settings.use_brave_api, web.settings.brave_search_api_key = True, "test-key"
        try:
            yield
        finally:
            web.requests.get, web.llm_call = orig_get, orig_llm
            web.settings.use_brave_api, web.settings.brave_search_api_key = orig_use, orig_key

    with _patched_429():
        profile, debug = asyncio.run(web.web_generate_entity_profile(
            "CuSn6", ws_cfg=_ws_cfg("hybrid"), ep_cfg=EP_CFG, schema=SCHEMA))
    _assert_contract(debug)
    ws = [w for w in debug["warnings"] if w["step"] == "web_search"]
    assert ws, "expected a web_search warning"
    w = ws[0]
    assert w["code"] == "rate_limited"
    assert w["kind"] == "transient"
    assert "429" in w["message"]
    assert "rate limit exceeded" in w["message"]


# --- snippets strategy: one query, no scraping --------------------------------

def test_snippets_strategy_builds_evidence_without_scraping():
    def boom(*a, **k):
        raise AssertionError("scrape_url must NOT be called in snippets strategy")

    with _patched(_brave_results(False), scrape_impl=boom):
        profile, debug = asyncio.run(web.web_generate_entity_profile(
            "CuSn6", ws_cfg=_ws_cfg("snippets"), ep_cfg=EP_CFG, schema=SCHEMA))
    _assert_contract(debug)
    assert debug["web_cost"]["strategy"] == "snippets"
    assert debug["web_cost"]["brave_queries"] == 1           # free-tier ceiling
    assert debug["web_cost"]["scrape_attempts"] == 0
    assert len(debug["scraped_content"]) == 2
    assert "tin bronze" in debug["scraped_content"][0]["content"]


# --- scrape strategy: hard aggregate deadline = no hang -----------------------

def test_scrape_aggregate_deadline_never_hangs():
    def slow_scrape(url, char_limit, extract_pdf=False):
        time.sleep(2.0)                                       # > scrape_budget (0.5)
        return {"title": "x", "url": url, "content": "y" * char_limit}

    async def body():
        records = [{"url": "https://a/1", "title": "A", "snippet": "snip-a"},
                   {"url": "https://b/2", "title": "B", "snippet": "snip-b"}]
        t0 = time.monotonic()
        out, stats = await web._from_scrape(
            records, max_sites=3, content_char_limit=100, scrape_budget=0.5,
            extract_pdf=False, snippet_fallback=True)
        return out, stats, time.monotonic() - t0

    with _patched(_brave_results(False), scrape_impl=slow_scrape):
        out, stats, dt = asyncio.run(body())
    assert dt < 1.5, f"scrape did not respect the {0.5}s budget (took {dt:.2f}s)"
    assert stats["scrape_failed"] == 2                        # both overran → failed
    assert len(out) == 2 and out[0]["content"] == "snip-a"    # hybrid snippet fallback


# --- hybrid: failed scrape falls back to that source's snippet ----------------

def test_hybrid_falls_back_to_snippet_on_scrape_failure():
    def failing_scrape(url, char_limit, extract_pdf=False):
        return {"_scrape_error": "boom", "url": url}

    async def body():
        records = [{"url": "https://a/1", "title": "A", "snippet": "the snippet text"}]
        return await web._from_scrape(records, 3, 100, 5, False, snippet_fallback=True)

    with _patched(_brave_results(False), scrape_impl=failing_scrape):
        out, stats = asyncio.run(body())
    assert stats["scrape_failed"] == 1 and stats["scrape_ok"] == 0
    assert len(out) == 1 and out[0]["content"] == "the snippet text"


# --- PDF routing + fail-soft --------------------------------------------------

def test_pdf_extraction_fail_soft():
    assert web._extract_pdf_text(b"not a real pdf") == ""     # never raises


def test_scrape_routes_pdf_when_enabled():
    orig_get = web.requests.get
    orig_extract = web._extract_pdf_text
    web.requests.get = lambda url, **kw: FakeResp(
        headers={"Content-Type": "application/pdf"}, body=b"%PDF-fake-bytes")
    web._extract_pdf_text = lambda data: "extracted datasheet text " * 10
    try:
        ok = web.scrape_url("https://matweb.com/sheet.pdf", 500, extract_pdf=True)
        off = web.scrape_url("https://matweb.com/sheet.pdf", 500, extract_pdf=False)
    finally:
        web.requests.get = orig_get
        web._extract_pdf_text = orig_extract
    assert "content" in ok and "extracted datasheet text" in ok["content"]
    assert off.get("_filtered") == "non_html"                 # skipped when disabled


# --- skip_search + precomputed branches (unchanged contract) ------------------

def test_skip_search_branch():
    with _patched(_brave_results(False)):
        profile, debug = asyncio.run(web.web_generate_entity_profile(
            "CuSn6", ws_cfg=_ws_cfg("snippets"), ep_cfg=EP_CFG, schema=SCHEMA, skip_search=True))
    assert debug["inputs"]["scraped_sources"]["status"] == "skipped"
    assert debug["web_cost"]["brave_queries"] == 0            # no metered query
    assert debug["web_cost"]["strategy"] == "skipped"


def test_precomputed_branch_roundtrips():
    pre = [{"title": "Cached", "url": "https://c/1", "content": "cached evidence"}]
    with _patched(_brave_results(False)):
        profile, debug = asyncio.run(web.web_generate_entity_profile(
            "CuSn6", ws_cfg=_ws_cfg("snippets"), ep_cfg=EP_CFG, schema=SCHEMA, scraped_content=pre))
    assert debug["web_cost"]["strategy"] == "precomputed"
    assert debug["web_cost"]["brave_queries"] == 0
    assert profile["_metadata"]["sources_count"] == 1
    assert debug["scraped_content"] == pre                    # round-trips intact


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run_all() else 0)
