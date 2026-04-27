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
    """Convert HTTPException to standardized error format.

    Forwards ``exc.headers`` so rate-limit responses carry their
    ``Retry-After`` header to the client (RFC 7231 §7.1.3).
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "message": exc.detail,
            "code": exc.status_code
        },
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
            "Set one of: GROQ_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY."
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