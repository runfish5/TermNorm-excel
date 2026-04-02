"""Datetime-prefixed ID generation."""

import uuid
from datetime import datetime


def generate_dated_id(length: int = 32) -> str:
    """Generate a datetime-prefixed hexadecimal ID.

    Format: YYMMDDHHMMSS + random hex to fill remaining length.
    Example (32 chars): 251205143052a7b8c9d0e1f2345678ab
    """
    datetime_prefix = datetime.utcnow().strftime("%y%m%d%H%M%S")
    random_hex = uuid.uuid4().hex[:length - len(datetime_prefix)]
    return f"{datetime_prefix}{random_hex}"
