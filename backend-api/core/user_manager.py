"""
Simplified user manager - IP authentication only (no sessions)
"""
import json
import hashlib
import logging
from pathlib import Path
from typing import Optional, Dict

logger = logging.getLogger(__name__)


class UserManager:
    """Manages user authentication with hot-reload capability"""

    def __init__(self, users_file="config/users.json"):
        self.users_file = Path(users_file)
        self.users: Dict[str, dict] = {}
        self._last_hash: Optional[str] = None
        self.load_users()

    def load_users(self) -> bool:
        """Load users from JSON, auto-detect changes. Returns True if changed."""
        if not self.users_file.exists():
            logger.warning(f"Users file not found: {self.users_file}")
            return False

        content = self.users_file.read_bytes()
        new_hash = hashlib.md5(content).hexdigest()

        if new_hash == self._last_hash:
            return False  # No changes

        try:
            data = json.loads(content)
            self.users = data.get("users", {})
            self._last_hash = new_hash
            logger.info(f"Loaded {len(self.users)} users")
            return True
        except Exception as e:
            logger.error(f"Failed to load users: {e}")
            return False

    def authenticate(self, ip: str) -> Optional[str]:
        """Return user_id if IP is allowed, else None"""
        self.load_users()  # Hot-reload check

        for user_id, data in self.users.items():
            if ip in data.get("allowed_ips", []):
                return user_id

        logger.warning(f"IP {ip} not authorized")
        return None


# Global instance
user_manager = UserManager()
