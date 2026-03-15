import pytest
from httpx import AsyncClient


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
