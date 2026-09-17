"""Shared API response helpers."""

from fastapi import HTTPException


class HTTPExceptionWithData(HTTPException):
    """An HTTPException whose error envelope also carries ``data`` (``main.py``), so
    a failed /matches still reports what its steps billed."""

    def __init__(self, exc: HTTPException, data: dict):
        super().__init__(exc.status_code, exc.detail, exc.headers)
        self.data = data


def _ok(message, data=None):
    r = {"status": "success", "message": message}
    if data is not None:
        r["data"] = data
    return r


def _err(message, data=None):
    r = {"status": "error", "message": message}
    if data is not None:
        r["data"] = data
    return r
