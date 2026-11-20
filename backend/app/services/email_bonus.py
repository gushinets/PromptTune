import hashlib
import hmac
import secrets
import unicodedata
from collections.abc import Awaitable, Callable
from datetime import timedelta

from email_validator import EmailNotValidError, validate_email
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import insert

from app.config import settings
from app.db.models import EmailBonusClaim
from app.services.mailer import send_verification_email
from app.services.quota import QuotaService


def canonical_email(email: str) -> str:
    """Use one case-insensitive NFC identity for verification, delivery and claims."""
    try:
        normalized = validate_email(email.strip(), check_deliverability=False).normalized
    except EmailNotValidError:
        raise HTTPException(422, "Enter a valid email address") from None
    return unicodedata.normalize("NFC", normalized.lower())


class EmailBonusService(QuotaService):
    def __init__(
        self,
        db,
        sender: Callable[[str, str], Awaitable[None]] | None = None,
        secret: str | None = None,
        now=None,
    ):
        super().__init__(db, now=now)
        self.sender = sender or send_verification_email
        self.secret = secret or settings.email_code_secret

    def digest(self, installation_id: str, email: str, code: str) -> str:
        if not self.secret:
            raise HTTPException(503, "Email verification is not configured")
        return hmac.new(
            self.secret.encode(), f"{installation_id}:{email}:{code}".encode(), hashlib.sha256
        ).hexdigest()

    async def request(self, installation_id: str, email: str) -> None:
        email = canonical_email(email)
        code = f"{secrets.randbelow(1_000_000):06d}"
        digest = self.digest(installation_id, email, code)
        quota = await self.locked(installation_id)
        if quota.bonus_claimed:
            await self.db.commit()
            raise HTTPException(409, "Email bonus has already been claimed")
        now = self.now()
        if quota.challenge_sent_at and now < quota.challenge_sent_at + timedelta(seconds=60):
            await self.db.commit()
            raise HTTPException(429, "Please wait 60 seconds before requesting another code")
        quota.email = email
        quota.email_verified = False
        quota.challenge_digest = digest
        quota.challenge_expires_at = now + timedelta(minutes=10)
        quota.challenge_sent_at = now
        quota.challenge_attempts = 0
        await self.db.commit()
        try:
            await self.sender(email, code)
        except Exception:
            quota = await self.locked(installation_id)
            if quota.challenge_digest == digest:
                quota.challenge_digest = None
                quota.challenge_expires_at = None
            await self.db.commit()
            raise HTTPException(
                503, "Unable to send verification email. Please try again later"
            ) from None

    async def confirm(self, installation_id: str, code: str):
        quota = await self.locked(installation_id)
        if quota.bonus_claimed and quota.email_verified:
            claim = await self.db.get(EmailBonusClaim, quota.email)
            info = await self.info(quota)
            info.email_bonus_outcome = (
                "awarded"
                if claim and claim.installation_id == installation_id
                else "already_claimed"
            )
            await self.db.commit()
            return info
        if (
            not quota.challenge_digest
            or not quota.challenge_expires_at
            or self.now() >= quota.challenge_expires_at
            or quota.challenge_attempts >= 5
        ):
            await self.db.commit()
            raise HTTPException(422, "Code expired or unavailable. Request a new code")
        quota.challenge_attempts += 1
        if not hmac.compare_digest(
            quota.challenge_digest, self.digest(installation_id, quota.email, code.strip())
        ):
            await self.db.commit()
            raise HTTPException(422, "Incorrect verification code")
        result = await self.db.execute(
            insert(EmailBonusClaim)
            .values(
                email=quota.email,
                installation_id=installation_id,
                claimed_at=self.now(),
            )
            .on_conflict_do_nothing(index_elements=["email"])
            .returning(EmailBonusClaim.email)
        )
        credited = result.scalar_one_or_none() is not None
        if credited:
            quota.remaining += 50
            quota.total += 50
        quota.bonus_claimed = True
        quota.email_verified = True
        quota.challenge_digest = None
        quota.challenge_expires_at = None
        info = await self.info(quota)
        info.email_bonus_outcome = "awarded" if credited else "already_claimed"
        await self.db.commit()
        return info
