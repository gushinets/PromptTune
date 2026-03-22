import re

_AUTH_HEADER_RE = re.compile(r"(?i)(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;]+")
_BEARER_RE = re.compile(r"(?i)bearer\s+[^\s,;]+")
_SK_KEY_RE = re.compile(r"\bsk(?:-or-v1|-proj)?-[A-Za-z0-9_-]+\b")


def redact_secrets(text: str | None) -> str | None:
    if text is None:
        return None

    redacted = _AUTH_HEADER_RE.sub(r"\1[REDACTED]", text)
    redacted = _BEARER_RE.sub("Bearer [REDACTED]", redacted)
    redacted = _SK_KEY_RE.sub("[REDACTED]", redacted)
    return redacted
