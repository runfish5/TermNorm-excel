import os
import sys
from datetime import datetime
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
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

# Get API key from environment variable - no fallback for security
API_KEY = os.getenv("TERMNORM_API_KEY")
if not API_KEY:
    raise ValueError("TERMNORM_API_KEY environment variable must be set! Example: set TERMNORM_API_KEY=your_secret_key")

app = FastAPI(title="LLM Processing API", description=f"Uses {LLM_PROVIDER.upper()} ({LLM_MODEL}) for Excel Add-in processing")

def get_local_ip():
    """Get the local IP address of this machine"""
    import socket
    try:
        # Connect to a remote address to determine local IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"

def detect_server_mode():
    """Detect if server is running in network mode based on environment and common patterns"""
    # Check if uvicorn was started with --host 0.0.0.0 (common network binding)
    # This is a best-effort detection since we can't directly access uvicorn's bind config
    
    # Check environment variables that might indicate network mode
    host_env = os.getenv("UVICORN_HOST", "").lower()
    if host_env in ["0.0.0.0", "network"]:
        return True
    
    # Check if process arguments contain network indicators (rough heuristic)
    args_str = " ".join(sys.argv).lower()
    if "--host 0.0.0.0" in args_str or "--host=0.0.0.0" in args_str:
        return True
        
    return False

# API Key middleware
@app.middleware("http")
async def check_api_key(request: Request, call_next):
    # Protected endpoints that require API key
    protected_paths = ["/research-and-match", "/analyze-patterns", "/match-term"]
    
    # Check if this is a protected endpoint
    if any(request.url.path.startswith(path) for path in protected_paths):
        api_key = request.headers.get("X-API-Key")
        if not api_key or api_key != API_KEY:
            return JSONResponse(
                status_code=401,
                content={"error": "Invalid or missing API key", "message": "Please provide a valid X-API-Key header"}
            )
    
    response = await call_next(request)
    return response

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
    # Determine if server is running in network mode
    is_network_mode = detect_server_mode()
    
    if is_network_mode:
        # Server is network-accessible
        connection_type = "Network API"
        local_ip = get_local_ip()
        connection_url = f"http://{local_ip}:8000"
    else:
        # Server is local-only
        connection_type = "Local API"
        connection_url = "http://localhost:8000"
    
    return {
        "status": "OK", 
        "provider": LLM_PROVIDER,
        "connection_type": connection_type,
        "connection_url": connection_url
    }

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