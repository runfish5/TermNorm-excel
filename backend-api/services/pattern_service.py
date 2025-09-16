"""
Pattern analysis service - contains business logic for pattern discovery
"""
import re
import logging
from typing import Dict, List, Optional, Tuple, Set
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from collections import defaultdict

from models.pattern_models import PatternRequest, RuleCluster, PatternDiscoveryResult

logger = logging.getLogger(__name__)

# Terminal colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
MAGENTA = '\033[35m'
RED = '\033[31m'
BLUE = '\033[34m'
RESET = '\033[0m'


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


class PatternService:
    """Service for pattern analysis and discovery"""

    def __init__(self, groq_client):
        self.groq_client = groq_client

    async def check_client_disconnected(self, request: Request) -> bool:
        """Check if the client has disconnected"""
        try:
            # This will raise an exception if client disconnected
            await request.is_disconnected()
            return await request.is_disconnected()
        except Exception:
            return True

    async def extract_pattern_with_llm(
        self,
        pairs: List[Tuple[str, str]],
        project_name: str,
        iteration: int,
        memory: PatternMemory,
        previous_clusters: List[RuleCluster],
        request: Request
    ) -> Optional[Tuple[str, str]]:
        """Extract regex pattern and description using LLM analysis with strategic hints"""
        pairs_count = len(pairs)
        logger.info(f"ITERATION {iteration} - ANALYSIS: Starting with [{pairs_count}] remaining pairs")

        # Check if client disconnected before starting expensive operation
        if await self.check_client_disconnected(request):
            logger.warning(f"CLIENT DISCONNECTED: Aborting pattern extraction at iteration {iteration}")
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
            if await self.check_client_disconnected(request):
                logger.warning("CLIENT DISCONNECTED: Aborting before LLM call")
                raise HTTPException(status_code=499, detail="Client disconnected")

            logger.info(f"CALLING LLM: Analyzing {pairs_count} pairs...")

            # Make the LLM call - this is the expensive operation
            response = await self.groq_client.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                model="meta-llama/llama-4-maverick-17b-128e-instruct",
                temperature=0.3
            )

            # Check for disconnection after LLM call
            if await self.check_client_disconnected(request):
                logger.warning("CLIENT DISCONNECTED: Aborting after LLM call")
                raise HTTPException(status_code=499, detail="Client disconnected")

            content = response.choices[0].message.content.strip()
            logger.info(f"LLM_RESPONSE:\n{content}")

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

                logger.info(f"PATTERN: {pattern}")
                logger.info(f"EXPECTED MATCHES: {expected}")

                return (pattern, description)
            else:
                logger.error("Could not parse LLM response format")
                return None

        except HTTPException:
            # Re-raise HTTP exceptions (like client disconnect)
            raise
        except Exception as e:
            logger.error(f"LLM analysis failed - {e}")
            raise

    def validate_and_extract_matches(self, pattern: str, pairs: List[Tuple[str, str]], min_matches: int = 2) -> Tuple[List[Tuple[str, str]], List[Tuple[str, str]]]:
        """Validate regex and separate matched from unmatched pairs"""
        logger.info(f"TESTING: Validating pattern: {pattern}")

        try:
            regex = re.compile(pattern)
        except re.error as e:
            logger.error(f"Invalid regex pattern - {e}")
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

        logger.info(f"RESULT: Pattern matched [{len(matched_pairs)}/{len(pairs)}] examples")

        # Show some examples
        if matched_pairs:
            logger.info("MATCHED EXAMPLES:")
            for src, tgt in matched_pairs[:5]:
                logger.info(f"  '{src}' -> '{tgt}'")
            if len(matched_pairs) > 5:
                logger.info(f"  ... and {len(matched_pairs) - 5} more")

        # Check if we have enough matches
        if len(matched_pairs) < min_matches:
            logger.warning(f"Pattern matched only {len(matched_pairs)} examples (minimum: {min_matches})")
            return [], pairs

        return matched_pairs, unmatched_pairs

    def generate_final_prompt(self, rule_clusters: List[RuleCluster], project_name: str) -> str:
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

    async def analyze_patterns(self, request_data: PatternRequest, request: Request) -> PatternDiscoveryResult:
        """Iteratively analyze dictionary patterns with intelligent pattern discovery"""
        logger.info("="*60)
        logger.info(f"INFO: Starting intelligent pattern discovery for project: {request_data.project_name}")
        logger.info("="*60)

        if not self.groq_client:
            raise HTTPException(status_code=500, detail="GROQ client not available")

        # Initialize
        remaining_pairs = list(request_data.dictionary.items())
        total_pairs = len(remaining_pairs)
        rule_clusters = []
        iteration = 1
        memory = PatternMemory()

        logger.info(f"STARTING: Total pairs to analyze: [{total_pairs}]")

        try:
            while remaining_pairs and memory.should_continue():
                # Check for client disconnection at the start of each iteration
                if await self.check_client_disconnected(request):
                    logger.warning(f"CLIENT DISCONNECTED: Aborting at iteration {iteration}")
                    return JSONResponse(
                        status_code=499,
                        content={"detail": "Client disconnected", "partial_results": {
                            "rule_clusters": [cluster.dict() for cluster in rule_clusters],
                            "coverage": sum(cluster.match_count for cluster in rule_clusters) / total_pairs if total_pairs > 0 else 0,
                            "iterations_completed": iteration - 1
                        }}
                    )

                memory.increment_attempts()

                logger.info(f"ITERATION {iteration}: Processing {len(remaining_pairs)} pairs...")

                # Extract pattern for current remaining pairs (with disconnect checking)
                pattern_result = await self.extract_pattern_with_llm(
                    remaining_pairs,
                    request_data.project_name,
                    iteration,
                    memory,
                    rule_clusters,
                    request  # Pass request for disconnect checking
                )

                if not pattern_result:
                    logger.info(f"No pattern suggested at iteration {iteration}")
                    memory.add_failure("NO_PATTERN")

                    # If we have found some patterns but can't find more, consider stopping
                    if rule_clusters and memory.consecutive_failures >= 3:
                        logger.info("STOPPING: Multiple consecutive failures, likely found all major patterns")
                        break
                    continue

                pattern, description = pattern_result

                # Check if this pattern was already tried
                if pattern in memory.failed_patterns:
                    logger.info(f"SKIPPING: Pattern already failed: {pattern}")
                    continue

                # Check for disconnection before validation
                if await self.check_client_disconnected(request):
                    logger.warning("CLIENT DISCONNECTED: Aborting during validation")
                    raise HTTPException(status_code=499, detail="Client disconnected")

                # Validate and separate matched/unmatched pairs
                matched_pairs, unmatched_pairs = self.validate_and_extract_matches(pattern, remaining_pairs, min_matches=3)

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

                    logger.info(f"CLUSTER {len(rule_clusters)} CREATED: '{description}'")
                    logger.info(f"  - Matches: [{len(matched_pairs)}]")
                    logger.info(f"  - Confidence: [{confidence:.1%}]")

                    # Update remaining pairs
                    remaining_pairs = unmatched_pairs
                    logger.info(f"REMAINING: [{len(remaining_pairs)}] unmatched pairs")

                    iteration += 1
                else:
                    logger.info(f"FAILED: Pattern '{pattern}' matched too few examples")
                    memory.add_failure(pattern)

            # Final check before generating results
            if await self.check_client_disconnected(request):
                logger.warning("CLIENT DISCONNECTED: Aborting before final result generation")
                raise HTTPException(status_code=499, detail="Client disconnected")

            # Calculate coverage
            matched_total = sum(cluster.match_count for cluster in rule_clusters)
            coverage = matched_total / total_pairs if total_pairs > 0 else 0

            logger.info("\n" + "="*60)
            logger.info("DISCOVERY COMPLETE:")
            logger.info(f"  - Total attempts: [{memory.attempt_count}]")
            logger.info(f"  - Successful patterns: [{len(rule_clusters)}]")
            logger.info(f"  - Failed patterns: [{len(memory.failed_patterns)}]")
            logger.info(f"  - Total coverage: [{coverage:.1%}] ({matched_total}/{total_pairs} pairs)")
            logger.info(f"  - Unmatched pairs: [{len(remaining_pairs)}]")

            # Show unmatched examples if any
            if remaining_pairs:
                logger.info("\nUNMATCHED EXAMPLES:")
                for src, tgt in remaining_pairs[:10]:
                    logger.info(f"  '{src}' -> '{tgt}'")
                if len(remaining_pairs) > 10:
                    logger.info(f"  ... and {len(remaining_pairs) - 10} more")

            # Generate final prompt
            final_prompt = self.generate_final_prompt(rule_clusters, request_data.project_name)

            logger.info(f"\nFINAL PROMPT GENERATED ({len(final_prompt)} characters)")
            logger.info("="*60)

            return PatternDiscoveryResult(
                rule_clusters=rule_clusters,
                unmatched_pairs=remaining_pairs,
                coverage=coverage,
                final_prompt=final_prompt,
                failed_attempts=list(memory.failed_patterns)
            )

        except HTTPException as e:
            if e.status_code == 499:
                logger.error("REQUEST ABORTED: Client disconnected during processing")
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
            logger.error(f"Pattern discovery failed - {e}")
            raise HTTPException(status_code=500, detail=str(e))