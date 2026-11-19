async def test_limits_returns_server_quota_without_reserving(client, mock_db, mock_redis):
    response = await client.get("/v1/limits", params={"installation_id": "test-inst-1"})
    assert response.status_code == 200
    assert response.json()["remaining"] == 49
    assert response.json()["total"] == 50
    assert response.json()["bonus_claimed"] is False
    mock_db.quota_reserve.assert_not_awaited()
