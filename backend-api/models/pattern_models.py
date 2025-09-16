"""
Pydantic models for pattern analysis
"""
from pydantic import BaseModel
from typing import Dict, List, Tuple


class PatternRequest(BaseModel):
    """Model for pattern analysis requests"""
    dictionary: Dict[str, str]
    project_name: str


class RuleCluster(BaseModel):
    """Model for discovered rule clusters"""
    pattern: str
    description: str
    examples: List[Tuple[str, str]]
    confidence: float
    match_count: int


class PatternDiscoveryResult(BaseModel):
    """Model for pattern discovery results"""
    rule_clusters: List[RuleCluster]
    unmatched_pairs: List[Tuple[str, str]]
    coverage: float
    final_prompt: str
    failed_attempts: List[str]