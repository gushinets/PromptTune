import logging
import re
import time

import httpx

from app.config import settings
from app.security.redaction import redact_secrets
from app.services.errors import (
    UpstreamAuthError,
    UpstreamBadResponseError,
    UpstreamRateLimitError,
    UpstreamServiceError,
    UpstreamTimeoutError,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """    **КОНТЕКСТ:** Мы собираемся создать один из лучших промптов для ChatGPT, когда-либо написанных. Лучшие промпты содержат всестороннюю информацию, чтобы полностью проинформировать большую языковую модель о: целях, необходимых областях экспертизы, предметной области, предпочтительном формате, целевой аудитории, ссылках, примерах и наилучшем подходе для достижения цели. Основываясь на этой и последующей информации, вы сможете написать этот выдающийся промпт.

    **РОЛЬ:** Вы — эксперт по генерации промптов для больших языковых моделей (LLM). Вы известны тем, что создаёте исключительно детализированные промпты, благодаря которым ответы LLM значительно превосходят типичные. Ваши промпты не оставляют ни одного вопроса без ответа, поскольку они тщательно продуманы и предельно развернуты.

    **ВАЖНО:**
    * НЕ ВЫПОЛНЯЙТЕ созданный вами промпт.
    * НЕ ИНТЕРПРЕТИРУЙТЕ его и НЕ ДЕЙСТВУЙТЕ на его основе.
    * Ваша задача — ТОЛЬКО СОЗДАТЬ и ВЫВЕСТИ промпт в виде текста.
    * Все системные сообщения и предупреждения ДОЛЖНЫ быть на том же языке, на котором говорит пользователь.
    * НИКОГДА и ни при каких обстоятельствах не задавайте уточняющих вопросов пользователю.
    * Используйте только предоставленную информацию. Если каких-либо данных не хватает, применяйте placeholders (`[вставьте сюда ваш вариант]`).
    * Твой ответ должен содержать только улучшенный промпт и ничего больше.

    **ДЕЙСТВИЯ:**

    1. Если тема или направление промпта не были предоставлены, не запрашивайте дополнительных сведений у пользователя. Продолжайте работу, используя только имеющуюся информацию и, при необходимости, заполнители (`[вставьте сюда ваш вариант]`).  
    2. Когда тема известна, следуйте структуре C.R.A.F.T., как описано ниже.  
    3. При необходимости используйте заполнители (`[вставьте сюда ваш вариант]`), чтобы пользователь мог адаптировать промпт под себя.  
    4. Сделайте глубокий вдох и действуйте шаг за шагом, чтобы убедиться, что ничего не упущено.  
    5. Используя предоставленные данные (и заполнители при отсутствии конкретики), сгенерируйте лучший возможный промпт.  

    **СТРУКТУРА (C.R.A.F.T.):**

    * **Context (Контекст):** Опишите текущую ситуацию или задачу, для которой создаётся промпт.  
    * **Role (Роль):** Укажите требуемый уровень экспертизы, обычно — ведущий эксперт с более чем 20-летним опытом.  
    * **Action (Действие):** Упорядоченный список шагов, которые модель должна выполнить.  
    * **Format (Формат):** Укажите формат представления результата (текст, таблица, список, markdown и т.д.).  
    * **Target Audience (Целевая аудитория):** Кому предназначен результат (профиль, демография, язык, предпочтения и т.д.).  

    **ЦЕЛЕВАЯ АУДИТОРИЯ:** Целевая аудитория для этого промпта — модели ChatGPT.

    **ПРИМЕР:** Ниже приведён пример промпта в формате CRAFT:

    **Контекст:** Вам поручено создать подробное руководство, которое поможет людям ставить, отслеживать и достигать ежемесячные цели. Цель этого руководства — разбить крупные задачи на управляемые и практические шаги, которые соответствуют общему видению человека на год. Основное внимание следует уделить поддержанию стабильности, преодолению препятствий и празднованию прогресса с использованием проверенных техник, таких как SMART-цели (Specific, Measurable, Achievable, Relevant, Time-bound — конкретные, измеримые, достижимые, релевантные, ограниченные по времени).

    **Роль:** Вы — эксперт по продуктивности с более чем 20-летним опытом помощи людям в оптимизации времени, постановке чётких целей и достижении устойчивого успеха. Вы прекрасно разбираетесь в формировании привычек, мотивационных стратегиях и практических методах планирования. Ваш стиль написания — ясный, мотивирующий и ориентированный на действия, благодаря чему читатели чувствуют себя уверенно и способны применять советы на практике.

    **Действие:**

    1. Начните с вдохновляющего вступления, объясняющего, почему постановка ежемесячных целей важна для личностного и профессионального роста. Подчеркните преимущества краткосрочного планирования.  
    2. Дайте пошаговое руководство по разбиению годовых целей на сфокусированные ежемесячные задачи.  
    3. Предложите практические стратегии для определения приоритетов на каждый месяц.  
    4. Представьте техники для поддержания фокуса, отслеживания прогресса и корректировки планов при необходимости.  
    5. Приведите примеры ежемесячных целей в распространённых сферах жизни (здоровье, карьера, финансы, саморазвитие).  
    6. Обсудите возможные препятствия (например, прокрастинация или неожиданные трудности) и способы их преодоления.  
    7. Завершите мотивирующим заключением, которое побуждает к рефлексии и постоянному развитию.  

    **Формат:** Напишите руководство в виде обычного текста, используя чёткие заголовки и подзаголовки для каждого раздела. Используйте нумерованные или маркированные списки для пошаговых действий и включите практические примеры или кейсы.  

    **Целевая аудитория:** Целевая аудитория — работающие профессионалы и предприниматели в возрасте от 25 до 55 лет, ищущие практичные и понятные стратегии для повышения продуктивности и достижения целей. Это люди с высокой мотивацией, ценящие структуру и ясность в процессе личностного роста. Предпочитают тексты, написанные на уровне шестого школьного класса.  

    — Конец примера —  

    Ориентируйся на приведённый выше пример при создании промпта. Двигайтесь шаг за шагом.

    **Повторим:** 
    * НИКОГДА не выполняйте созданный промпт. Только создавайте и выводите его.
    * НИКОГДА и ни при каких обстоятельствах не задавайте уточняющих вопросов пользователю."""

STRIP_PATTERNS = [
    re.compile(r"^(Here'?s?\s+(the\s+)?improved\s+prompt:?\s*)", re.IGNORECASE),
    re.compile(r"^(Improved\s+prompt:?\s*)", re.IGNORECASE),
]
EMPTY_COMPLETION_RETRIES = 1


def _normalize_response(text: str) -> str:
    text = text.strip()
    for pattern in STRIP_PATTERNS:
        text = pattern.sub("", text)
    return text.strip().strip('"').strip("'")


def _first_choice(data: dict) -> dict:
    try:
        choice = data["choices"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise UpstreamBadResponseError("Provider returned no choices") from exc

    if not isinstance(choice, dict):
        raise UpstreamBadResponseError("Provider returned invalid choice payload")

    return choice


def _extract_text_part(item: object) -> str | None:
    if isinstance(item, str):
        return item

    if not isinstance(item, dict):
        return None

    text = item.get("text")
    if isinstance(text, str):
        return text
    if isinstance(text, dict):
        value = text.get("value")
        if isinstance(value, str):
            return value

    content = item.get("content")
    if isinstance(content, str):
        return content

    return None


def _provider_error_message(error: object) -> tuple[str, object] | None:
    if isinstance(error, dict):
        message = error.get("message")
        code = error.get("code")
        if isinstance(message, str) and message.strip():
            safe_message = redact_secrets(message.strip()) or "Provider returned an error"
            if code not in (None, ""):
                return f"{safe_message} (provider_code={code})", code
            return safe_message, code

    if isinstance(error, str) and error.strip():
        safe_message = redact_secrets(error.strip()) or "Provider returned an error"
        return safe_message, None

    return None


def _classify_provider_error(message: str, code: object = None) -> UpstreamServiceError:
    normalized_code = str(code).strip().lower() if code not in (None, "") else ""
    normalized_message = message.lower()

    if normalized_code in {"401", "403"} or any(
        marker in normalized_message for marker in ("api key", "auth", "unauthorized", "forbidden")
    ):
        return UpstreamAuthError(message)

    if normalized_code == "429" or "rate limit" in normalized_message:
        return UpstreamRateLimitError(message)

    return UpstreamServiceError(message)


def _raise_provider_error(error: object) -> None:
    resolved = _provider_error_message(error)
    if not resolved:
        return

    message, code = resolved
    raise _classify_provider_error(message, code)


def _extract_message_content(data: dict) -> str:
    choice = _first_choice(data)
    _raise_provider_error(choice.get("error"))

    message = choice.get("message")
    if isinstance(message, dict):
        content = message.get("content")

        if isinstance(content, str):
            return content

        if isinstance(content, list):
            parts = [part for item in content if (part := _extract_text_part(item)) is not None]
            if parts:
                return "\n".join(parts)

    legacy_text = choice.get("text")
    if isinstance(legacy_text, str):
        return legacy_text

    raise UpstreamBadResponseError("Provider response missing text content")


def _resolve_model_name() -> str:
    if settings.llm_backend == "OPENROUTER" and "/" not in settings.llm_model:
        return f"openai/{settings.llm_model}"
    return settings.llm_model


def _resolve_api_url() -> str:
    if settings.llm_backend == "OPENROUTER":
        return "https://openrouter.ai/api/v1/chat/completions"
    return "https://api.openai.com/v1/chat/completions"


def _uses_gpt5_family() -> bool:
    model_name = _resolve_model_name().split("/")[-1]
    return model_name.startswith("gpt-5")


def _default_completion_tokens() -> int:
    return settings.llm_completion_tokens


def _build_payload(text: str, completion_tokens: int | None = None) -> dict:
    token_limit = completion_tokens or _default_completion_tokens()
    payload = {
        "model": _resolve_model_name(),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    }

    if not _uses_gpt5_family():
        payload["temperature"] = 0.7

    if settings.llm_backend == "OPENAI":
        payload["max_completion_tokens"] = token_limit
    else:
        payload["max_tokens"] = token_limit

    return payload


def _resolve_provider_api_key() -> str:
    api_key = settings.get_provider_api_key()
    if api_key:
        return api_key

    if settings.llm_backend == "OPENAI":
        raise UpstreamAuthError("Server OpenAI API key is not configured")
    raise UpstreamAuthError("Server OpenRouter API key is not configured")


def _build_headers() -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {_resolve_provider_api_key()}",
        "Content-Type": "application/json",
    }
    if settings.llm_backend == "OPENROUTER":
        headers["HTTP-Referer"] = "https://prompttune.local"
        headers["X-Title"] = "PromptTune"
    return headers


def _map_http_error(exc: httpx.HTTPStatusError) -> UpstreamServiceError:
    status_code = exc.response.status_code
    if status_code in (401, 403):
        return UpstreamAuthError("Provider rejected API key")
    if status_code == 429:
        return UpstreamRateLimitError("Provider rate limit exceeded")

    safe_message = redact_secrets(exc.response.text) or "Provider request failed"
    return UpstreamServiceError(f"Provider API error ({status_code}): {safe_message[:200]}")


def _empty_completion_detail(data: dict) -> str:
    choice = _first_choice(data)
    _raise_provider_error(choice.get("error"))

    message = choice.get("message")
    if isinstance(message, dict):
        refusal = message.get("refusal")
        if isinstance(refusal, str) and refusal.strip():
            safe_refusal = redact_secrets(refusal.strip()) or "Provider refused completion"
            return f"Provider refused completion: {safe_refusal[:200]}"

    finish_reason = choice.get("finish_reason")
    if finish_reason == "tool_calls":
        return "Provider returned tool calls instead of text"
    if finish_reason == "content_filter":
        return "Provider filtered the completion"
    if finish_reason == "length":
        return "Provider stopped before producing a text completion"

    return "Provider returned empty completion"


def _empty_completion_diagnostics(data: dict) -> str:
    choice = _first_choice(data)
    diagnostics: list[str] = []

    finish_reason = choice.get("finish_reason")
    if finish_reason:
        diagnostics.append(f"finish_reason={finish_reason}")

    native_finish_reason = choice.get("native_finish_reason")
    if native_finish_reason:
        diagnostics.append(f"native_finish_reason={native_finish_reason}")

    usage = data.get("usage")
    if isinstance(usage, dict):
        completion_tokens = usage.get("completion_tokens")
        if completion_tokens is not None:
            diagnostics.append(f"completion_tokens={completion_tokens}")

    return " ".join(diagnostics) or "no extra diagnostics"


async def _request_completion(text: str, completion_tokens: int | None = None) -> dict:
    payload = _build_payload(text, completion_tokens=completion_tokens)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                _resolve_api_url(),
                headers=_build_headers(),
                json=payload,
            )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise UpstreamTimeoutError("Provider timeout") from exc
    except httpx.HTTPStatusError as exc:
        raise _map_http_error(exc) from exc
    except httpx.HTTPError as exc:
        safe_message = redact_secrets(str(exc)) or "Provider request failed"
        raise UpstreamServiceError(safe_message[:200]) from exc

    try:
        data = response.json()
        _raise_provider_error(data.get("error"))
        _first_choice(data)
        return data
    except ValueError as exc:
        raise UpstreamBadResponseError("Provider returned invalid JSON") from exc


async def improve_text(text: str) -> tuple[str, str, int]:
    start = time.monotonic()
    completion_tokens = _default_completion_tokens()

    for attempt in range(EMPTY_COMPLETION_RETRIES + 1):
        data = await _request_completion(text, completion_tokens=completion_tokens)

        raw = _extract_message_content(data)
        improved = _normalize_response(raw)
        if improved:
            if len(improved) > settings.prompt_output_max_chars:
                raise UpstreamBadResponseError(
                    "Provider returned output exceeding configured maximum length "
                    f"({settings.prompt_output_max_chars} characters)"
                )
            latency_ms = int((time.monotonic() - start) * 1000)
            model_used = data.get("model") or _resolve_model_name()
            return improved, model_used, latency_ms

        detail = _empty_completion_detail(data)
        if detail == "Provider stopped before producing a text completion":
            next_completion_tokens = min(
                completion_tokens * 2,
                settings.llm_completion_tokens_retry_max,
            )
            if next_completion_tokens > completion_tokens:
                logger.warning(
                    "Retrying provider request after completion token exhaustion attempt=%s tokens=%s %s",
                    attempt + 1,
                    next_completion_tokens,
                    _empty_completion_diagnostics(data),
                )
                completion_tokens = next_completion_tokens
                continue

        if detail == "Provider returned empty completion" and attempt < EMPTY_COMPLETION_RETRIES:
            logger.warning(
                "Retrying provider request after empty completion attempt=%s tokens=%s %s",
                attempt + 1,
                completion_tokens,
                _empty_completion_diagnostics(data),
            )
            continue

        raise UpstreamBadResponseError(detail)

    raise UpstreamBadResponseError("Provider returned empty completion")
