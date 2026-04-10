"""Shared API response helpers."""


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
