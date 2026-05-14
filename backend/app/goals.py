from typing import Literal

AudienceMode = Literal["ai", "content"]

AiGoal = Literal["general", "chatgpt", "claude", "perplexity", "structured", "deep_research"]
ContentGoal = Literal[
    "general",
    "seo_article",
    "product_description",
    "ad_copy",
    "email",
    "landing_page",
]
LegacyGoal = Literal["clarity", "structure", "concise", "persuasive"]

CanonicalGoal = Literal[
    "general",
    "chatgpt",
    "claude",
    "perplexity",
    "structured",
    "deep_research",
    "seo_article",
    "product_description",
    "ad_copy",
    "email",
    "landing_page",
]
ImproveGoal = Literal[
    "general",
    "chatgpt",
    "claude",
    "perplexity",
    "structured",
    "deep_research",
    "seo_article",
    "product_description",
    "ad_copy",
    "email",
    "landing_page",
    "clarity",
    "structure",
    "concise",
    "persuasive",
]

DEFAULT_AUDIENCE_MODE: AudienceMode = "ai"
DEFAULT_GOAL: CanonicalGoal = "general"

AI_GOALS: set[CanonicalGoal] = {
    "general",
    "chatgpt",
    "claude",
    "perplexity",
    "structured",
    "deep_research",
}
CONTENT_GOALS: set[CanonicalGoal] = {
    "general",
    "seo_article",
    "product_description",
    "ad_copy",
    "email",
    "landing_page",
}

_LEGACY_GOAL_FALLBACK: dict[LegacyGoal, CanonicalGoal] = {
    "clarity": "general",
    "structure": "structured",
    "concise": "general",
    "persuasive": "general",
}


def normalize_goal_selection(
    audience_mode: AudienceMode | None,
    goal: ImproveGoal | None,
) -> tuple[AudienceMode, CanonicalGoal]:
    canonical_goal = _to_canonical_goal(goal)

    if audience_mode is None:
        if canonical_goal in CONTENT_GOALS and canonical_goal != "general":
            audience_mode = "content"
        else:
            audience_mode = DEFAULT_AUDIENCE_MODE

    if canonical_goal is None:
        return audience_mode, DEFAULT_GOAL

    if audience_mode == "ai":
        return audience_mode, canonical_goal if canonical_goal in AI_GOALS else DEFAULT_GOAL

    return audience_mode, canonical_goal if canonical_goal in CONTENT_GOALS else DEFAULT_GOAL


def _to_canonical_goal(goal: ImproveGoal | None) -> CanonicalGoal | None:
    if goal is None:
        return None
    if goal in _LEGACY_GOAL_FALLBACK:
        return _LEGACY_GOAL_FALLBACK[goal]
    return goal
