# pattern_analyzer.py
import re
import asyncio
from typing import Dict, List, Optional, Tuple, Set
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from collections import defaultdict
import json

# Terminal colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
MAGENTA = '\033[35m'
RED = '\033[31m'
BLUE = '\033[34m'
RESET = '\033[0m'

router = APIRouter()

class PatternRequest(BaseModel):
    dictionary: Dict[str, str]
    project_name: str

class RuleCluster(BaseModel):
    pattern: str
    description: str
    examples: List[Tuple[str, str]]
    confidence: float
    match_count: int

class PatternDiscoveryResult(BaseModel):
    rule_clusters: List[RuleCluster]
    unmatched_pairs: List[Tuple[str, str]]
    coverage: float
    final_prompt: str
    failed_attempts: List[str]

class PatternMemory:
    """Track failed patterns to avoid repetition"""
    def __init__(self):
        self.failed_patterns: Set[str] = set()
        self.successful_patterns: Set[str] = set()
        self.attempt_count = 0
        self.consecutive_failures = 0
        
    def add_failure(self, pattern: str):
        self.failed_patterns.add(pattern)
        self.consecutive_failures += 1
        
    def add_success(self, pattern: str):
        self.successful_patterns.add(pattern)
        self.consecutive_failures = 0
        
    def should_continue(self) -> bool:
        # Stop if too many consecutive failures
        return self.consecutive_failures < 5 and self.attempt_count < 20
        
    def increment_attempts(self):
        self.attempt_count += 1

async def check_client_disconnected(request: Request) -> bool:
    """Check if the client has disconnected"""
    try:
        # This will raise an exception if client disconnected
        await request.is_disconnected()
        return await request.is_disconnected()
    except Exception:
        return True

async def extract_pattern_with_llm(
    pairs: List[Tuple[str, str]], 
    project_name: str, 
    groq_client, 
    iteration: int,
    memory: PatternMemory,
    previous_clusters: List[RuleCluster],
    request: Request
) -> Optional[Tuple[str, str]]:
    """Extract regex pattern and description using LLM analysis with strategic hints"""
    pairs_count = len(pairs)
    print(f"\n{GREEN}ITERATION {iteration} - ANALYSIS:{RESET} Starting with {CYAN}[{pairs_count}]{RESET} remaining pairs")
    
    # Check if client disconnected before starting expensive operation
    if await check_client_disconnected(request):
        print(f"{RED}CLIENT DISCONNECTED:{RESET} Aborting pattern extraction at iteration {iteration}")
        raise HTTPException(status_code=499, detail="Client disconnected")
    
    if pairs_count == 0:
        return None
    
    # Format pairs for analysis - show more examples for better pattern detection
    sample_size = min(30, pairs_count)  # Show up to 30 examples
    pairs_text = "\n".join([f"'{src}' -> '{tgt}'" for src, tgt in pairs[:sample_size]])
    
    # Build hints based on what patterns might remain
    hints = []
    
    # Generic hints that guide without being too specific
    hints.append("- Look for patterns involving position markers or location codes (2-3 characters)")
    hints.append("- Some items might have their category separated from specifications")
    hints.append("- Watch for version numbers or edition markers (could use roman numerals)")
    hints.append("- Some entries might contain percentage or composition information")
    hints.append("- Complex names might have multiple components in a specific order")
    
    # Add info about previously found patterns to avoid duplication
    if previous_clusters:
        hints.append(f"\nAlready found {len(previous_clusters)} patterns:")
        for cluster in previous_clusters:
            hints.append(f"  - {cluster.description}")
    
    # Add failed patterns info
    if memory.failed_patterns:
        hints.append(f"\nFailed patterns to avoid: {', '.join(list(memory.failed_patterns)[:5])}")
    
    hints_text = "\n".join(hints)
    
    system_prompt = (
        f"You are a regex pattern expert analyzing data transformation patterns for project '{project_name}'. "
        "Your task is to identify ONE SPECIFIC transformation pattern that applies to a subset of the remaining data. "
        "Be specific - avoid overly broad patterns. Focus on structural transformations."
    )
    
    user_prompt = (
        f"Analyze these {pairs_count} source->target mapping pairs and identify ONE SPECIFIC transformation pattern.\n"
        f"Showing {sample_size} examples:\n\n"
        f"{pairs_text}\n\n"
        f"Pattern Discovery Hints:\n{hints_text}\n\n"
        "Requirements:\n"
        "1. Find a SPECIFIC pattern that matches at least 3 examples\n"
        "2. The pattern should represent a clear transformation rule\n"
        "3. Avoid overly broad patterns that match everything\n"
        "4. Focus on structural elements like delimiters, suffixes, prefixes, or specific formats\n\n"
        "Return your response in EXACTLY this format:\n"
        "PATTERN: <regex_pattern>\n"
        "DESCRIPTION: <brief description of what transformation this pattern represents>\n"
        "EXPECTED_MATCHES: <estimated number of pairs this pattern should match>\n\n"
        "If no clear pattern exists, return:\n"
        "PATTERN: NO_PATTERN_FOUND\n"
        "DESCRIPTION: No consistent pattern detected\n"
        "EXPECTED_MATCHES: 0"
    )
    
    try:
        # Check for disconnection before making expensive LLM call
        if await check_client_disconnected(request):
            print(f"{RED}CLIENT DISCONNECTED:{RESET} Aborting before LLM call")
            raise HTTPException(status_code=499, detail="Client disconnected")
        
        print(f"{YELLOW}CALLING LLM:{RESET} Analyzing {pairs_count} pairs...")
        
        # Make the LLM call - this is the expensive operation
        response = await groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            model="meta-llama/llama-4-maverick-17b-128e-instruct",
            temperature=0.3
        )
        
        # Check for disconnection after LLM call
        if await check_client_disconnected(request):
            print(f"{RED}CLIENT DISCONNECTED:{RESET} Aborting after LLM call")
            raise HTTPException(status_code=499, detail="Client disconnected")
        
        content = response.choices[0].message.content.strip()
        print(f"{YELLOW}LLM_RESPONSE:{RESET}\n{content}")
        
        # Parse the response
        pattern_match = re.search(r'PATTERN:\s*(.+)', content)
        desc_match = re.search(r'DESCRIPTION:\s*(.+)', content)
        expected_match = re.search(r'EXPECTED_MATCHES:\s*(\d+)', content)
        
        if pattern_match and desc_match:
            pattern = pattern_match.group(1).strip()
            description = desc_match.group(1).strip()
            expected = int(expected_match.group(1)) if expected_match else 0
            
            if pattern == "NO_PATTERN_FOUND":
                return None
                
            print(f"{BLUE}PATTERN:{RESET} {pattern}")
            print(f"{BLUE}EXPECTED MATCHES:{RESET} {expected}")
            
            return (pattern, description)
        else:
            print(f"{RED}ERROR:{RESET} Could not parse LLM response format")
            return None
        
    except HTTPException:
        # Re-raise HTTP exceptions (like client disconnect)
        raise
    except Exception as e:
        print(f"{RED}ERROR:{RESET} LLM analysis failed - {e}")
        raise

def validate_and_extract_matches(pattern: str, pairs: List[Tuple[str, str]], min_matches: int = 2) -> Tuple[List[Tuple[str, str]], List[Tuple[str, str]]]:
    """Validate regex and separate matched from unmatched pairs"""
    print(f"{GREEN}TESTING:{RESET} Validating pattern: {MAGENTA}{pattern}{RESET}")
    
    try:
        regex = re.compile(pattern)
    except re.error as e:
        print(f"{RED}ERROR:{RESET} Invalid regex pattern - {e}")
        return [], pairs
    
    matched_pairs = []
    unmatched_pairs = []
    
    for src, tgt in pairs:
        try:
            if regex.search(src):
                matched_pairs.append((src, tgt))
            else:
                unmatched_pairs.append((src, tgt))
        except:
            # Handle any regex matching errors
            unmatched_pairs.append((src, tgt))
    
    print(f"{GREEN}RESULT:{RESET} Pattern matched {CYAN}[{len(matched_pairs)}/{len(pairs)}]{RESET} examples")
    
    # Show some examples
    if matched_pairs:
        print(f"{BLUE}MATCHED EXAMPLES:{RESET}")
        for src, tgt in matched_pairs[:5]:
            print(f"  '{src}' -> '{tgt}'")
        if len(matched_pairs) > 5:
            print(f"  ... and {len(matched_pairs) - 5} more")
    
    # Check if we have enough matches
    if len(matched_pairs) < min_matches:
        print(f"{YELLOW}WARNING:{RESET} Pattern matched only {len(matched_pairs)} examples (minimum: {min_matches})")
        return [], pairs
    
    return matched_pairs, unmatched_pairs

def generate_final_prompt(rule_clusters: List[RuleCluster], project_name: str) -> str:
    """Generate the final classification prompt with all discovered patterns"""
    prompt = f"""# Name Standardization Rules for {project_name}

You are a name standardization system. Apply the following transformation rules to classify and standardize input names:

## Discovered Transformation Patterns:

"""
    
    for i, cluster in enumerate(rule_clusters, 1):
        prompt += f"""### Rule {i}: {cluster.description}
**Pattern:** `{cluster.pattern}`
**Confidence:** {cluster.confidence:.1%} (matched {cluster.match_count} examples)

**Examples:**
"""
        for src, tgt in cluster.examples[:5]:
            prompt += f"- '{src}' → '{tgt}'\n"
        
        prompt += "\n"
    
    prompt += """## Instructions:
1. For each input name, check which pattern it matches
2. Apply the corresponding transformation rule
3. If no pattern matches, return the input unchanged or flag for manual review

**Note:** These patterns were automatically discovered from your training data with high confidence."""
    
    return prompt

@router.post("/analyze-patterns")
async def analyze_patterns(request_data: PatternRequest, request: Request):
    """Iteratively analyze dictionary patterns with intelligent pattern discovery"""
    print(f"{GREEN}{'='*60}{RESET}")
    print(f"{GREEN}INFO:{RESET} Starting intelligent pattern discovery for project: {request_data.project_name}")
    print(f"{GREEN}{'='*60}{RESET}")
    
    groq_client = getattr(request.app.state, 'groq_client', None)
    if not groq_client:
        raise HTTPException(status_code=500, detail="GROQ client not available")
    
    # Initialize
    remaining_pairs = list(request_data.dictionary.items())
    total_pairs = len(remaining_pairs)
    rule_clusters = []
    iteration = 1
    memory = PatternMemory()
    
    print(f"{CYAN}STARTING:{RESET} Total pairs to analyze: {CYAN}[{total_pairs}]{RESET}")
    
    try:
        while remaining_pairs and memory.should_continue():
            # Check for client disconnection at the start of each iteration
            if await check_client_disconnected(request):
                print(f"{RED}CLIENT DISCONNECTED:{RESET} Aborting at iteration {iteration}")
                return JSONResponse(
                    status_code=499,
                    content={"detail": "Client disconnected", "partial_results": {
                        "rule_clusters": [cluster.dict() for cluster in rule_clusters],
                        "coverage": sum(cluster.match_count for cluster in rule_clusters) / total_pairs if total_pairs > 0 else 0,
                        "iterations_completed": iteration - 1
                    }}
                )
            
            memory.increment_attempts()
            
            print(f"{CYAN}ITERATION {iteration}:{RESET} Processing {len(remaining_pairs)} pairs...")
            
            # Extract pattern for current remaining pairs (with disconnect checking)
            pattern_result = await extract_pattern_with_llm(
                remaining_pairs, 
                request_data.project_name, 
                groq_client,
                iteration,
                memory,
                rule_clusters,
                request  # Pass request for disconnect checking
            )
            
            if not pattern_result:
                print(f"{YELLOW}INFO:{RESET} No pattern suggested at iteration {iteration}")
                memory.add_failure("NO_PATTERN")
                
                # If we have found some patterns but can't find more, consider stopping
                if rule_clusters and memory.consecutive_failures >= 3:
                    print(f"{YELLOW}STOPPING:{RESET} Multiple consecutive failures, likely found all major patterns")
                    break
                continue
            
            pattern, description = pattern_result
            
            # Check if this pattern was already tried
            if pattern in memory.failed_patterns:
                print(f"{YELLOW}SKIPPING:{RESET} Pattern already failed: {pattern}")
                continue
            
            # Check for disconnection before validation
            if await check_client_disconnected(request):
                print(f"{RED}CLIENT DISCONNECTED:{RESET} Aborting during validation")
                raise HTTPException(status_code=499, detail="Client disconnected")
            
            # Validate and separate matched/unmatched pairs
            matched_pairs, unmatched_pairs = validate_and_extract_matches(pattern, remaining_pairs, min_matches=3)
            
            if matched_pairs:
                confidence = len(matched_pairs) / len(remaining_pairs)
                
                # Create rule cluster
                cluster = RuleCluster(
                    pattern=pattern,
                    description=description,
                    examples=matched_pairs[:10],
                    confidence=confidence,
                    match_count=len(matched_pairs)
                )
                rule_clusters.append(cluster)
                memory.add_success(pattern)
                
                print(f"{GREEN}CLUSTER {len(rule_clusters)} CREATED:{RESET} '{description}'")
                print(f"  - Matches: {CYAN}[{len(matched_pairs)}]{RESET}")
                print(f"  - Confidence: {CYAN}[{confidence:.1%}]{RESET}")
                
                # Update remaining pairs
                remaining_pairs = unmatched_pairs
                print(f"{MAGENTA}REMAINING:{RESET} {CYAN}[{len(remaining_pairs)}]{RESET} unmatched pairs")
                
                iteration += 1
            else:
                print(f"{YELLOW}FAILED:{RESET} Pattern '{pattern}' matched too few examples")
                memory.add_failure(pattern)
        
        # Final check before generating results
        if await check_client_disconnected(request):
            print(f"{RED}CLIENT DISCONNECTED:{RESET} Aborting before final result generation")
            raise HTTPException(status_code=499, detail="Client disconnected")
        
        # Calculate coverage
        matched_total = sum(cluster.match_count for cluster in rule_clusters)
        coverage = matched_total / total_pairs if total_pairs > 0 else 0
        
        print(f"\n{GREEN}{'='*60}{RESET}")
        print(f"{GREEN}DISCOVERY COMPLETE:{RESET}")
        print(f"  - Total attempts: {CYAN}[{memory.attempt_count}]{RESET}")
        print(f"  - Successful patterns: {CYAN}[{len(rule_clusters)}]{RESET}")
        print(f"  - Failed patterns: {CYAN}[{len(memory.failed_patterns)}]{RESET}")
        print(f"  - Total coverage: {CYAN}[{coverage:.1%}]{RESET} ({matched_total}/{total_pairs} pairs)")
        print(f"  - Unmatched pairs: {CYAN}[{len(remaining_pairs)}]{RESET}")
        
        # Show unmatched examples if any
        if remaining_pairs:
            print(f"\n{YELLOW}UNMATCHED EXAMPLES:{RESET}")
            for src, tgt in remaining_pairs[:10]:
                print(f"  '{src}' -> '{tgt}'")
            if len(remaining_pairs) > 10:
                print(f"  ... and {len(remaining_pairs) - 10} more")
        
        # Generate final prompt
        final_prompt = generate_final_prompt(rule_clusters, request_data.project_name)
        
        print(f"\n{GREEN}FINAL PROMPT GENERATED{RESET} ({len(final_prompt)} characters)")
        print(f"{GREEN}{'='*60}{RESET}")
        
        return PatternDiscoveryResult(
            rule_clusters=rule_clusters,
            unmatched_pairs=remaining_pairs,
            coverage=coverage,
            final_prompt=final_prompt,
            failed_attempts=list(memory.failed_patterns)
        )
        
    except HTTPException as e:
        if e.status_code == 499:
            print(f"{RED}REQUEST ABORTED:{RESET} Client disconnected during processing")
            # Return partial results if available
            return JSONResponse(
                status_code=499,
                content={
                    "detail": "Request aborted by client",
                    "partial_results": {
                        "rule_clusters": [cluster.dict() for cluster in rule_clusters],
                        "coverage": sum(cluster.match_count for cluster in rule_clusters) / total_pairs if total_pairs > 0 else 0,
                        "iterations_completed": iteration - 1
                    }
                }
            )
        raise
    except Exception as e:
        print(f"{RED}ERROR:{RESET} Pattern discovery failed - {e}")
        raise HTTPException(status_code=500, detail=str(e))