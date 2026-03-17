"""Unit tests for app/middleware/logging.py — Tasks 3.1 through 3.5."""
import json
import logging

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.middleware.logging import (
    LoggingMiddleware,
    _extract_installation_id,
    _format_log_entry,
    _select_log_level,
)


# ---------------------------------------------------------------------------
# Task 3.1 — _select_log_level
# ---------------------------------------------------------------------------

class TestSelectLogLevel:
    """Boundary status codes and health-path suppression."""

    # Health paths take priority regardless of status code
    def test_healthz_returns_debug(self):
        assert _select_log_level("/healthz", 200) == logging.DEBUG

    def test_readyz_returns_debug(self):
        assert _select_log_level