# Backend-Owned Configurable Limits

## Summary

- Make the backend the only source of truth for prompt and generation limits.
- Keep `GET /v1/limits` unchanged and quota-only.
- Remove all prompt-length constants from the extension in FastAPI mode.
- Remove the reasoning/non-reasoning token split.
- Use these defaults:
  - `PROMPT_INPUT_MAX_CHARS=8000`
  - `PROMPT_OUTPUT_MAX_CHARS=12000`
  - `LLM_COMPLETION_TOKENS=8192`
  - `LLM_COMPLETION_TOKENS_RETRY_MAX=12288`

## Key Changes

- Backend config:
  - Add the 4 settings above to the main settings object and `.env.example`.
  - Remove old prompt/token constants and old config names instead of preserving compatibility.
  - Validate at startup:
    - all values are positive
    - `LLM_COMPLETION_TOKENS_RETRY_MAX >= LLM_COMPLETION_TOKENS`
- Backend request validation:
  - Remove hardcoded `max_length=8000` from prompt-related API schemas.
  - Enforce limits in backend validation that reads settings at runtime.
  - Return `422` with explicit messages for:
    - improve input over `PROMPT_INPUT_MAX_CHARS`
    - save `original_text` over `PROMPT_INPUT_MAX_CHARS`
    - save `improved_text` over `PROMPT_OUTPUT_MAX_CHARS`
- LLM generation:
  - Replace token constants with `LLM_COMPLETION_TOKENS`.
  - Keep the existing retry-on-`finish_reason=length` behavior, but retry up to `LLM_COMPLETION_TOKENS_RETRY_MAX`.
  - After normalization, reject generated output longer than `PROMPT_OUTPUT_MAX_CHARS` with a clear upstream error.
  - Do not auto-truncate input or output.
- Extension:
  - Remove FastAPI prompt-length enforcement and any related constant.
  - Continue using `GET /v1/limits` only for free-improvement counters.
  - Surface backend `422` validation errors directly in the popup.
  - Leave n8n mode out of scope and unchanged.

## Public Interface Notes

- No new endpoints.
- `GET /v1/limits` remains as-is.
- `/v1/improve` and `/v1/prompts` keep the same request/response shapes.
- The only behavior change is that prompt/output length limits become backend-configured runtime rules instead of hardcoded `8000`.

## Test Plan

- Config tests for new defaults and invalid startup combinations.
- API tests for `/v1/improve` rejecting input over `8000` chars with `422`.
- API tests for `/v1/prompts` rejecting `original_text > 8000` and `improved_text > 12000` with `422`.
- LLM tests proving normal requests use `LLM_COMPLETION_TOKENS` and length retries use `LLM_COMPLETION_TOKENS_RETRY_MAX`.
- LLM test proving oversized normalized output is rejected clearly.
- Extension tests proving FastAPI mode no longer enforces a local max-length constant and correctly shows backend validation errors.
- Regression test confirming `GET /v1/limits` still returns free-improvement counts unchanged.

## Assumptions

- No backward compatibility is needed because nothing has shipped yet.
- No DB migration is needed because prompt text columns are already `TEXT`.
- No warning threshold, live counter, or config-fetch endpoint is needed in this version.
- The simplified token model is intentionally one normal budget plus one retry-only cap.
