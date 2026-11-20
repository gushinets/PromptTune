from unittest.mock import AsyncMock, patch


async def test_limits_returns_server_quota_without_reserving(client, mock_db, mock_redis):
    response = await client.get("/v1/limits", params={"installation_id": "test-inst-1"})
    assert response.status_code == 200
    assert response.json()["remaining"] == 49
    assert response.json()["total"] == 50
    assert response.json()["bonus_claimed"] is False
    mock_db.quota_reserve.assert_not_awaited()


async def test_limits_throttles_rotating_installation_ids_before_quota_work(
    client, mock_db, mock_redis
):
    counts = {}

    async def increment(_script, _keys, key, _seconds):
        counts[key] = counts.get(key, 0) + 1
        return counts[key]

    mock_redis.eval.side_effect = increment
    with patch("app.api.v1.limits.QuotaService.status", new=AsyncMock()) as status:
        # Reuse the fixture quota while retaining a spy on every status lookup.
        from app.api.schemas import RateLimitInfo

        status.return_value = RateLimitInfo(
            per_day_remaining=50, per_day_total=50, per_minute_remaining=10, per_minute_total=10
        )
        for number in range(60):
            response = await client.get("/v1/limits", params={"installation_id": f"id-{number}"})
            assert response.status_code == 200
        status.reset_mock()
        response = await client.get("/v1/limits", params={"installation_id": "another-id"})
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "60"
        status.assert_not_awaited()
        mock_db.execute.assert_not_awaited()


async def test_recipient_throttle_shares_unicode_equivalent_email_keys(client, mock_db, mock_redis):
    counts = {}

    async def increment(_script, _keys, key, _seconds):
        counts[key] = counts.get(key, 0) + 1
        return counts[key]

    mock_redis.eval.side_effect = increment
    with patch("app.api.v1.limits.EmailBonusService.request", new=AsyncMock()) as request:
        for index in range(6):
            response = await client.post(
                "/v1/email/request",
                json={
                    "installation_id": f"rotating-{index}",
                    "email": "J\u030c@example.com" if index % 2 == 0 else "\u01f0@example.com",
                },
            )
            assert response.status_code == (202 if index < 5 else 429)
        assert request.await_count == 5
        assert all(call.args[1] == "\u01f0@example.com" for call in request.await_args_list)
