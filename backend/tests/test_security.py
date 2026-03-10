from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.security.redaction import redact_secrets
from app.services.errors import UpstreamAuthError, UpstreamRateLimitError
from app.services.prompt_service import PromptService


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

    with patch(
        "app.services.prompt_service.improve_text",
        new=AsyncMock(side_effect=UpstreamAuthError("Provider rejected API key: sk-or-v1-secret123")),
    ):
        with pytest.raises(UpstreamAuthError):
            await service.improve_prompt(
                text="hello",
                installation_id="inst-1",
                api_key="sk-or-v1-secret123",
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

    with patch(
        "app.services.prompt_service.improve_text",
        new=AsyncMock(side_effect=RuntimeError("Bearer sk-or-v1-secret123 exploded")),
    ):
        with pytest.raises(RuntimeError):
            await service.improve_prompt(
                text="hello",
                installation_id="inst-1",
                api_key="sk-or-v1-secret123",
            )

    record = db.add.call_args.args[0]
    assert record.error == "INTERNAL_ERROR"
    db.commit.assert_awaited()


def test_upstream_error_codes_are_stable():
    assert UpstreamAuthError.error_code == "UPSTREAM_AUTH_ERROR"
    assert UpstreamRateLimitError.error_code == "UPSTREAM_RATE_LIMIT"
