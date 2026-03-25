import logging
import re
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from dataclasses import dataclass
from typing import Any

from litellm import acompletion
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    BadRequestError,
    ContentPolicyViolationError,
    ContextWindowExceededError,
    InternalServerError,
    NotFoundError,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
    Timeout as LitellmTimeout,
)

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

# Target path for LiteLLM usage logs (handler is attached by setup_file_logging()).
_LOG_DIR = Path(__file__).resolve().parent / "logs"
_LOG_FILE = _LOG_DIR / "litellm.log"

logger.setLevel(logging.INFO)


def setup_file_logging() -> None:
    """Attach a rotating file handler for this module's logger.

    Safe to call from application startup: does nothing if a matching handler
    already exists; on filesystem errors (e.g. read-only container) logs to
    file are skipped and the process continues.
    """
    _already_added = any(
        isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", None) == str(_LOG_FILE)
        for h in logger.handlers
    )
    if _already_added:
        return
    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        _handler = RotatingFileHandler(
            _LOG_FILE,
            maxBytes=5 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        _handler.setLevel(logging.INFO)
        _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logger.addHandler(_handler)
    except OSError:
        logger.warning("Failed to enable file logging for LiteLLM: %s", exc)


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


@dataclass(frozen=True)
class ImproveLLMResult:
    improved_text: str
    model: str
    provider: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    latency_ms: int
    upstream_id: str | None
    attempt_count: int
    completion_tokens_budget_used: int


def _normalize_response(text: str) -> str:
    text = text.strip()
    for pattern in STRIP_PATTERNS:
        text = pattern.sub("", text)
    return text.strip().strip('"').strip("'")


def _choice_finish_reason(response: object) -> str | None:
    try:
        choices = getattr(response, "choices", None) or []
        if not choices:
            return None
        choice0 = choices[0]
        if isinstance(choice0, dict):
            value = choice0.get("finish_reason")
        else:
            value = getattr(choice0, "finish_reason", None)
        return value if isinstance(value, str) else None
    except Exception:
        return None


def _empty_completion_detail(response: object) -> str:
    reason = (_choice_finish_reason(response) or "").lower()
    if reason in ("length", "max_tokens"):
        return "token_exhaustion"
    return "empty_completion"


def _empty_completion_diagnostics(response: object) -> dict[str, str | None]:
    return {"finish_reason": _choice_finish_reason(response)}


def _should_retry_empty_completion(detail: str, attempt: int, max_attempts: int) -> bool:
    if attempt >= max_attempts:
        return False
    if detail == "token_exhaustion":
        return True
    return attempt <= EMPTY_COMPLETION_RETRIES


def _resolve_model_name(response: object, model_id: str) -> str:
    model_used = getattr(response, "model", None)
    if isinstance(model_used, str) and model_used.strip():
        return model_used
    return model_id


def _resolve_provider_api_key() -> str:
    api_key = settings.get_provider_api_key()
    if api_key:
        return api_key

    if settings.llm_backend == "OPENAI":
        raise UpstreamAuthError("Server OpenAI API key is not configured")
    raise UpstreamAuthError("Server OpenRouter API key is not configured")


def _infer_provider_from_model(model_id: str) -> str | None:
    if "/" in model_id:
        return model_id.split("/", 1)[0].lower() or None
    return None


def _usage_tokens(response: object) -> tuple[int | None, int | None, int | None]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None, None, None
    if isinstance(usage, dict):
        return (
            usage.get("prompt_tokens"),
            usage.get("completion_tokens"),
            usage.get("total_tokens"),
        )
    pt = getattr(usage, "prompt_tokens", None)
    ct = getattr(usage, "completion_tokens", None)
    tt = getattr(usage, "total_tokens", None)
    return pt, ct, tt


def _provider_from_response(response: object, model_id: str) -> str | None:
    hidden = getattr(response, "_hidden_params", None) or {}
    if isinstance(hidden, dict):
        for key in ("custom_llm_provider", "litellm_provider", "api_base"):
            val = hidden.get(key)
            if isinstance(val, str) and val:
                return val.lower()
    return _infer_provider_from_model(model_id)


def _map_litellm_error(exc: BaseException) -> UpstreamServiceError:
    safe_message = redact_secrets(str(exc)) or "Provider request failed"
    lowered = safe_message.lower()
    if "temperature" in lowered and ("not support" in lowered or "unsupported" in lowered):
        logger.error("temperature is not supported for model: %s", safe_message[:200])

    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return UpstreamAuthError("Provider rejected API key")
    if isinstance(exc, RateLimitError):
        return UpstreamRateLimitError("Provider rate limit exceeded")
    if isinstance(exc, (LitellmTimeout, TimeoutError)):
        return UpstreamTimeoutError("Provider timeout")
    if isinstance(exc, APIConnectionError):
        safe = redact_secrets(str(exc)) or "Provider connection failed"
        return UpstreamServiceError(safe[:200])

    if isinstance(exc, OpenAIError):
        status = getattr(exc, "status_code", None)
        if status in (401, 403):
            return UpstreamAuthError("Provider rejected API key")
        if status == 429:
            return UpstreamRateLimitError("Provider rate limit exceeded")
        body = getattr(exc, "message", None) or getattr(exc, "body", None) or str(exc)
        safe = redact_secrets(str(body)) or "Provider request failed"
        return UpstreamServiceError(f"Provider API error ({status or '?'}): {safe[:200]}")

    if isinstance(
        exc,
        (
            BadRequestError,
            NotFoundError,
            ContextWindowExceededError,
            ContentPolicyViolationError,
            InternalServerError,
            APIError,
        ),
    ):
        return UpstreamServiceError(safe_message[:200])

    return UpstreamServiceError(safe_message[:200])


class LiteLLMClient:
    """Single entry point for chat completions via LiteLLM."""

    async def improve_text(
        self,
        text: str,
        *,
        request_id: str,
        installation_id: str,
        site: str | None,
    ) -> ImproveLLMResult:
        model_id = settings.litellm_model_id()
        api_key = _resolve_provider_api_key()
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ]
        extra_headers: dict[str, str] | None = None
        if settings.llm_backend == "OPENROUTER":
            extra_headers = {
                "HTTP-Referer": settings.openrouter_site_url or "https://prompttune.local",
                "X-Title": settings.openrouter_app_name or "PromptTune",
            }

        completion_tokens = settings.llm_completion_tokens
        max_attempts = max(1, settings.llm_max_retries)
        response: Any = None
        improved: str = ""
        attempt = 0
        latency_ms = 0
        while attempt < max_attempts:
            attempt += 1
            start = time.monotonic()
            request_kwargs: dict[str, Any] = {
                "model": model_id,
                "messages": messages,
                "api_key": api_key,
                "max_tokens": completion_tokens,
                "timeout": settings.llm_request_timeout_seconds,
                "extra_headers": extra_headers,
            }
            if settings.llm_temperature is not None:
                request_kwargs["temperature"] = settings.llm_temperature
            try:
                response = await acompletion(**request_kwargs)
            except Exception as exc:
                raise _map_litellm_error(exc) from exc

            latency_ms = int((time.monotonic() - start) * 1000)

            if not getattr(response, "choices", None):
                raise UpstreamBadResponseError("Provider returned no choices")

            try:
                raw = response.choices[0].message.content
            except (AttributeError, IndexError, TypeError) as exc:
                raise UpstreamBadResponseError("Provider response missing message content") from exc

            if raw is None:
                raw = ""
            elif not isinstance(raw, str):
                raise UpstreamBadResponseError(
                    f"Provider message content must be a string, got {type(raw).__name__}"
                )

            improved = _normalize_response(raw)
            if not improved.strip():
                detail = _empty_completion_detail(response)
                diagnostics = _empty_completion_diagnostics(response)
                if not _should_retry_empty_completion(detail, attempt, max_attempts):
                    raise UpstreamBadResponseError(
                        f"Provider returned empty completion ({detail})"
                    )
                if detail == "token_exhaustion":
                    completion_tokens = min(
                        completion_tokens * 2,
                        settings.llm_completion_tokens_retry_max,
                    )
                logger.warning(
                    "llm_empty_completion_retry model=%s attempt=%s detail=%s diagnostics=%s",
                    model_id,
                    attempt,
                    detail,
                    diagnostics,
                )
                continue

            if len(improved) > settings.prompt_output_max_chars:
                raise UpstreamBadResponseError(
                    f"Provider output exceeds max length {settings.prompt_output_max_chars}"
                )
            break

        if response is None:
            raise UpstreamBadResponseError("Provider returned empty completion")

        model_used = _resolve_model_name(response, model_id)
        pt, ct, tt = _usage_tokens(response)
        provider = _provider_from_response(response, model_used)
        upstream_id = getattr(response, "id", None)

        def _sanitize(value: str | None) -> str | None:
            if value is None:
                return None
            return value.replace("\r", "").replace("\n", "")

        logger.info(
            "llm_completion model=%s provider=%s prompt_tokens=%s completion_tokens=%s "
            "total_tokens=%s latency_ms=%s attempt_count=%s completion_tokens_budget_used=%s "
            "request_id=%s installation_id=%s site=%s",
            model_used,
            provider,
            pt,
            ct,
            tt,
            latency_ms,
            attempt,
            completion_tokens,
            _sanitize(request_id),
            _sanitize(installation_id),
            _sanitize(site),
        )

        return ImproveLLMResult(
            improved_text=improved,
            model=model_used,
            provider=provider,
            prompt_tokens=pt,
            completion_tokens=ct,
            total_tokens=tt,
            latency_ms=latency_ms,
            upstream_id=upstream_id if isinstance(upstream_id, str) else None,
            attempt_count=attempt,
            completion_tokens_budget_used=completion_tokens,
        )


_default_client = LiteLLMClient()


async def improve_text(
    text: str,
    *,
    request_id: str,
    installation_id: str,
    site: str | None,
) -> ImproveLLMResult:
    return await _default_client.improve_text(
        text,
        request_id=request_id,
        installation_id=installation_id,
        site=site,
    )
