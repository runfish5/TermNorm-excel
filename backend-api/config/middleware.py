"""
Middleware configuration for TermNorm Backend API
"""
import logging
from fastapi import Request, FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .settings import settings
from core.user_manager import user_manager

logger = logging.getLogger(__name__)


async def user_auth_middleware(request: Request, call_next):
    """User authentication middleware - authenticate by IP"""
    # Check if this is a protected endpoint
    if any(request.url.path.startswith(path) for path in settings.protected_paths):
        client_ip = request.client.host
        user_id = user_manager.authenticate(client_ip)

        if not user_id:
            logger.warning(f"[USER_AUTH] IP {client_ip} not authorized")
            return JSONResponse(
                status_code=403,
                content={
                    "error": "Forbidden",
                    "message": f"IP {client_ip} not authorized. Contact admin."
                }
            )

        # Inject user context into request
        request.state.user_id = user_id
        logger.info(f"[USER_AUTH] Request from user {user_id} (IP: {client_ip})")

    response = await call_next(request)
    return response


def setup_middleware(app: FastAPI) -> None:
    """Setup all middleware for the FastAPI application"""

    # User authentication middleware
    app.middleware("http")(user_auth_middleware)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"]
    )

    logger.info("Middleware setup completed")