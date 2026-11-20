import smtplib

import pytest

from app.config import settings
from app.services.mailer import _send


@pytest.mark.parametrize(
    ("address", "envelope", "smtp_utf8"),
    [
        ("user@bücher.de", "user@xn--bcher-kva.de", False),
        ("user@xn--bcher-kva.de", "user@xn--bcher-kva.de", False),
        ("user@example.com", "user@example.com", False),
        ("почта@example.com", "почта@example.com", True),
    ],
)
def test_smtp_wire_header_and_envelope_share_the_transport_address(
    monkeypatch, address, envelope, smtp_utf8
):
    delivered = []

    class SMTPTransport(smtplib.SMTP):
        def __init__(self, *args, **kwargs):
            pass

        def __exit__(self, *args):
            return False

        def starttls(self, **kwargs):
            pass

        def ehlo_or_helo_if_needed(self):
            pass

        def has_extn(self, name):
            return name == "smtputf8" and smtp_utf8

        def sendmail(self, from_addr, to_addrs, message, mail_options=(), rcpt_options=()):
            delivered.append((from_addr, to_addrs, message, mail_options))
            return {}

    monkeypatch.setattr(settings, "smtp_host", "mail.example.com")
    monkeypatch.setattr(settings, "smtp_from", "PromptOptimizer <verify@example.com>")
    monkeypatch.setattr(settings, "smtp_ssl", False)
    monkeypatch.setattr(settings, "smtp_starttls", True)
    monkeypatch.setattr(settings, "smtp_username", None)
    monkeypatch.setattr(smtplib, "SMTP", SMTPTransport)

    _send(address, "123456")

    assert len(delivered) == 1
    assert delivered[0][1] == [envelope]
    wire_to = next(line for line in delivered[0][2].split(b"\r\n") if line.startswith(b"To:"))
    assert wire_to == b"To: " + envelope.encode("utf-8")
    assert ("SMTPUTF8" in delivered[0][3]) is smtp_utf8
    from email import policy
    from email.parser import BytesParser

    message = BytesParser(policy=policy.default).parsebytes(delivered[0][2])
    assert str(message["To"]) == envelope
    assert "123456" in message.get_content()
