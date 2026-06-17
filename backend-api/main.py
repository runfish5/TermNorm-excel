"""
TermNorm Backend API - Minimal FastAPI Application
"""
from dotenv import load_dotenv

# Load .env file BEFORE importing modules that read environment variables
load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import logging

from config.settings import settings
from config.middleware import setup_middleware
from core.logging import setup_logging
from api import (
    system_router,
    research_router,
    experiments_router,
    pipeline_router,
)
from core.llm_providers import get_available_providers

# Setup logging
setup_logging(level="INFO", log_file="logs/app.log")
logger = logging.getLogger(__name__)


# Create FastAPI application
app = FastAPI(title=settings.api_title, description=settings.api_description)

# Custom HTTPException handler - standardize error format
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Convert HTTPException to the standardized error envelope.

    ``code`` is the **stable, machine-readable** error signal callers branch on
    (the PromptPotter client keys session-recovery on ``code == "no_session"``).
    A handler raising ``detail={"code": "<slug>", "message": "..."}`` sets a
    semantic code; a plain string ``detail`` falls back to the numeric HTTP status.
    Forwards ``exc.headers`` so a 429 keeps its ``Retry-After`` (RFC 7231 §7.1.3).

    A dict ``detail`` is ALSO preserved verbatim under ``detail`` in the envelope.
    The upstream-LLM-error raise-site (``core/llm_providers.py``) sets
    ``{upstream_provider, upstream_model, upstream_message, error_code, ...}``;
    PromptPotter's diagnostics extractor reads ``body["detail"]`` to surface what the
    provider actually rejected. Flattening to ``{status,message,code}`` dropped that
    dict and PP fell back to dumping raw body text — so the envelope now carries both
    the flat fields (for the ``no_session`` self-heal) and the full ``detail``.
    """
    detail = exc.detail
    content = {"status": "error", "message": "", "code": exc.status_code}
    if isinstance(detail, dict):
        content["detail"] = detail
        content["message"] = detail.get("message") or detail.get("upstream_message") or ""
        content["code"] = detail.get("code") or detail.get("error_code") or exc.status_code
    else:
        content["message"] = detail
    return JSONResponse(
        status_code=exc.status_code,
        content=content,
        headers=exc.headers,
    )

# Setup middleware
setup_middleware(app)


# Include routers - Streamlined API structure
app.include_router(system_router)      # Health checks, connection test, activity logging
app.include_router(research_router)    # /research-and-match pipeline (stateless)
app.include_router(experiments_router)  # Experiments/traces data endpoints
app.include_router(pipeline_router)    # Pipeline config + trace lifecycle


@app.on_event("startup")
async def startup_event():
    """Load cache, print the boot banner, warn on missing active-provider key."""
    # Default prompts (v1) live in logs/prompts/ — no runtime init needed.
    # Manual reinit: python -m utils.prompt_registry

    from services.match_database import load
    load()

    from core.banner import print_startup_banner
    print_startup_banner()

    available = get_available_providers()
    if not available:
        logger.warning(
            "No LLM provider API keys detected — LLM features will fail at first call. "
            "Copy backend-api/.env.example to backend-api/.env, uncomment one of the "
            "provider lines (GROQ_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / "
            "ANTHROPIC_API_KEY), paste your key, then restart. From the repo root:\n"
            "    cp backend-api/.env.example backend-api/.env\n"
            "    nano backend-api/.env"
        )
    else:
        logger.info("LLM providers available: %s", ", ".join(available))


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    logger.info("Shutting down TermNorm Backend API")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload
    )