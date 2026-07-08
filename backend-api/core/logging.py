"""
Centralized logging configuration for TermNorm Backend API
"""
import logging
import re
import sys
from pathlib import Path

from core.log_format import TAGS
from utils.utils import BRIGHT_RED, RESET, YELLOW

# Match only real, registered tags — never a stray bracket in a message body.
_TAG_RE = re.compile("|".join(re.escape(t) for t in TAGS))


class ConsoleFormatter(logging.Formatter):
    """Color the leading tag by **level only** — the ONE place console color lives.

    Call sites emit plain ``[TAG] body`` text. INFO lines stay neutral (colored
    tags on every line read as noise); only a warning (yellow) or error (red)
    paints its tag, so a problem is unmistakable amid the stream. The single
    INFO-level color is the ``[RESP]`` outcome word, painted at its source. The
    file handler never sees this formatter — so ``logs/app.log`` is ANSI-free.
    """

    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        if record.levelno >= logging.ERROR:
            color = BRIGHT_RED
        elif record.levelno >= logging.WARNING:
            color = YELLOW
        else:
            return msg  # INFO and below: neutral
        match = _TAG_RE.search(msg)
        if not match:
            return msg
        start, end = match.span()
        return f"{msg[:start]}{color}{match.group(0)}{RESET}{msg[end:]}"


def setup_logging(
    level: str = "INFO",
    log_file: str | None = None,
    include_console: bool = True
) -> None:
    """
    Setup centralized logging configuration

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional log file path
        include_console: Whether to include console handler
    """
    # Create logs directory if it doesn't exist
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)

    # Configure root logger — console format is intentionally terse.
    # File handler (below) keeps the verbose format for post-mortem.
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format='%(asctime)s %(message)s',
        datefmt='%H:%M:%S',
        handlers=[]  # Clear default handlers
    )

    root_logger = logging.getLogger()

    # Console handler — colored by ConsoleFormatter (tag + level).
    if include_console:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(
            ConsoleFormatter('%(asctime)s %(message)s', datefmt='%H:%M:%S')
        )
        root_logger.addHandler(console_handler)

    # File handler
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setFormatter(
            logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s')
        )
        root_logger.addHandler(file_handler)

    # Set specific loggers to appropriate levels
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    # uvicorn's access line ("POST /matches 200 OK") duplicates our [REQ ]/[RESP]
    # pair (which carry the query, timing, outcome + tokens) — silence it.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("fastapi").setLevel(logging.INFO)
    logging.getLogger("bs4.dammit").setLevel(logging.ERROR)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("config.middleware").setLevel(logging.WARNING)

    logging.debug("Logging configuration completed")


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance for the given name"""
    return logging.getLogger(name)