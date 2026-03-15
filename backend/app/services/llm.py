import re
import time

import litellm

from app.config import settings

SYSTEM_PROMPT = """You are an expert prompt engineer. Your task is to improve the user's prompt
to make it clearer, more specific, and more effective for AI assistants.

Rules:
- Return ONLY the improved prompt text, nothing else
- Do not add explanations, prefixes like "Here's the improved prompt:", or meta-commentary
- Preserve the original intent and language of the prompt
- Make the prompt more specific, structured, and actionable
- If the prompt is already good, make minimal improvements"""

# Patterns to strip from LLM responses that add unwanted prefixes
STRIP_PATTERNS = [
    re.compile(r"^(Here'?s?\s+(the\s+)?improved\s+prompt:?\s*)", re.IGNORECASE),
    re.compile(r"^(Improved\s+prompt:?\s*)", re.IGNORECASE),
]


def _normalize_response(text: str) -> str:
    text = text.strip()
    for pattern in STRIP_PATTERNS:
        text = pattern.sub("", text)
    return text.strip().strip('"').strip("'")


async def improve_text(text: str) -> tuple[str, str, int]:
    """Call LLM to improve the prompt text.

    Returns: (improved_text, model_used, latency_ms)
    """
    start = time.monotonic()

    response = await litellm.acompletion(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        max_tokens=2048,
        temperature=0.7,
    )

    latency_ms = int((time.monotonic() - start) * 1000)
    raw = response.choices[0].message.content or ""
    improved = _normalize_response(raw)
    model_used = response.model or settings.llm_model

    return improved, model_used, latency_ms
