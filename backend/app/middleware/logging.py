import json
import logging
import time
from datetime import datetime

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.security.redaction import redact_secrets

logger = logging.getLogger("prompttune.access")


def _resolve_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "-"


def _extract_installation_id(body: bytes, query_params) -> str:
    """Return installation_id from JSON body or query string, or '-' on any failure."""
    try:
        data = json.loads(body)
        if isinstance(data, dict) and "installation_id" in data:
            return str(data["installation_id"])
    except Exception:
        pass
    try:
        value = query_params.get("installation_id")
        if value is not None:
            return str(value)
    except Exception:
        pass
    return "-"


def _select_log_level(path: str, status_code: int) -> int:
    """Return the appropriate log level for a request.

    Health paths always return DEBUG. Otherwise the level is determined
    by the HTTP status code range:
      100–399 → INFO
      400–499 → WARNING
      500–599 → ERROR
    """
    if path in ("/healthz", "/readyz"):
        return logging.DEBUG
    if status_code >= 500:
        return logging.ERROR
    if status_code >= 400:
        return logging.WARNING
    return logging.INFO


def _format_log_entry(
    method: str,
    path: str,
    status_code: int,
    latency_ms: int,
    client_ip: str,
    installation_id: str,
    request_id: str,
    timestamp: str,
) -> str:
    """Return the formatted log line (no newline).

    The level and timestamp are handled by the logging framework; this
    function returns only the message portion.  Missing fields should be
    passed as '-'.
    """
    return (
        f"{method} {path} {status_code} {latency_ms}ms"
        f" ip={client_ip} install={installation_id} req_id={request_id}"
    )


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Buffer body, extract installation_id, replay stream for downstream handlers
        body = await request.body()
        installation_id = _extract_installation_id(body, request.query_params)

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request(request.scope, receive)

        # Resolve client IP
        client_ip = _resolve_client_ip(request)

        request_id = getattr(request.state, "request_id", "-")
        method = request.method
        path = request.url.path
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")

        start = time.monotonic()

        try:
            response = await call_next(request)
        except Exception as exc:
            logger.error(
                "UNHANDLED %s %s EXCEPTION %s: %s req_id=%s",
                method, path, type(exc).__name__, exc, request_id,
            )
            raise

        latency_ms = int((time.monotonic() - start) * 1000)
        status_code = response.status_code

        level = _select_log_level(path, status_code)
        message = _format_log_entry(
            method=method,
            path=path,
            status_code=status_code,
            latency_ms=latency_ms,
            client_ip=client_ip,
            installation_id=installation_id,
            request_id=request_id,
            timestamp=timestamp,
        )
        logger.log(level, message)

        return response
