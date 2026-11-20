from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException


async def test_email_proof_and_global_deduplication(quota_sessions):
    from app.services.email_bonus import EmailBonusService
    from app.services.quota import QuotaService

    sent = []

    async def send(email, code):
        sent.append((email, code))

    async with quota_sessions() as db:
        service = EmailBonusService(db, sender=send, secret="test-secret")
        await service.request("a", " Person@Example.COM ")
        assert (await QuotaService(db).status("a")).remaining == 50
        with pytest.raises(HTTPException):
            await service.confirm("a", "000000" if sent[-1][1] != "000000" else "111111")
        info = await service.confirm("a", sent[-1][1])
        assert info.remaining == 100 and info.email_verified and info.bonus_claimed
        assert (await service.confirm("a", sent[-1][1])).remaining == 100
        await service.request("reinstalled", "person@example.com")
        info = await service.confirm("reinstalled", sent[-1][1])
        assert info.remaining == 50 and info.bonus_claimed
        with pytest.raises(HTTPException):
            await service.request("a", "other@example.com")


async def test_unicode_equivalent_emails_share_one_bonus_across_installations(quota_sessions):
    from sqlalchemy import select

    from app.db.models import EmailBonusClaim
    from app.services.email_bonus import EmailBonusService

    sent = []

    async def send(email, code):
        sent.append((email, code))

    async with quota_sessions() as db:
        service = EmailBonusService(db, sender=send, secret="secret")
        await service.request("first", "J\u030c@example.com")
        first = await service.confirm("first", sent[-1][1])
        await service.request("reinstalled", "\u01f0@example.com")
        second = await service.confirm("reinstalled", sent[-1][1])
        assert first.remaining == 100
        assert second.remaining == 50
        assert second.email_bonus_outcome == "already_claimed"
        assert [email for email, _ in sent] == ["\u01f0@example.com", "\u01f0@example.com"]
        assert list((await db.scalars(select(EmailBonusClaim.email))).all()) == [
            "\u01f0@example.com"
        ]


async def test_expired_code_resend_guess_limits_and_delivery_failure(quota_sessions):
    from app.services.email_bonus import EmailBonusService
    from app.services.quota import QuotaService

    sent = []

    async def send(email, code):
        sent.append(code)

    clock = [datetime(2028, 1, 1, tzinfo=UTC)]
    async with quota_sessions() as db:
        service = EmailBonusService(db, sender=send, secret="secret", now=lambda: clock[0])
        with pytest.raises(HTTPException):
            await service.request("a", "not-an-email")
        await service.request("a", "a@example.com")
        with pytest.raises(HTTPException) as cooldown:
            await service.request("a", "a@example.com")
        assert cooldown.value.status_code == 429
        old = sent[-1]
        clock[0] += timedelta(minutes=11)
        with pytest.raises(HTTPException):
            await service.confirm("a", old)
        await service.request("a", "a@example.com")
        for _ in range(5):
            with pytest.raises(HTTPException):
                await service.confirm("a", "wrong")
        with pytest.raises(HTTPException):
            await service.confirm("a", sent[-1])
        assert (await QuotaService(db, now=lambda: clock[0]).status("a")).remaining == 50

        async def fail(email, code):
            raise OSError("SMTP failed")

        clock[0] += timedelta(minutes=2)
        service.sender = fail
        with pytest.raises(HTTPException) as failure:
            await service.request("a", "a@example.com")
        assert failure.value.status_code == 503
        with pytest.raises(HTTPException):
            await service.confirm("a", sent[-1])


async def test_renewal_preserves_claim_and_discards_bonus(quota_sessions):
    from app.services.email_bonus import EmailBonusService
    from app.services.quota import QuotaService

    clock = [datetime(2028, 1, 10, tzinfo=UTC)]
    sent = []

    async def send(email, code):
        sent.append(code)

    async with quota_sessions() as db:
        service = EmailBonusService(db, sender=send, secret="secret", now=lambda: clock[0])
        await service.request("a", "a@example.com")
        await service.confirm("a", sent[-1])
        clock[0] = datetime(2028, 2, 10, tzinfo=UTC)
        info = await QuotaService(db, now=lambda: clock[0]).status("a")
        assert info.remaining == info.total == 50
        assert info.bonus_claimed and info.email_verified


async def test_concurrent_claims_credit_email_once_across_installations(quota_sessions):
    import asyncio

    from app.services.email_bonus import EmailBonusService

    codes = {}

    async def send(email, code):
        codes[email] = code

    # Capture each code separately because the same address has two challenges.
    proof = {}
    for installation in ("one", "two"):
        async with quota_sessions() as db:
            await EmailBonusService(db, sender=send, secret="secret").request(
                installation, "same@example.com"
            )
            proof[installation] = codes["same@example.com"]

    async def confirm(installation):
        async with quota_sessions() as db:
            return await EmailBonusService(db, secret="secret").confirm(
                installation, proof[installation]
            )

    info = await asyncio.gather(confirm("one"), confirm("two"), confirm("one"))
    assert sorted([info[0].remaining, info[1].remaining]) == [50, 100]
    assert info[0].remaining == info[2].remaining


async def test_resend_invalidates_previous_proof(quota_sessions):
    from app.services.email_bonus import EmailBonusService

    clock = [datetime(2028, 1, 1, tzinfo=UTC)]
    sent = []

    async def send(email, code):
        sent.append(code)

    async with quota_sessions() as db:
        service = EmailBonusService(db, sender=send, secret="secret", now=lambda: clock[0])
        await service.request("a", "first@example.com")
        clock[0] += timedelta(seconds=61)
        await service.request("a", "second@example.com")
        with pytest.raises(HTTPException):
            await service.confirm("a", sent[0])
        assert (await service.confirm("a", sent[1])).remaining == 100


async def test_bonus_waiting_for_lock_is_credited_in_new_month(quota_sessions):
    import asyncio

    from app.services.email_bonus import EmailBonusService
    from app.services.quota import QuotaService

    clock = [datetime(2028, 1, 10, tzinfo=UTC)]
    proof = []

    async def send(email, code):
        proof.append(code)

    # Request proof just before the February renewal so it remains valid across midnight.
    async with quota_sessions() as db:
        await QuotaService(db, now=lambda: clock[0]).status("midnight")
        clock[0] = datetime(2028, 2, 9, 20, 59, 59, tzinfo=UTC)
        await EmailBonusService(db, sender=send, secret="secret", now=lambda: clock[0]).request(
            "midnight", "midnight@example.com"
        )
    sampled = asyncio.Event()

    def queued_now():
        sampled.set()
        return clock[0]

    async with quota_sessions() as holder, quota_sessions() as waiter:
        await QuotaService(holder, now=lambda: clock[0]).locked("midnight")
        pending = asyncio.create_task(
            EmailBonusService(waiter, secret="secret", now=queued_now).confirm("midnight", proof[0])
        )
        await sampled.wait()
        clock[0] = datetime(2028, 2, 9, 21, tzinfo=UTC)
        await holder.commit()
        await pending
        info = await QuotaService(waiter, now=lambda: clock[0]).status("midnight")
        assert info.remaining == 100


async def test_reinstalled_email_confirmation_reports_already_claimed_without_credit(
    quota_sessions,
):
    from app.services.email_bonus import EmailBonusService

    proof = []

    async def send(email, code):
        proof.append(code)

    async with quota_sessions() as db:
        service = EmailBonusService(db, sender=send, secret="secret")
        await service.request("original", "claimed@example.com")
        awarded = await service.confirm("original", proof[-1])
        assert awarded.email_bonus_outcome == "awarded"
        await service.request("reinstalled", "claimed@example.com")
        reused = await service.confirm("reinstalled", proof[-1])
        assert reused.remaining == 50
        assert reused.email_bonus_outcome == "already_claimed"
        assert (
            await service.confirm("reinstalled", proof[-1])
        ).email_bonus_outcome == "already_claimed"
