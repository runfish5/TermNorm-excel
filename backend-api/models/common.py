"""
Common Pydantic models used across the application
"""
from pydantic import BaseModel, ConfigDict
from typing import Optional


class ActivityLogEntry(BaseModel):
    """Model for activity log entries"""
    model_config = ConfigDict(extra="allow")

    timestamp: Optional[str] = ""
    source: Optional[str] = ""
    target: Optional[str] = ""
    method: Optional[str] = ""
    confidence: Optional[float] = 0.0
    session_id: Optional[str] = ""


class HealthResponse(BaseModel):
    """Model for health check responses"""
    status: str
    llm: Optional[str] = None
    endpoints: Optional[list] = None


class ConnectionTestResponse(BaseModel):
    """Model for connection test responses"""
    status: str
    provider: Optional[str] = None
    connection_type: str
    connection_url: str
    environment: str