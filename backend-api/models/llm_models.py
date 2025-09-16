"""
Pydantic models for LLM term generation
"""
from pydantic import BaseModel
from typing import List, Optional


class InputData(BaseModel):
    """Model for LLM processing input data"""
    source_value: str
    project_name: str
    mapping_name: str
    standardization_prompt: Optional[str] = None


class OutputData(BaseModel):
    """Model for LLM processing output data"""
    mappedValue: str
    sourceValue: str


class TransformationGroup(BaseModel):
    """Model for transformation group patterns"""
    pattern: str
    description: str
    examples: List[str]


class PromptTestResponse(BaseModel):
    """Model for prompt test responses"""
    generated_prompt: str
    prompt_type: str
    source_value: str