"""
TermNorm Backend API - Minimal FastAPI Application
"""
from dotenv import load_dotenv

# Load .env file BEFORE importing modules that read environment variables
load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import logging

from config import settings
from config.middleware import setup_middleware
from core.logging import setup_logging
from api import (
    system_router,
    research_router
)
from core.llm_providers import LLM_PROVIDER, LLM_MODEL

# Setup logging
setup_logging(level="INFO", log_file="logs/app.log")
logger = logging.getLogger(__name__)


# Create FastAPI application
app = FastAPI(
    title=settings.api_title,
    description=f"{settings.api_description} - Uses {LLM_PROVIDER.upper()} ({LLM_MODEL})"
)

# Custom HTTPException handler - standardize error format
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Convert HTTPException to standardized error format"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "message": exc.detail,
            "code": exc.status_code
        }
    )

# Setup middleware
setup_middleware(app)


# Include routers - Streamlined API structure
app.include_router(system_router)      # Health checks, connection test, activity logging
app.include_router(research_router)    # /research-and-match pipeline (stateless)


@app.on_event("startup")
async def startup_event():
    """Log startup information"""
    logger.info("Starting TermNorm Backend API")
    logger.info(f"Environment: {settings.environment_type}")
    logger.info(f"LLM Provider: {LLM_PROVIDER}/{LLM_MODEL}")

    # Verify LLM API key is configured
    import os
    api_key = os.getenv(f"{LLM_PROVIDER.upper()}_API_KEY")
    if api_key:
        logger.info(f"{LLM_PROVIDER.upper()} API key configured")
    else:
        logger.warning(f"{LLM_PROVIDER.upper()}_API_KEY not found - LLM features will be disabled")

    logger.info("TermNorm Backend API startup complete")


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