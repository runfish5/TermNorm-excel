# ./backend-api/utils/utils.py
"""
Shared ASCII color codes for console output formatting.
Usage: from utils.utils import CYAN, RED, RESET, etc.
"""

def flatten_strings(data, exclude=None):
    """Recursively extract all strings from nested dict/list, excluding specified keys."""
    if exclude is None:
        exclude = {'_metadata'}
    
    if isinstance(data, dict):
        return [s for k, v in data.items() if k not in exclude for s in flatten_strings(v, exclude)]
    elif isinstance(data, list):
        return [s for item in data for s in flatten_strings(item, exclude)]
    else:
        return [str(data)]



# Standard Colors
BLACK   = '\033[30m'
RED     = '\033[31m'
GREEN   = '\033[32m'
YELLOW  = '\033[33m'
BLUE    = '\033[34m'
MAGENTA = '\033[35m'
CYAN    = '\033[36m'
WHITE   = '\033[37m'

# Bright Colors
BRIGHT_BLACK   = '\033[90m'
BRIGHT_RED     = '\033[91m'
BRIGHT_GREEN   = '\033[92m'
BRIGHT_YELLOW  = '\033[93m'
BRIGHT_BLUE    = '\033[94m'
BRIGHT_MAGENTA = '\033[95m'
BRIGHT_CYAN    = '\033[96m'
BRIGHT_WHITE   = '\033[97m'

# Background Colors
BG_BLACK   = '\033[40m'
BG_RED     = '\033[41m'
BG_GREEN   = '\033[42m'
BG_YELLOW  = '\033[43m'
BG_BLUE    = '\033[44m'
BG_MAGENTA = '\033[45m'
BG_CYAN    = '\033[46m'
BG_WHITE   = '\033[47m'

# Text Formatting
BOLD      = '\033[1m'
UNDERLINE = '\033[4m'
ITALIC    = '\033[3m'
DIM       = '\033[2m'

# Reset
RESET = '\033[0m'