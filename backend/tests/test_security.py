from unittest.mock import AsyncMock, Mock, patch

import pytest
from httpx import AsyncClient

from app.security.redaction import redact_secrets
from app.services.errors import UpstreamAuthError, UpstreamRateLimitError
from app.services.prompt_service import PromptService

EXTENSION_ORIGIN = "chrome-extension://fbageijibmjblopdbgpdcpkojhnjjbpe"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/v1/improve", "POST"),
        ("/v1/limits", "GET"),
        ("/v1/prompts", "POST"),
        ("/v1/events", "POST"),
    ],
)
async def test_cors_preflight_allows_extension_and_rejects_web_origins(
    client: AsyncClient,
    path: str,
    method: str,
):
    request_headers = {
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "content-type",
    }

    allowed = await client.options(
        path,
        headers={"Origin": EXTENSION_ORIGIN, **request_headers},
    )
    rejected = await client.options(
        path,
        headers={"Origin": "https://unrelated.example", **request_headers},
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == EXTENSION_ORIGIN
    assert method in allowed.headers["access-control-allow-methods"]
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_redact_secrets_masks_api_keys_and_auth_headers():
    text = "Authorization: Bearer sk-or-v1-secret123 and sk-proj-secret456"
    redacted = redact_secrets(text)

    assert "sk-or-v1-secret123" not in redacted
    assert "sk-proj-secret456" not in redacted
    assert "[REDACTED]" in redacted


@pytest.mark.asyncio
async def test_prompt_service_persists_safe_upstream_error_code():
    db = AsyncMock()
    db.add = Mock()
    redis = AsyncMock()
    service = PromptService(db=db, redis=redis)
    service._upsert_installation = AsyncMock()

    with (
        patch(
            "app.services.prompt_service.improve_text",
            new=AsyncMock(
                side_effect=UpstreamAuthError("Provider rejected API key: sk-or-v1-secret123")
            ),
        ),
        pytest.raises(UpstreamAuthError),
    ):
        await service.improve_prompt(
            text="hello",
            installation_id="inst-1",
            client="manual-test",
            client_version="0.1.0",
        )

    record = db.add.call_args.args[0]
    assert record.error == "UPSTREAM_AUTH_ERROR"
    assert "secret123" not in str(record.error)
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_prompt_service_persists_internal_error_without_raw_message():
    db = AsyncMock()
    db.add = Mock()
    redis = AsyncMock()
    service = PromptService(db=db, redis=redis)
    service._upsert_installation = AsyncMock()

    with (
        patch(
            "app.services.prompt_service.improve_text",
            new=AsyncMock(side_effect=RuntimeError("Bearer sk-or-v1-secret123 exploded")),
        ),
        pytest.raises(RuntimeError),
    ):
        await service.improve_prompt(
            text="hello",
            installation_id="inst-1",
        )

    record = db.add.call_args.args[0]
    assert record.error == "INTERNAL_ERROR"
    db.commit.assert_awaited()


def test_upstream_error_codes_are_stable():
    assert UpstreamAuthError.error_code == "UPSTREAM_AUTH_ERROR"
    assert UpstreamRateLimitError.error_code == "UPSTREAM_RATE_LIMIT"
