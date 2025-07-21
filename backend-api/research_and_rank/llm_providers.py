"""Simple global LLM provider - one config for entire app"""

import os
import json
from typing import List, Dict, Optional, Literal, Union

# Global configuration - set once for entire application
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")
LLM_MODEL = os.getenv("LLM_MODEL", "meta-llama/llama-4-maverick-17b-128e-instruct")

async def llm_call(
    messages: List[Dict[str, str]], 
    max_tokens: int = 1000,
    system: Optional[str] = None,
    tools: Optional[List[Dict]] = None,
    stop_sequences: Optional[List[str]] = None,
    temperature: float = 0.7,
    output_format: Literal["text", "json", "schema"] = "text",
    schema: Optional[Dict] = None
) -> Union[str, Dict]:
    """Universal LLM function - uses global provider config"""
    
    if system:
        messages = [{"role": "system", "content": system}] + messages
    
    params = {
        "model": LLM_MODEL,
        "messages": messages, 
        "max_tokens": max_tokens,
        "temperature": temperature
    }
    if tools: params["tools"] = tools
    if stop_sequences: params["stop"] = stop_sequences
    
    # Handle structured output
    if output_format == "json" and LLM_PROVIDER in ["openai", "groq"]:
        params["response_format"] = {"type": "json_object"}
    elif output_format == "schema" and schema and LLM_PROVIDER in ["openai", "groq"]:
        params["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "response_schema", "schema": schema}
        }
    
    
    # Get API key based on provider
    if LLM_PROVIDER == "openai":
        from openai import AsyncOpenAI
        api_key = os.getenv("OPENAI_API_KEY")
        client = AsyncOpenAI(api_key=api_key)
        
    elif LLM_PROVIDER == "groq":
        from groq import AsyncGroq
        api_key = os.getenv("GROQ_API_KEY") 
        client = AsyncGroq(api_key=api_key)
        
    elif LLM_PROVIDER == "anthropic":
        import anthropic
        api_key = os.getenv("ANTHROPIC_API_KEY")
        client = anthropic.AsyncAnthropic(api_key=api_key)
        if system: 
            params["system"] = system
            params["messages"] = [m for m in messages if m["role"] != "system"]
    
    if not api_key:
        raise ValueError(f"API key not found for {LLM_PROVIDER}")
    
    response = await client.chat.completions.create(**params) if LLM_PROVIDER != "anthropic" else await client.messages.create(**params)
    content = response.choices[0].message.content if LLM_PROVIDER != "anthropic" else response.content[0].text
    
    # Parse JSON if needed
    if output_format in ["json", "schema"]:
        return json.loads(content)
    return content