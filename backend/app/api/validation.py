from fastapi import HTTPException

from app.config import settings


def validate_improve_text_length(text: str) -> None:
    if len(text) <= settings.prompt_input_max_chars:
        return
    raise HTTPException(
        status_code=422,
        detail=(
            f"Input text exceeds maximum length of {settings.prompt_input_max_chars} characters."
        ),
    )


def validate_prompt_save_lengths(original_text: str, improved_text: str) -> None:
    if len(original_text) > settings.prompt_input_max_chars:
        raise HTTPException(
            status_code=422,
            detail=(
                "original_text exceeds maximum length of "
                f"{settings.prompt_input_max_chars} characters."
            ),
        )
    if len(improved_text) > settings.prompt_output_max_chars:
        raise HTTPException(
            status_code=422,
            detail=(
                "improved_text exceeds maximum length of "
                f"{settings.prompt_output_max_chars} characters."
            ),
        )
