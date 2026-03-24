import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.asyncio
async def test_save_prompt_persists_record(client: AsyncClient, mock_db):
    response = await client.post(
        "/v1/prompts",
        json={
            "installation_id": "test-inst-1",
            "client": "manual-test",
            "client_version": "0.1.0",
            "original_text": "original",
            "improved_text": "improved",
        },
    )

    assert response.status_code == 200
    assert "prompt_id" in response.json()
    record = mock_db.add.call_args.args[0]
    assert record.installation_id == "test-inst-1"
    assert record.client == "manual-test"
    assert record.client_version == "0.1.0"
    assert record.status == "saved"
    mock_db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_save_prompt_validates_required_fields(client: AsyncClient, mock_db):
    response = await client.post(
        "/v1/prompts",
        json={
            "installation_id": "test-inst-1",
            "original_text": "original",
            "improved_text": "improved",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_save_prompt_rejects_oversized_original_text(client: AsyncClient, mock_db):
    response = await client.post(
        "/v1/prompts",
        json={
            "installation_id": "test-inst-1",
            "client": "manual-test",
            "original_text": "x" * (settings.prompt_input_max_chars + 1),
            "improved_text": "improved",
        },
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": f"original_text exceeds maximum length of {settings.prompt_input_max_chars} characters."
    }
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_save_prompt_rejects_oversized_improved_text(client: AsyncClient, mock_db):
    response = await client.post(
        "/v1/prompts",
        json={
            "installation_id": "test-inst-1",
            "client": "manual-test",
            "original_text": "original",
            "improved_text": "x" * (settings.prompt_output_max_chars + 1),
        },
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": f"improved_text exceeds maximum length of {settings.prompt_output_max_chars} characters."
    }
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_awaited()
