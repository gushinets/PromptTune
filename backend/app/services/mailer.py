"""SMTP transport; codes never leave the server except in the verification email."""

import asyncio
import smtplib
import ssl
from email.message import EmailMessage

from email_validator import validate_email

from app.config import settings


def _send(email: str, code: str) -> None:
    if not settings.smtp_host or not settings.smtp_from:
        raise RuntimeError("SMTP is not configured")
    message = EmailMessage()
    message["Subject"] = "PromptOptimizer — код подтверждения email"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(
        f"Код подтверждения PromptOptimizer: {code}\n\n"
        "Введите его в расширении в течение 10 минут, чтобы получить 50 улучшений.\n"
        "Если вы не запрашивали код, проигнорируйте это письмо."
    )
    context = ssl.create_default_context()
    transport = smtplib.SMTP_SSL if settings.smtp_ssl else smtplib.SMTP
    kwargs = {"context": context} if settings.smtp_ssl else {}
    with transport(settings.smtp_host, settings.smtp_port, timeout=15, **kwargs) as smtp:
        if not settings.smtp_ssl:
            if not settings.smtp_starttls:
                raise RuntimeError("SMTP TLS is required")
            smtp.starttls(context=context)
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        recipient = validate_email(email, check_deliverability=False)
        smtp.send_message(message, to_addrs=[recipient.ascii_email or recipient.normalized])


async def send_verification_email(email: str, code: str) -> None:
    await asyncio.to_thread(_send, email, code)
