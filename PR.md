# Pull Request: LiteLLM integration

## Summary
This change integrates LiteLLM as the single async LLM call path for prompt improvements. It centralizes model/provider selection, captures token usage + latency, logs usage to a local file, and persists token/provider metadata in the database.

## How it works
1. `/v1/improve` still enforces rate limiting first via `PromptService.check_rate_limit`.
2. `PromptService.improve_prompt` calls the unified LLM entry point:
   - `backend/app/services/llm.py` → `LiteLLMClient.improve_text(...)`
3. `LiteLLMClient`:
   - builds the request using the existing `SYSTEM_PROMPT`
   - calls LiteLLM using `litellm.acompletion` (async)
   - extracts:
     - improved text (`choices[0].message.content`)
     - model and usage tokens (`prompt_tokens`, `completion_tokens`, `total_tokens`)
     - provider (best-effort, inferred from LiteLLM hidden params / model prefix)
     - latency (wall clock)
   - logs a single structured line (without any API keys)
4. Persistence:
   - `PromptImprovement.llm_meta` is added and populated on success with the token/provider/latency metadata.

## Key changes
- Unified LiteLLM client: `backend/app/services/llm.py`
- Config additions: `backend/app/config.py`, `backend/.env.example`
- DB + migrations:
  - `backend/app/db/models.py`
  - `backend/app/services/prompt_service.py`
  - `backend/alembic/versions/003_add_llm_meta.py`
  - `backend/alembic/versions/004_ensure_llm_meta_if_missing.py` (idempotent safeguard)
- Tests:
  - `backend/tests/conftest.py`
  - `backend/tests/test_llm_service.py`
  - `backend/tests/test_health.py`

## Logs
LiteLLM usage lines are written to:
`backend/app/services/logs/litellm.log`

## How to test
1. Apply migrations:
   - `cd backend`
   - `.\venv\Scripts\python.exe -m alembic upgrade head`
2. Run unit tests:
   - `cd backend`
   - `.\venv\Scripts\python.exe -m pytest -q`

The test run in this environment completed successfully with `29 passed`.

