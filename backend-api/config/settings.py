"""
Centralized configuration management for TermNorm Backend API
"""
import os
import sys
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Centralized application settings using Pydantic"""

    # API Configuration
    api_title: str = "LLM Processing API"
    api_description: str = "TermNorm Excel Add-in Backend API"

    # LLM Configuration (allow extra fields from .env)
    llm_provider: Optional[str] = Field(None, alias="LLM_PROVIDER")
    llm_model: Optional[str] = Field(None, alias="LLM_MODEL")
    groq_api_key: Optional[str] = Field(None, alias="GROQ_API_KEY")
    openai_api_key: Optional[str] = Field(None, alias="OPENAI_API_KEY")

    # Search API Configuration
    brave_search_api_key: Optional[str] = Field(None, alias="BRAVE_SEARCH_API_KEY")
    use_brave_api: bool = Field(True, alias="USE_BRAVE_API")  # Toggle for testing fallbacks
    use_web_search: bool = Field(True, alias="USE_WEB_SEARCH")  # Toggle to disable all web search engines

    # Server Configuration
    host: str = "127.0.0.1"
    port: int = 8000
    reload: bool = False

    # CORS Configuration
    cors_origins: List[str] = [
        "https://localhost:3000",
        "http://127.0.0.1:8000",
        "*"
    ]

    # Protected Endpoints (require user authentication)
    # Note: "/" (root health check) is intentionally public
    protected_paths: List[str] = [
        "/session/init-terms",
        "/research-and-match",
        "/test-connection",
        "/log-activity",
        "/log-match",
        "/analyze-patterns",
        "/match-term",
        "/batch/start",
        "/batch/complete",
        "/direct-prompt",
        "/batch-process-single",
    ]

    # Cloud Environment Detection
    # Azure
    azure_site_name: Optional[str] = Field(None, alias="WEBSITE_SITE_NAME")
    azure_resource_group: Optional[str] = Field(None, alias="WEBSITE_RESOURCE_GROUP")

    # AWS
    aws_lambda_function: Optional[str] = Field(None, alias="AWS_LAMBDA_FUNCTION_NAME")
    aws_execution_env: Optional[str] = Field(None, alias="AWS_EXECUTION_ENV")

    # Google Cloud
    google_cloud_project: Optional[str] = Field(None, alias="GOOGLE_CLOUD_PROJECT")
    google_app_engine: Optional[str] = Field(None, alias="GAE_APPLICATION")

    # Generic Cloud
    cloud_provider: Optional[str] = Field(None, alias="CLOUD_PROVIDER")
    kubernetes_host: Optional[str] = Field(None, alias="KUBERNETES_SERVICE_HOST")

    # Network Configuration
    uvicorn_host: Optional[str] = Field(None, alias="UVICORN_HOST")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Ignore extra fields from environment

    @property
    def is_cloud_environment(self) -> bool:
        """Detect if running in cloud environment"""
        return any([
            self.azure_site_name,
            self.azure_resource_group,
            self.aws_lambda_function,
            self.aws_execution_env,
            self.google_cloud_project,
            self.google_app_engine,
            self.cloud_provider,
            self.kubernetes_host
        ])

    @property
    def is_network_mode(self) -> bool:
        """Detect if running in network mode"""
        if self.uvicorn_host and self.uvicorn_host.lower() in ["0.0.0.0", "network"]:
            return True

        # Check process arguments
        args_str = " ".join(sys.argv).lower()
        return "--host 0.0.0.0" in args_str or "--host=0.0.0.0" in args_str

    @property
    def environment_type(self) -> str:
        """Get environment type: cloud, network, or local"""
        if self.is_cloud_environment:
            return "cloud"
        elif self.is_network_mode:
            return "network"
        return "local"

    def validate_required_settings(self) -> None:
        """Validate that required settings are present"""
        # API key is now optional - will be validated at runtime when needed
        pass


# Global settings instance
settings = Settings()

# Validate on import
settings.validate_required_settings()