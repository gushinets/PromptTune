import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("prompttune.access")


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start = time.monotonic()
        request_id = getattr(request.state, "request_id", "-")
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception:
            logger.exception(
                "%s %s %s req_id=%s",
                request.method,
                request.url.path,
                "unhandled_error",
                request_id,
            )
            raise
        finally:
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.info(
                "%s %s %s %dms req_id=%s",
                request.method,
                request.url.path,
                status_code,
                latency_ms,
                request_id,
            )
