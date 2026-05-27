#!/usr/bin/env bash
# start-server-py-LLMs.sh — Linux/macOS launcher for the TermNorm backend.
# Parity with start-server-py-LLMs.bat (Windows). Drops Windows-only bits
# (chcp, prompt-trick ESC capture) and uses portable POSIX equivalents.

set -uo pipefail

# Script + path resolution (portable: avoids GNU-only `readlink -f`).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PATH="$SCRIPT_DIR/backend-api"
VENV_PATH="$BACKEND_PATH/.venv"
LOG_FILE="$SCRIPT_DIR/server.log"

# ANSI colors.
RESET=$'\033[0m'
GREEN=$'\033[92m'
YELLOW=$'\033[93m'
CYAN=$'\033[96m'
RED=$'\033[91m'
DIM=$'\033[90m'

# Detect Python — prefer python3, fall back to `python` only if 3.x.
PYTHON_CMD=""
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    if python --version 2>&1 | grep -q "Python 3"; then
        PYTHON_CMD="python"
    fi
fi
if [ -z "$PYTHON_CMD" ]; then
    echo "${RED}ERROR${RESET}: Python 3 not found. Neither 'python3' nor 'python' resolves to a 3.x interpreter."
    echo "Test: python3 --version  OR  python --version"
    exit 1
fi

PYTHON_VERSION="$($PYTHON_CMD --version 2>&1 | awk '{print $2}')"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server startup initiated" >> "$LOG_FILE"

# Backend dir check.
if [ ! -d "$BACKEND_PATH" ]; then
    echo "${RED}error${RESET}  backend dir missing: $BACKEND_PATH"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backend directory not found" >> "$LOG_FILE"
    exit 1
fi
cd "$BACKEND_PATH" || {
    echo "${RED}error${RESET}  cannot cd to: $BACKEND_PATH"
    exit 1
}

# Venv — create on first run.
if [ ! -d "$VENV_PATH" ]; then
    echo "${DIM}creating virtualenv...${RESET}"
    if ! "$PYTHON_CMD" -m venv "$VENV_PATH"; then
        echo "${RED}error${RESET}  failed to create venv"
        exit 1
    fi
fi

# Requirements — install only if requirements.txt is newer than marker.
# Portable mtime comparison via `find -newer` (works on GNU + BSD/macOS).
INSTALL_MARKER="$VENV_PATH/installed.txt"
NEEDS_INSTALL=0
if [ ! -f "$INSTALL_MARKER" ]; then
    NEEDS_INSTALL=1
elif [ -f "requirements.txt" ]; then
    if [ -n "$(find requirements.txt -newer "$INSTALL_MARKER" -print 2>/dev/null)" ]; then
        NEEDS_INSTALL=1
    fi
fi

if [ "$NEEDS_INSTALL" = "1" ]; then
    echo "${DIM}installing requirements...${RESET}"
    if [ ! -x "$VENV_PATH/bin/pip" ]; then
        echo "${RED}error${RESET}  pip missing at $VENV_PATH/bin/pip"
        exit 1
    fi
    if [ ! -f "requirements.txt" ]; then
        echo "${RED}error${RESET}  requirements.txt not found"
        exit 1
    fi
    if "$VENV_PATH/bin/pip" install -r requirements.txt -q; then
        : > "$INSTALL_MARKER"
        REQ_STATUS="requirements installed"
    else
        REQ_STATUS="requirements install had warnings"
    fi
else
    REQ_STATUS="requirements synced"
fi

# Launcher banner.
echo
echo "${CYAN}--- TermNorm - Launcher --------------${RESET}"
echo
echo " Python  $PYTHON_VERSION"
echo "         .venv ready"
echo " Backend backend-api/"
echo "         $REQ_STATUS"
echo " Host    0.0.0.0:8000 --reload"
echo " Log     server.log"
echo
echo " ${DIM}booting uvicorn...${RESET}"
echo

# Clean Ctrl+C / SIGTERM — log shutdown, exit 0. Single Ctrl+C tears
# down the loop (more Linux-native than the .bat's Ctrl+C-twice dance).
on_shutdown() {
    echo
    echo "${CYAN}--- Shutdown ---${RESET}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server stopped by signal" >> "$LOG_FILE"
    exit 0
}
trap on_shutdown INT TERM

# Auto-restart loop.
while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server starting" >> "$LOG_FILE"
    set +e
    "$VENV_PATH/bin/python" -m uvicorn main:app --host 0.0.0.0 --port 8000
    EXIT_CODE=$?
    set -e
    echo
    echo "${CYAN}--- Server stopped - exit $EXIT_CODE --${RESET}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server stopped (exit code: $EXIT_CODE)" >> "$LOG_FILE"
    echo " ${DIM}auto-restarting in 5s - Ctrl+C exits${RESET}"
    sleep 5
done
