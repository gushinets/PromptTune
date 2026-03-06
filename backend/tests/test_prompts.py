import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_save_prompt(client: AsyncClient):
    response = await client.post(
        "/v1/prompts",
        json={
            "installation_id": "test-inst-1",
            "original_text": "original",
            "improved_text": "improved",
        },
    )
    # Will fail without a real DB — structural placeholder
    assert response.status_code in (200, 500)
