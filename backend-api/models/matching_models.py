"""
Pydantic models for term matching
"""
from pydantic import BaseModel
from typing import List, Optional


class UpdateMatcherRequest(BaseModel):
    """Model for updating the token matcher"""
    terms: List[str]


class MatchRequest(BaseModel):
    """Model for term matching requests"""
    query: str


class ResearchAndMatchRequest(BaseModel):
    """Model for research and match requests"""
    query: str


class MatchResponse(BaseModel):
    """Model for match responses"""
    query: str
    matches: List[tuple]  # List of (candidate, score) tuples
    total_matches: int
    match_time: float
    research_performed: bool = False


class UpdateMatcherResponse(BaseModel):
    """Model for matcher update responses"""
    status: str
    setup_time: Optional[float] = None
    append_time: Optional[float] = None
    total_terms: Optional[int] = None
    unique_terms: Optional[int] = None
    total_unique_terms: Optional[int] = None
    duplicates_removed: Optional[int] = None