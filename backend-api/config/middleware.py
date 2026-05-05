"""
Middleware configuration for TermNorm Backend API
"""
import hmac
import logging
from fastapi import Request, FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .settings import settings
from core.user_manager import user_manager

logger = logging.getLogger(__name__)

_BEARER_PREFIX = "Bearer "


async def bearer_auth_middleware(request: Request, call_next):
    """Wire-level bearer-token check (opt-in via TERMNORM_REQUIRE_AUTH).

    Runs ahead of user_auth_middleware so an unauthenticated caller never
    reaches the IP-based check. Constant-time compare on the token.
    """
    if not settings.termnorm_require_auth:
        return await call_next(request)

    header = request.headers.get("Authorization", "")
    if not header.startswith(_BEARER_PREFIX):
        return JSONResponse(
            status_code=401,
            content={"status": "error", "message": "missing bearer token", "code": 401},
        )
    presented = header[len(_BEARER_PREFIX):]
    expected = settings.termnorm_token
    if not expected or not hmac.compare_digest(presented, expected):
        return JSONResponse(
            status_code=401,
            content={"status": "error", "message": "invalid bearer token", "code": 401},
        )
    return await call_next(request)


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
                    "status": "error",
                    "message": f"IP {client_ip} not authorized - check backend users.json",
                    "code": 403
                }
            )

        # Inject user context into request
        request.state.user_id = user_id
        logger.debug(f"[USER_AUTH] Request from user {user_id} (IP: {client_ip})")

    response = await call_next(request)
    return response


def setup_middleware(app: FastAPI) -> None:
    """Setup all middleware for the FastAPI application"""

    # FastAPI runs `app.middleware("http")` registrations in REVERSE
    # registration order. Register user_auth FIRST so that bearer_auth runs
    # FIRST at request time (outer → inner: bearer → user → handler).
    app.middleware("http")(user_auth_middleware)
    app.middleware("http")(bearer_auth_middleware)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"]
    )

    logger.info("Middleware setup completed")