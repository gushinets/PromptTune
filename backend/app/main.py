from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.config import settings
from app.db.session import engine
from app.logging_config import setup_logging
from app.middleware.logging import LoggingMiddleware
from app.middleware.request_id import RequestIdMiddleware
from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
    UpstreamTimeoutError,
)
from app.services.llm import setup_file_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    setup_logging()
    setup_file_logging()
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="PromptTune API",
    version="0.1.0",
    lifespan=lifespan,
)

# Middleware (order matters: outermost first)
app.add_middleware(LoggingMiddleware)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def _upstream_status_code(exc: UpstreamServiceError) -> int:
    if isinstance(exc, UpstreamAuthError):
        return 503
    if isinstance(exc, UpstreamRateLimitError):
        return 429
    if isinstance(exc, UpstreamTimeoutError):
        return 504
    if isinstance(exc, UpstreamBadResponseError):
        return 502
    return 502


@app.exception_handler(UpstreamServiceError)
async def handle_upstream_error(_: Request, exc: UpstreamServiceError) -> JSONResponse:
    return JSONResponse(
        status_code=_upstream_status_code(exc),
        content={
            "detail": str(exc),
            "error_code": exc.error_code,
        },
    )


app.include_router(api_router)
