import os
import json
from datetime import datetime
from fastapi import FastAPI
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from pydantic import BaseModel, ConfigDict
from research_and_rank.llm_providers import LLM_PROVIDER, LLM_MODEL
from typing import Optional
# Import the endpoint routers
from llm_term_generator_api import router as llm_term_generator_api_router
from pattern_analyzer import router as pattern_analyzer_router
from research_and_rank.TokenLookupMatcher import router as token_matcher_router
from research_and_rank.research_and_rank_candidates import router as research_and_rank_candidates_router

load_dotenv()

app = FastAPI(title="LLM Processing API", description=f"Uses {LLM_PROVIDER.upper()} ({LLM_MODEL}) for Excel Add-in processing")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://localhost:3000", "http://127.0.0.1:8000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Include routers
app.include_router(llm_term_generator_api_router)
app.include_router(pattern_analyzer_router)
app.include_router(token_matcher_router)
app.include_router(research_and_rank_candidates_router)

@app.get("/")
def read_root():
    return {
        "status": "API running",
        "llm": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "endpoints": ["/match-term", "/research-and-match", "/quick-match", "/test-connection"]
    }

@app.post("/test-connection")
async def test_connection():
    return {"status": "OK", "provider": LLM_PROVIDER}

# Option 2: Allow extra fields (most flexible)
class ActivityLogEntry(BaseModel):
    model_config = ConfigDict(extra="allow")  # Allows any extra fields
    
    timestamp: Optional[str] = ""
    source: Optional[str] = ""
    target: Optional[str] = ""
    method: Optional[str] = ""
    confidence: Optional[float] = 0.0
    session_id: Optional[str] = ""

@app.post("/log-activity")
async def log_activity(entry: ActivityLogEntry):
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(entry.model_dump_json() + "\n")
    return {"status": "logged"}

class ConfigRequest(BaseModel):
    workbook: str

@app.post("/config")
async def get_config(request: ConfigRequest):
    """Get configuration for a specific workbook from cloud or local storage"""
    try:
        # Load config from file system for now
        # In production, this would query a cloud database or config service
        config_path = Path("../config/app.config.json")
        
        if not config_path.exists():
            return {"error": "Configuration not found"}, 404
            
        with open(config_path, "r", encoding="utf-8") as f:
            config_data = json.load(f)
        
        return config_data
    except Exception as e:
        return {"error": f"Failed to load config: {str(e)}"}, 500

class ConfigFromUrlRequest(BaseModel):
    workbook: str
    configUrl: str

@app.post("/config-from-url")
async def get_config_from_url(request: ConfigFromUrlRequest):
    """Get configuration from a user-provided cloud URL"""
    try:
        import urllib.parse
        
        # Validate the URL
        parsed_url = urllib.parse.urlparse(request.configUrl)
        if not parsed_url.scheme.startswith('http'):
            return {"error": "Invalid URL scheme. Must be http or https."}, 400
        
        # In production, this would:
        # 1. Validate the URL is from trusted domains (SharePoint/OneDrive)
        # 2. Handle authentication (OAuth tokens)
        # 3. Fetch the config file through Microsoft Graph API
        # 4. Cache the config for performance
        
        # For now, return a placeholder response with instructions
        return {
            "error": "Cloud config fetching not yet implemented",
            "message": "This endpoint will fetch configuration files from SharePoint/OneDrive URLs",
            "requestedUrl": request.configUrl,
            "workbook": request.workbook,
            "nextSteps": [
                "Implement Microsoft Graph API integration",
                "Add OAuth authentication for SharePoint/OneDrive",
                "Add URL validation for trusted domains",
                "Implement config file caching"
            ]
        }, 501
        
    except Exception as e:
        return {"error": f"Failed to process config URL: {str(e)}"}, 500

class CloudFileRequest(BaseModel):
    url: str

@app.post("/fetch-cloud-file") 
async def fetch_cloud_file(request: CloudFileRequest):
    """Proxy endpoint to fetch Excel files from cloud storage (SharePoint/OneDrive)"""
    try:
        # In production, this would:
        # 1. Validate the URL
        # 2. Handle authentication (OAuth tokens)
        # 3. Fetch the file through Microsoft Graph API
        # 4. Return the file content
        
        # For now, return an error message with instructions
        return {
            "error": "Cloud file fetching not yet implemented",
            "message": "Please implement Microsoft Graph API integration for production use",
            "url": request.url
        }, 501
        
    except Exception as e:
        return {"error": f"Failed to fetch cloud file: {str(e)}"}, 500