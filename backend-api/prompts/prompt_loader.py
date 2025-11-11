"""
Prompt Versioning System - Centralized prompt management
Loads versioned prompts from JSON files with metadata tracking
"""
import json
from pathlib import Path
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

class PromptLoader:
    """Manages versioned prompts with fallback and validation"""

    def __init__(self, prompts_dir: Optional[Path] = None):
        if prompts_dir is None:
            prompts_dir = Path(__file__).parent
        self.prompts_dir = prompts_dir
        self._cache = {}

    def load_prompt(self, prompt_type: str, version: str = "latest") -> Dict[str, Any]:
        """
        Load a versioned prompt with caching

        Args:
            prompt_type: 'entity_profiling' or 'candidate_ranking'
            version: Version string (e.g., '1.0.0') or 'latest'

        Returns:
            Dict containing prompt metadata and template
        """
        cache_key = f"{prompt_type}:{version}"

        # Check cache
        if cache_key in self._cache:
            return self._cache[cache_key]

        # Resolve version
        prompt_dir = self.prompts_dir / prompt_type
        if not prompt_dir.exists():
            raise FileNotFoundError(f"Prompt type directory not found: {prompt_dir}")

        if version == "latest":
            version = self._get_latest_version(prompt_dir)

        # Load prompt file
        prompt_file = prompt_dir / f"v{version}.json"
        if not prompt_file.exists():
            raise FileNotFoundError(f"Prompt version not found: {prompt_file}")

        with open(prompt_file, 'r', encoding='utf-8') as f:
            prompt_data = json.load(f)

        # Validate required fields
        required_fields = ['version', 'prompt_template', 'parameters']
        for field in required_fields:
            if field not in prompt_data:
                raise ValueError(f"Prompt file missing required field '{field}': {prompt_file}")

        # Cache and return
        self._cache[cache_key] = prompt_data
        logger.info(f"Loaded prompt: {prompt_type} v{version} ({prompt_data.get('name', 'Unknown')})")
        return prompt_data

    def _get_latest_version(self, prompt_dir: Path) -> str:
        """Find the latest version in a prompt directory"""
        version_files = list(prompt_dir.glob("v*.json"))
        if not version_files:
            raise FileNotFoundError(f"No prompt versions found in {prompt_dir}")

        # Extract version numbers and sort
        versions = []
        for file in version_files:
            version_str = file.stem[1:]  # Remove 'v' prefix
            try:
                parts = tuple(map(int, version_str.split('.')))
                versions.append((parts, version_str))
            except ValueError:
                logger.warning(f"Invalid version format: {file.name}")
                continue

        if not versions:
            raise ValueError(f"No valid version files found in {prompt_dir}")

        # Return highest version
        versions.sort(reverse=True)
        return versions[0][1]

    def list_versions(self, prompt_type: str) -> list:
        """List all available versions for a prompt type"""
        prompt_dir = self.prompts_dir / prompt_type
        if not prompt_dir.exists():
            return []

        versions = []
        for file in prompt_dir.glob("v*.json"):
            try:
                with open(file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    versions.append({
                        'version': data['version'],
                        'name': data.get('name', 'Unknown'),
                        'status': data.get('status', 'unknown'),
                        'created_date': data.get('created_date', 'Unknown')
                    })
            except Exception as e:
                logger.error(f"Error reading {file}: {e}")
                continue

        return sorted(versions, key=lambda x: x['version'], reverse=True)

    def format_prompt(self, prompt_data: Dict[str, Any], **kwargs) -> str:
        """
        Format a prompt template with provided parameters

        Args:
            prompt_data: Prompt dictionary from load_prompt()
            **kwargs: Parameters to substitute in template

        Returns:
            Formatted prompt string
        """
        template = prompt_data['prompt_template']

        # Validate all required parameters are provided
        required_params = prompt_data.get('parameters', {})
        missing = set(required_params.keys()) - set(kwargs.keys())
        if missing:
            logger.warning(f"Missing parameters: {missing}")

        # Format template
        try:
            return template.format(**kwargs)
        except KeyError as e:
            raise ValueError(f"Missing required parameter: {e}")


# Global singleton instance
_prompt_loader = None

def get_prompt_loader() -> PromptLoader:
    """Get or create the global prompt loader instance"""
    global _prompt_loader
    if _prompt_loader is None:
        _prompt_loader = PromptLoader()
    return _prompt_loader
