import smtplib

import pytest

from app.config import settings
from app.services.mailer import _send


@pytest.mark.parametrize(
    ("address", "envelope"),
    [
        ("user@bücher.de", "user@xn--bcher-kva.de"),
        ("user@xn--bcher-kva.de", "user@xn--bcher-kva.de"),
        ("user@example.com", "user@example.com"),
    ],
)
def test_smtp_delivery_without_smtputf8_uses_ascii_domain(monkeypatch, address, envelope):
    delivered = []

    class SMTPWithoutUTF8(smtplib.SMTP):
        def __init__(self, *args, **kwargs):
            pass

        def __exit__(self, *args):
            return False

        def starttls(self, **kwargs):
            pass

        def ehlo_or_helo_if_needed(self):
            pass

        def has_extn(self, name):
            return False

        def sendmail(self, from_addr, to_addrs, message, mail_options=(), rcpt_options=()):
            delivered.append((from_addr, to_addrs, message))
            return {}

    monkeypatch.setattr(settings, "smtp_host", "mail.example.com")
    monkeypatch.setattr(settings, "smtp_from", "PromptOptimizer <verify@example.com>")
    monkeypatch.setattr(settings, "smtp_ssl", False)
    monkeypatch.setattr(settings, "smtp_starttls", True)
    monkeypatch.setattr(settings, "smtp_username", None)
    monkeypatch.setattr(smtplib, "SMTP", SMTPWithoutUTF8)

    _send(address, "123456")

    assert len(delivered) == 1
    assert delivered[0][1] == [envelope]
    # The visible To header remains the supplied address; only the envelope changes.
    from email import policy
    from email.parser import BytesParser

    message = BytesParser(policy=policy.default).parsebytes(delivered[0][2])
    assert str(message["To"]) == address
    assert "123456" in message.get_content()
