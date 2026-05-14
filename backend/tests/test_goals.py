from app.goals import normalize_goal_selection


def test_normalize_defaults_to_ai_general():
    mode, goal = normalize_goal_selection(None, None)
    assert mode == "ai"
    assert goal == "general"


def test_normalize_infers_content_mode_from_goal():
    mode, goal = normalize_goal_selection(None, "seo_article")
    assert mode == "content"
    assert goal == "seo_article"


def test_normalize_maps_legacy_goal():
    mode, goal = normalize_goal_selection(None, "structure")
    assert mode == "ai"
    assert goal == "structured"
