"""
TermNorm Backend API - Minimal FastAPI Application
"""
from dotenv import load_dotenv

# Load .env file BEFORE importing modules that read environment variables
load_dotenv()

from fastapi import FastAPI
import logging

from config import settings
from config.middleware import setup_middleware
from core.logging import setup_logging
from utils.exceptions import global_exception_handler
from routers import (
    health_router,
    llm_router,
    pattern_router,
    matching_router,
    research_router
)
from research_and_rank.llm_providers import LLM_PROVIDER, LLM_MODEL

# Setup logging
setup_logging(level="INFO", log_file="logs/app.log")
logger = logging.getLogger(__name__)

# Create FastAPI application
app = FastAPI(
    title=settings.api_title,
    description=f"{settings.api_description} - Uses {LLM_PROVIDER.upper()} ({LLM_MODEL})"
)

# Setup middleware
setup_middleware(app)

# Setup global exception handler
app.add_exception_handler(Exception, global_exception_handler)

# Include routers
app.include_router(health_router)
app.include_router(llm_router)
app.include_router(pattern_router)
app.include_router(matching_router)
app.include_router(research_router)


@app.on_event("startup")
async def startup_event():
    """Initialize application state on startup"""
    logger.info("Starting TermNorm Backend API")
    logger.info(f"Environment: {settings.environment_type}")
    logger.info(f"LLM Provider: {LLM_PROVIDER}/{LLM_MODEL}")

    # Initialize Groq client (if needed)
    try:
        from groq import AsyncGroq
        import os
        groq_api_key = os.getenv("GROQ_API_KEY")
        if groq_api_key:
            app.state.groq_client = AsyncGroq(api_key=groq_api_key)
            logger.info("Groq client initialized successfully")
        else:
            logger.warning("GROQ_API_KEY not found - LLM features will be disabled")
            app.state.groq_client = None
    except Exception as e:
        logger.error(f"Failed to initialize Groq client: {e}")
        app.state.groq_client = None

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