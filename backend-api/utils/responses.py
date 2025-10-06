"""
Standardized API response utilities
"""
from typing import Any, Dict


def success_response(message: str, data: Any = None) -> Dict[str, Any]:
    """
    Create standardized success response

    Args:
        message: User-friendly success message
        data: Optional response payload

    Returns:
        Standardized response dict
    """
    response = {
        "status": "success",
        "message": message
    }

    if data is not None:
        response["data"] = data

    return response


def error_response(message: str, code: int = 500, details: Any = None) -> Dict[str, Any]:
    """
    Create standardized error response

    Args:
        message: User-friendly error message
        code: HTTP status code
        details: Optional error details for debugging

    Returns:
        Standardized error response dict
    """
    response = {
        "status": "error",
        "message": message,
        "code": code
    }

    if details is not None:
        response["details"] = details

    return response
