"""
Simple user manager with hot-reload and per-user session management
"""
import json
import hashlib
import time
import logging
from pathlib import Path
from typing import Optional, Dict, Tuple

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


class UserSession:
    """Represents a user session with matcher and TTL"""

    def __init__(self, user_id: str, matcher, ttl_seconds: int = 86400):
        self.user_id = user_id
        self.matcher = matcher
        self.last_accessed = time.time()
        self.ttl_seconds = ttl_seconds  # 24 hours default

    def is_expired(self) -> bool:
        """Check if session has exceeded TTL"""
        return (time.time() - self.last_accessed) > self.ttl_seconds

    def touch(self):
        """Update last accessed timestamp"""
        self.last_accessed = time.time()


# Global instances
user_manager = UserManager()
_user_sessions: Dict[Tuple[str, str], UserSession] = {}


def get_session(user_id: str, project_id: str = "default") -> Optional[UserSession]:
    """Get user session with lazy TTL cleanup. Returns None if not found or expired."""
    key = (user_id, project_id)
    session = _user_sessions.get(key)

    if session is None:
        return None

    # Lazy cleanup - remove expired session
    if session.is_expired():
        del _user_sessions[key]
        logger.info(f"Session expired for user {user_id}, project: {project_id}")
        return None

    # Touch session to update last accessed time
    session.touch()
    return session


def create_session(user_id: str, project_id: str, matcher, ttl_seconds: int = 86400) -> UserSession:
    """Create new session for user + project with TTL"""
    key = (user_id, project_id)
    session = UserSession(user_id, matcher, ttl_seconds)
    _user_sessions[key] = session
    logger.info(f"Created session for user {user_id}, project: {project_id}")
    return session


def cleanup_all_sessions() -> int:
    """Clear all sessions. Returns number of sessions cleaned."""
    count = len(_user_sessions)
    _user_sessions.clear()

    if count > 0:
        logger.info(f"Manual cleanup: Cleared {count} sessions")

    return count


def cleanup_expired_sessions() -> int:
    """Remove expired sessions. Returns number of sessions cleaned."""
    expired_keys = [key for key, session in _user_sessions.items() if session.is_expired()]

    for key in expired_keys:
        del _user_sessions[key]

    if expired_keys:
        logger.info(f"Cleaned up {len(expired_keys)} expired sessions")

    return len(expired_keys)


def get_session_stats() -> dict:
    """Get statistics about active sessions"""
    sessions_by_user = {}
    for (user_id, project_id) in _user_sessions.keys():
        if user_id not in sessions_by_user:
            sessions_by_user[user_id] = []
        sessions_by_user[user_id].append(project_id)

    return {
        "active_sessions": len(_user_sessions),
        "sessions_by_user": sessions_by_user
    }
