"""
Enhanced exception handling utilities for FastAPI endpoints
"""
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import traceback
import logging
from typing import Optional, Any, Union, Dict
from functools import wraps
from enum import Enum

logger = logging.getLogger(__name__)


class ErrorCode(str, Enum):
    """Standardized error codes"""
    # General errors
    INTERNAL_ERROR = "INTERNAL_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"

    # Service-specific errors
    LLM_ERROR = "LLM_ERROR"
    MATCHER_NOT_INITIALIZED = "MATCHER_NOT_INITIALIZED"
    PATTERN_ANALYSIS_ERROR = "PATTERN_ANALYSIS_ERROR"
    CLIENT_DISCONNECTED = "CLIENT_DISCONNECTED"


class ErrorResponse(BaseModel):
    """Enhanced error response model"""
    success: bool = False
    error_code: str
    error_message: str
    error_type: str
    details: Optional[Dict[str, Any]] = None
    traceback: Optional[str] = None


class SuccessResponse(BaseModel):
    """Success response model"""
    success: bool = True
    data: Any


# Union type for endpoints that can return either success or error
ApiResponse = Union[SuccessResponse, ErrorResponse]


class ServiceError(Exception):
    """Base exception for service-level errors"""

    def __init__(
        self,
        message: str,
        error_code: ErrorCode = ErrorCode.INTERNAL_ERROR,
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.error_code = error_code
        self.details = details or {}
        super().__init__(message)


class LLMError(ServiceError):
    """LLM processing specific error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, ErrorCode.LLM_ERROR, details)


class MatcherError(ServiceError):
    """Matcher service specific error"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, ErrorCode.MATCHER_NOT_INITIALIZED, details)


# Enhanced exception handler decorator
def handle_exceptions(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            result = await func(*args, **kwargs)
            return SuccessResponse(data=result)
        except HTTPException:
            # Re-raise HTTP exceptions as-is to preserve status codes
            raise
        except ServiceError as e:
            # Handle our custom service errors
            logger.error(f"Service error in {func.__name__}: {e.message}", exc_info=True)
            return ErrorResponse(
                error_code=e.error_code.value,
                error_message=e.message,
                error_type=type(e).__name__,
                details=e.details,
                traceback=traceback.format_exc() if logger.level <= logging.DEBUG else None
            )
        except Exception as e:
            # Handle unexpected errors
            logger.error(f"Unexpected error in {func.__name__}: {str(e)}", exc_info=True)
            return ErrorResponse(
                error_code=ErrorCode.INTERNAL_ERROR.value,
                error_message=str(e),
                error_type=type(e).__name__,
                traceback=traceback.format_exc() if logger.level <= logging.DEBUG else None
            )
    return wrapper


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Global exception handler for unhandled errors"""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)

    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error_code": "HTTP_ERROR",
                "error_message": exc.detail,
                "error_type": "HTTPException"
            }
        )

    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error_code": ErrorCode.INTERNAL_ERROR.value,
            "error_message": "An unexpected error occurred",
            "error_type": type(exc).__name__,
            "traceback": traceback.format_exc() if logger.level <= logging.DEBUG else None
        }
    )