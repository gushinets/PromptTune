from app.goals import AudienceMode, CanonicalGoal

FALLBACK_LINES = [
    "Made the goal and expected result more explicit.",
    "Improved wording for clearer, more reliable execution.",
    "Preserved the original intent while tightening the instructions.",
]

GOAL_LINES: dict[tuple[AudienceMode, CanonicalGoal], str] = {
    ("ai", "general"): "Balanced clarity, specificity, and structure without changing intent.",
    ("ai", "chatgpt"): "Adjusted wording for ChatGPT-style instruction following and response quality.",
    ("ai", "claude"): "Adjusted wording for Claude-style long-context reasoning and safer framing.",
    ("ai", "perplexity"): "Adjusted wording for web-grounded answers with stronger source expectations.",
    ("ai", "structured"): "Reshaped the prompt toward predictable structured output.",
    ("ai", "deep_research"): "Expanded scope and rigor for deeper research-style responses.",
    ("content", "general"): "Balanced clarity and structure for content production tasks.",
    ("content", "seo_article"): "Added SEO-oriented structure with heading and keyword guidance.",
    ("content", "product_description"): "Focused wording on product value, features, and clear CTA.",
    ("content", "ad_copy"): "Tightened the copy around hook, offer, and action-oriented CTA.",
    ("content", "email"): "Improved message flow for concise, actionable email communication.",
    ("content", "landing_page"): "Structured the prompt for offer, value proposition, and proof elements.",
}


def build_improvement_changes(
    original_text: str,
    improved_text: str,
    audience_mode: AudienceMode = "ai",
    goal: CanonicalGoal = "general",
) -> list[str]:
    lines: list[str] = []
    lines.append(GOAL_LINES.get((audience_mode, goal), GOAL_LINES[("ai", "general")]))

    original_word_count = len(original_text.split())
    improved_word_count = len(improved_text.split())

    if "\n" in improved_text and "\n" not in original_text:
        lines.append("Added structure to improve readability and step-by-step execution.")

    if improved_word_count >= original_word_count + 4:
        lines.append("Added concrete context to improve answer precision.")
    elif improved_word_count <= max(0, original_word_count - 4):
        lines.append("Condensed the wording while preserving key constraints.")

    if ":" in improved_text and ":" not in original_text:
        lines.append("Made key constraints more explicit for better output control.")

    for fallback in FALLBACK_LINES:
        if len(lines) >= 3:
            break
        if fallback not in lines:
            lines.append(fallback)

    unique_lines: list[str] = []
    for line in lines:
        clean = line.strip()
        if not clean or clean in unique_lines:
            continue
        unique_lines.append(clean)

    return unique_lines[:5]
