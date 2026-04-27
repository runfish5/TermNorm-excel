"""
Centralized configuration management for TermNorm Backend API
"""
import os
import sys
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Centralized application settings using Pydantic"""

    # API Configuration
    api_title: str = "LLM Processing API"
    api_description: str = "TermNorm Excel Add-in Backend API"

    # LLM API keys. Provider + model are per-node in pipeline.json
    # (overridable per request via node_config) — no env-var defaults.
    groq_api_key: str | None = Field(None, alias="GROQ_API_KEY")
    openai_api_key: str | None = Field(None, alias="OPENAI_API_KEY")
    openrouter_api_key: str | None = Field(None, alias="OPENROUTER_API_KEY")
    anthropic_api_key: str | None = Field(None, alias="ANTHROPIC_API_KEY")

    # Search API Configuration
    brave_search_api_key: str | None = Field(None, alias="BRAVE_SEARCH_API_KEY")
    use_brave_api: bool = Field(True, alias="USE_BRAVE_API")  # Toggle for testing fallbacks

    # Server Configuration
    host: str = "127.0.0.1"
    port: int = 8000
    reload: bool = False

    # CORS Configuration
    cors_origins: list[str] = [
        "https://localhost:3000",
        "http://127.0.0.1:8000",
        "*"
    ]

    # Protected Endpoints (require user authentication)
    # Note: /health is intentionally public
    protected_paths: list[str] = [
        "/sessions",
        "/matches",
        "/activities",
        "/batches",
        "/prompts",
        "/settings",
        "/history",
        "/cache",
    ]

    # Cloud Environment Detection (one sentinel per major provider)
    azure_site_name: str | None = Field(None, alias="WEBSITE_SITE_NAME")
    aws_lambda_function: str | None = Field(None, alias="AWS_LAMBDA_FUNCTION_NAME")
    google_cloud_project: str | None = Field(None, alias="GOOGLE_CLOUD_PROJECT")

    # Network Configuration
    uvicorn_host: str | None = Field(None, alias="UVICORN_HOST")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Ignore extra fields from environment

    @property
    def is_cloud_environment(self) -> bool:
        """Detect if running in cloud environment"""
        return bool(self.azure_site_name or self.aws_lambda_function or self.google_cloud_project)

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



# Global settings instance
settings = Settings()