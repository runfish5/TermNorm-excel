import os
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