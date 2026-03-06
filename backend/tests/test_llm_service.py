from app.services.llm import _normalize_response


def test_strips_prefix():
    assert _normalize_response("Here's the improved prompt: better text") == "better text"
    assert _normalize_response("Improved prompt: better text") == "better text"


def test_strips_quotes():
    assert _normalize_response('"quoted response"') == "quoted response"
    assert _normalize_response("'single quoted'") == "single quoted"


def test_preserves_clean_response():
    assert _normalize_response("already clean") == "already clean"


def test_strips_whitespace():
    assert _normalize_response("  padded  ") == "padded"
