import os
from datetime import datetime
from fastapi import FastAPI
from groq import AsyncGroq
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from pydantic import BaseModel

# Import the endpoint routers
from llm_term_generator_api import router as llm_term_generator_api_router
from pattern_analyzer import router as pattern_analyzer_router
from research_and_rank.TokenLookupMatcher import router as token_matcher_router
from research_and_rank.research_and_rank_candidates import router as research_and_rank_candidates_router

load_dotenv()

import logging

logging.basicConfig(
    level=logging.INFO,  # Change to DEBUG to include traceback details in responses
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Create the FastAPI app instance
app = FastAPI(
    title="Groq Processing API",
    description="An API that uses Groq to process text input from an Excel Add-in with research and matching capabilities.",
)

# CORS Middleware configuration
origins = [
    "https://localhost:3000",  # The default origin for Office Add-in local development
    "http://127.0.0.1:8000",   # The origin of your API itself
    "*"                       # A wildcard for initial testing (can be removed later)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (GET, POST, etc.)
    allow_headers=["*"],  # Allows all headers
)

# Global Groq client initialization
api_key = os.getenv("GROQ_API_KEY")
groq_client = AsyncGroq(api_key=api_key) if api_key else None

# Make groq_client available to other modules
app.state.groq_client = groq_client

# Include the routers
app.include_router(llm_term_generator_api_router)
app.include_router(pattern_analyzer_router)
app.include_router(token_matcher_router)
app.include_router(research_and_rank_candidates_router)  # New router for research functionality

# Shared test endpoints
@app.post("/test-connection")
async def test_connection():
    """Simple test endpoint to verify backend connectivity"""
    return {"status": "Backend is working", "timestamp": str(datetime.now())}

@app.get("/")
def read_root():
    return {
        "status": "API is running", 
        "endpoints": [
            "/", 
            "/llm-generate-normalized-term", 
            "/analyze-patterns", 
            "/test-connection", 
            "/setup-matcher", 
            "/match-term",           # Simple token matching
            "/research-and-match",   # Full research + ranking
            "/quick-match"           # Alias for match-term
        ],
        "endpoint_descriptions": {
            "/match-term": "Fast token-based matching without web research",
            "/research-and-match": "Comprehensive research + LLM ranking (slower but more accurate)",
            "/quick-match": "Alias for /match-term"
        },
        "research_and_match_features": {
            "web_research": "Enabled with Groq API",
            "token_matching": "High-speed term matching",
            "profile_formatting": "LLM-powered result formatting"
        }
    }

# Add this model
class ActivityLogEntry(BaseModel):
    timestamp: str
    source: str
    target: str
    method: str
    confidence: float
    session_id: str

# Add this endpoint
@app.post("/log-activity")
async def log_activity(entry: ActivityLogEntry):
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(entry.model_dump_json() + "\n")
    return {"status": "logged"}