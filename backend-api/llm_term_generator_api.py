# text_processor.py
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

router = APIRouter()

class InputData(BaseModel):
    source_value: str
    project_name: str
    mapping_name: str
    standardization_prompt: Optional[str] = None  # Add optional standardization_prompt

class OutputData(BaseModel):
    mappedValue: str
    sourceValue: str

class TransformationGroup(BaseModel):
    pattern: str
    description: str
    examples: List[str]

def format_examples(examples: List[str]) -> str:
    """Format examples for display in the prompt"""
    if not examples:
        return "No examples available"
    return ", ".join(f'"{ex}"' for ex in examples)

def build_deterministic_prompt(input_data: InputData, transformation_groups: List[TransformationGroup]) -> str:
    """Build a deterministic prompt according to the specified template"""
    
    # Build candidates section
    candidates_section = ""
    for i, group in enumerate(transformation_groups, 1):
        # Limit examples to first 3
        limited_examples = group.examples[:3] if group.examples else []
        formatted_examples = format_examples(limited_examples)
        
        candidates_section += f'''{i}. "pattern": "{group.pattern}"
"description": "{group.description}"
"few examples": {formatted_examples}
'''
        if i < len(transformation_groups):
            candidates_section += "\n"
    
    # Build the complete prompt
    prompt = f'''Your role is to identify which transformation group the current term ({input_data.source_value}) matches best. Your match should take into account all the information about the groups provided.

Here are the candidates:

{candidates_section}'''
    
    return prompt

def build_standardization_prompt(input_data: InputData, standardization_prompt: str) -> str:
    """Build prompt using the provided standardization_prompt"""
    
    # Replace placeholder with actual source value if needed
    # You can customize this logic based on how your standardization_prompt is structured
    if "{source_value}" in standardization_prompt:
        return standardization_prompt.replace("{source_value}", input_data.source_value)
    else:
        # If no placeholder, append the source value to the prompt
        return f"{standardization_prompt}\n\nProcess this value: {input_data.source_value}"

async def process_with_groq(groq_client, input_data: InputData, prompt: str):
    """Process input using the provided prompt"""
    
    chat_completion = await groq_client.chat.completions.create(
        messages=[
            {
                "role": "system",
                "content": f"Data processor for project '{input_data.project_name}' mapping '{input_data.mapping_name}'. Follow the instructions provided in the user prompt."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        model="meta-llama/llama-4-maverick-17b-128e-instruct",
    )
    return chat_completion.choices[0].message.content

@router.post("/llm-generate-normalized-term", response_model=OutputData)
async def process_value_with_groq(input_data: InputData, request: Request):
    groq_client = request.app.state.groq_client
    
    if not groq_client:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not found")
    
    try:
        # Check if standardization_prompt is provided
        if input_data.standardization_prompt:
            # Use the provided standardization prompt
            prompt = build_standardization_prompt(input_data, input_data.standardization_prompt)
        else:
            # Fall back to the original transformation groups approach
            transformation_groups = [
                TransformationGroup(
                    pattern="snake_case_identifier",
                    description="Convert text to lowercase with underscores replacing spaces and special characters",
                    examples=["hello_world", "user_name", "data_processing"]
                ),
                TransformationGroup(
                    pattern="camelCase_identifier", 
                    description="Convert text to camelCase format with first letter lowercase",
                    examples=["helloWorld", "userName", "dataProcessing"]
                ),
                # Add more transformation groups as needed
            ]
            prompt = build_deterministic_prompt(input_data, transformation_groups)
        
        mapped_value = await process_with_groq(groq_client, input_data, prompt)
        if not mapped_value:
            raise HTTPException(status_code=500, detail="LLM returned empty response")
        
        return OutputData(mappedValue=mapped_value.strip(), sourceValue=input_data.source_value)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

# Optional: Add an endpoint to test the prompt generation
@router.post("/test-prompt")
async def test_prompt_generation(input_data: InputData):
    """Test endpoint to see the generated prompt"""
    
    if input_data.standardization_prompt:
        prompt = build_standardization_prompt(input_data, input_data.standardization_prompt)
        prompt_type = "standardization_prompt"
    else:
        transformation_groups = [
            TransformationGroup(
                pattern="snake_case_identifier",
                description="Convert text to lowercase with underscores replacing spaces and special characters", 
                examples=["hello_world", "user_name", "data_processing"]
            ),
            TransformationGroup(
                pattern="camelCase_identifier",
                description="Convert text to camelCase format with first letter lowercase",
                examples=["helloWorld", "userName", "dataProcessing"]
            ),
        ]
        prompt = build_deterministic_prompt(input_data, transformation_groups)
        prompt_type = "transformation_groups"
    
    return {
        "generated_prompt": prompt,
        "prompt_type": prompt_type,
        "source_value": input_data.source_value
    }