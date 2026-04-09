import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request
from starlette.responses import Response

from app.dependencies import ensure_installation_id_when_ip_present, get_client_ip
from app.logging_config import setup_logging
from app.main import handle_upstream_error, lifespan
from app.middleware.logging import LoggingMiddleware
from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
    UpstreamTimeoutError,
)


@pytest.mark.asyncio
async def test_upstream_error_handler_status_codes():
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    expected = [
        (UpstreamAuthError("auth"), 503, "UPSTREAM_AUTH_ERROR"),
        (UpstreamRateLimitError("rate"), 429, "UPSTREAM_RATE_LIMIT"),
        (UpstreamTimeoutError("timeout"), 504, "UPSTREAM_TIMEOUT"),
        (UpstreamBadResponseError("bad"), 502, "UPSTREAM_BAD_RESPONSE"),
        (UpstreamServiceError("service"), 502, "UPSTREAM_API_ERROR"),
    ]
    for exc, status_code, error_code in expected:
        response = await handle_upstream_error(request, exc)
        assert response.status_code == status_code
        assert response.body.decode() == f'{{"detail":"{exc}","error_code":"{error_code}"}}'


@pytest.mark.asyncio
async def test_lifespan_runs_startup_and_shutdown_hooks():
    app = FastAPI()
    fake_engine = SimpleNamespace(dispose=AsyncMock())
    with (
        patch("app.main.setup_logging") as setup_logging_mock,
        patch("app.main.setup_file_logging") as setup_file_logging_mock,
        patch("app.main.engine", fake_engine),
    ):
        async with lifespan(app):
            setup_logging_mock.assert_called_once()
            setup_file_logging_mock.assert_called_once()
        fake_engine.dispose.assert_awaited_once()


@pytest.mark.asyncio
async def test_request_id_middleware_generates_and_preserves_header(client: AsyncClient):
    generated = await client.get("/healthz")
    assert generated.status_code == 200
    assert generated.headers.get("X-Request-ID")

    preserved = await client.get("/healthz", headers={"X-Request-ID": "req-fixed-1"})
    assert preserved.status_code == 200
    assert preserved.headers.get("X-Request-ID") == "req-fixed-1"


@pytest.mark.asyncio
async def test_logging_middleware_logs_success_and_exception(caplog):
    caplog.set_level(logging.INFO, logger="prompttune.access")
    middleware = LoggingMiddleware(app=FastAPI())
    request = Request({"type": "http", "method": "GET", "path": "/x", "headers": []})
    request.state.request_id = "rid-1"

    async def ok_call_next(_request):
        return Response(status_code=204)

    response = await middleware.dispatch(request, ok_call_next)
    assert response.status_code == 204
    assert any("GET /x 204" in rec.message for rec in caplog.records)

    caplog.clear()

    async def bad_call_next(_request):
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        await middleware.dispatch(request, bad_call_next)
    assert any("unhandled_error" in rec.message for rec in caplog.records)
    assert any("GET /x 500" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_get_client_ip_header_precedence_and_fallback():
    app = FastAPI()

    @app.get("/ip")
    async def read_ip(request: Request):
        return {"ip": await get_client_ip(request)}

    transport = ASGITransport(app=app, client=("127.0.0.8", 1234))
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        forwarded = await ac.get("/ip", headers={"X-Forwarded-For": "9.9.9.9, 8.8.8.8"})
        assert forwarded.json()["ip"] == "9.9.9.9"

        real = await ac.get("/ip", headers={"X-Real-IP": "7.7.7.7"})
        assert real.json()["ip"] == "7.7.7.7"

        fallback = await ac.get("/ip")
        assert fallback.json()["ip"] == "127.0.0.8"


@pytest.mark.asyncio
async def test_ensure_installation_id_when_ip_present_non_error_paths():
    redis_mock = AsyncMock()
    await ensure_installation_id_when_ip_present("unknown", "", redis_mock)
    await ensure_installation_id_when_ip_present("1.2.3.4", "  abc  ", redis_mock)
    redis_mock.set.assert_not_awaited()


def test_setup_logging_sets_handlers_and_levels():
    root_logger = logging.getLogger()
    access_logger = logging.getLogger("prompttune.access")

    old_root_handlers = list(root_logger.handlers)
    old_access_handlers = list(access_logger.handlers)
    old_root_level = root_logger.level
    old_access_level = access_logger.level
    old_access_propagate = access_logger.propagate

    try:
        setup_logging()
        assert root_logger.level == logging.INFO
        assert len(root_logger.handlers) == 1
        assert root_logger.handlers[0].level == logging.INFO
        assert access_logger.level == logging.INFO
        assert len(access_logger.handlers) == 1
        assert access_logger.handlers[0].level == logging.INFO
        assert access_logger.propagate is False
    finally:
        root_logger.handlers.clear()
        root_logger.handlers.extend(old_root_handlers)
        root_logger.setLevel(old_root_level)

        access_logger.handlers.clear()
        access_logger.handlers.extend(old_access_handlers)
        access_logger.setLevel(old_access_level)
        access_logger.propagate = old_access_propagate
