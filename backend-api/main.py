"""
TermNorm Backend API - Minimal FastAPI Application
"""
from dotenv import load_dotenv

# Load .env file BEFORE importing modules that read environment variables
load_dotenv()

from fastapi import FastAPI
import logging
import asyncio
from datetime import datetime, time as dt_time
from contextlib import asynccontextmanager

from config import settings
from config.middleware import setup_middleware
from core.logging import setup_logging
from api import (
    system_router,
    matcher_router,
    research_router
)
from core.llm_providers import LLM_PROVIDER, LLM_MODEL
from core.user_manager import cleanup_all_sessions

# Setup logging
setup_logging(level="INFO", log_file="logs/app.log")
logger = logging.getLogger(__name__)


async def midnight_cleanup_task():
    """Background task that runs session cleanup at midnight"""
    while True:
        # Calculate seconds until next midnight
        now = datetime.now()
        midnight = datetime.combine(now.date(), dt_time(0, 0))

        # If past midnight today, calculate for tomorrow
        if now.time() >= dt_time(0, 0):
            from datetime import timedelta
            midnight = midnight + timedelta(days=1)

        seconds_until_midnight = (midnight - now).total_seconds()

        logger.info(f"Next cleanup scheduled in {seconds_until_midnight/3600:.1f} hours at {midnight}")

        # Sleep until midnight
        await asyncio.sleep(seconds_until_midnight)

        # Run cleanup
        try:
            session_count = cleanup_all_sessions()
            logger.info(f"Midnight cleanup completed: {session_count} sessions cleared")
        except Exception as e:
            logger.error(f"Midnight cleanup failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown tasks"""
    # Startup
    logger.info("Starting background cleanup task")
    cleanup_task = asyncio.create_task(midnight_cleanup_task())

    yield

    # Shutdown
    cleanup_task.cancel()
    logger.info("Background cleanup task cancelled")


# Create FastAPI application with lifespan
app = FastAPI(
    title=settings.api_title,
    description=f"{settings.api_description} - Uses {LLM_PROVIDER.upper()} ({LLM_MODEL})",
    lifespan=lifespan
)

# Setup middleware
setup_middleware(app)


# Include routers - Streamlined API structure
app.include_router(system_router)      # Health checks, connection test, activity logging
app.include_router(matcher_router)     # /update-matcher endpoint
app.include_router(research_router)    # /research-and-match pipeline


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