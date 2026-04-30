from app.api.schemas import ImproveGoal

FALLBACK_LINES = [
    "Made the goal and expected result more explicit.",
    "Improved wording for clearer, more reliable execution.",
    "Preserved the original intent while tightening the instructions.",
]

GOAL_LINES: dict[ImproveGoal, str] = {
    "general": "Balanced clarity, specificity, and structure without changing intent.",
    "clarity": "Reduced ambiguity so the task is easier for the model to interpret correctly.",
    "structure": "Reorganized instructions into a clearer, more scannable structure.",
    "concise": "Removed redundant wording to keep the request focused and efficient.",
    "persuasive": "Strengthened phrasing to make the prompt more convincing and goal-oriented.",
}


def build_improvement_changes(
    original_text: str,
    improved_text: str,
    goal: ImproveGoal | None = None,
) -> list[str]:
    lines: list[str] = []
    goal_key = goal or "general"
    lines.append(GOAL_LINES[goal_key])

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
