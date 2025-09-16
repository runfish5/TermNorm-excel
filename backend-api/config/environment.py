"""
Environment detection and network utilities
"""
import socket
from typing import Tuple
from .settings import settings


def get_local_ip() -> str:
    """Get the local IP address of this machine"""
    try:
        # Connect to a remote address to determine local IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def get_connection_info() -> Tuple[str, str, str]:
    """
    Get connection information based on environment

    Returns:
        Tuple of (connection_type, connection_url, environment)
    """
    environment = settings.environment_type
    local_ip = get_local_ip()

    if environment == "cloud":
        connection_type = "Cloud API"
        connection_url = f"http://{local_ip}:8000"
    elif environment == "network":
        connection_type = "Network API"
        connection_url = f"http://{local_ip}:8000"
    else:
        connection_type = "Local API"
        connection_url = "http://localhost:8000"

    return connection_type, connection_url, environment


def get_environment_details() -> dict:
    """Get detailed environment information for debugging"""
    return {
        "environment_type": settings.environment_type,
        "is_cloud": settings.is_cloud_environment,
        "is_network": settings.is_network_mode,
        "local_ip": get_local_ip(),
        "cloud_indicators": {
            "azure": bool(settings.azure_site_name or settings.azure_resource_group),
            "aws": bool(settings.aws_lambda_function or settings.aws_execution_env),
            "google": bool(settings.google_cloud_project or settings.google_app_engine),
            "generic": bool(settings.cloud_provider or settings.kubernetes_host),
        }
    }