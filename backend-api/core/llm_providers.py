"""Simple global LLM provider - one config for entire app"""

import os
import json
import asyncio
from typing import List, Dict, Optional, Literal, Union
from fastapi import HTTPException

# Global configuration - set once for entire application
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")
LLM_MODEL = os.getenv("LLM_MODEL", "meta-llama/llama-4-maverick-17b-128e-instruct")


def get_available_providers() -> List[str]:
    """Return list of providers with configured API keys"""
    providers = []
    if os.getenv("GROQ_API_KEY"):
        providers.append("groq")
    if os.getenv("OPENAI_API_KEY"):
        providers.append("openai")
    if os.getenv("ANTHROPIC_API_KEY"):
        providers.append("anthropic")
    return providers

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

    # Request validation - prevent guaranteed failures
    total_tokens = sum(len(m.get('content', '').split()) for m in messages) * 1.3
    if total_tokens > 100000:
        raise HTTPException(400, "Request exceeds token limit")

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
    
    
    # Get API key and create client based on provider
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
    else:
        raise ValueError(f"Unknown provider: {LLM_PROVIDER}")

    if not api_key:
        raise ValueError(f"API key not found for {LLM_PROVIDER}")

    # Retry logic with exponential backoff (3 attempts)
    for attempt in range(3):
        try:
            # Anthropic uses different API structure
            if LLM_PROVIDER == "anthropic":
                anthropic_params = {
                    "model": LLM_MODEL,
                    "messages": [m for m in messages if m["role"] != "system"],
                    "max_tokens": max_tokens,
                    "temperature": temperature
                }
                if system:
                    anthropic_params["system"] = system
                response = await asyncio.wait_for(client.messages.create(**anthropic_params), timeout=60)
                content = response.content[0].text if response.content else ""
            else:
                # OpenAI/Groq use same API
                response = await asyncio.wait_for(client.chat.completions.create(**params), timeout=60)
                content = response.choices[0].message.content if response.choices else ""

            # Parse JSON if needed
            if output_format in ["json", "schema"]:
                return json.loads(content)
            return content

        except asyncio.TimeoutError:
            if attempt == 2:
                raise HTTPException(503, "LLM request timeout")
            await asyncio.sleep(2 ** attempt)
        except Exception as e:
            if attempt == 2:
                raise HTTPException(503, f"LLM error: {str(e)}")
            await asyncio.sleep(2 ** attempt)