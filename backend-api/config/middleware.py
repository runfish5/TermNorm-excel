"""
Middleware configuration for TermNorm Backend API
"""
import logging
from fastapi import Request, FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .settings import settings

logger = logging.getLogger(__name__)


async def api_key_middleware(request: Request, call_next):
    """API Key authentication middleware"""
    # Check if this is a protected endpoint
    if any(request.url.path.startswith(path) for path in settings.protected_paths):
        api_key = request.headers.get("X-API-Key")
        logger.info(f"[API_KEY_CHECK] Path: {request.url.path}, API Key provided: {'Yes' if api_key else 'No'}")

        if not api_key or (settings.api_key and api_key != settings.api_key):
            logger.warning(f"[API_KEY_CHECK] Rejecting request - API key invalid")
            return JSONResponse(
                status_code=401,
                content={
                    "error": "Invalid or missing API key",
                    "message": "Please provide a valid X-API-Key header"
                }
            )

        logger.info(f"[API_KEY_CHECK] API key valid, proceeding")

    response = await call_next(request)
    return response


def setup_middleware(app: FastAPI) -> None:
    """Setup all middleware for the FastAPI application"""

    # API Key middleware
    app.middleware("http")(api_key_middleware)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"]
    )

    logger.info("Middleware setup completed")