"""
Shared exception handling utilities for FastAPI endpoints
"""
from fastapi import HTTPException
from pydantic import BaseModel
import traceback
import logging
from typing import Optional, Any, Union
from functools import wraps

# Response models
class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    error_type: str
    details: Optional[str] = None

class SuccessResponse(BaseModel):
    success: bool = True
    data: Any

# Union type for endpoints that can return either success or error
ApiResponse = Union[SuccessResponse, ErrorResponse]

# Generic exception handler decorator
def handle_exceptions(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            result = await func(*args, **kwargs)
            return SuccessResponse(data=result)
        except HTTPException:
            raise  # Re-raise HTTP exceptions as-is
        except Exception as e:
            # Log the full traceback for debugging
            logging.error(f"Error in {func.__name__}: {str(e)}", exc_info=True)
            
            # Return structured error response
            return ErrorResponse(
                error=str(e),
                error_type=type(e).__name__,
                details=traceback.format_exc() if logging.getLogger().level <= logging.DEBUG else None
            )
    return wrapper