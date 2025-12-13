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
