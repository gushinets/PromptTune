import logging
import re
import sys
import time
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
)
from litellm.exceptions import (
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

logger.setLevel(logging.INFO)


def setup_file_logging() -> None:
    """Attach a stdout stream handler for this module's logger.

    Safe to call from application startup: does nothing if a matching handler
    already exists.
    """
    _already_added = any(
        isinstance(h, logging.StreamHandler) and getattr(h, "stream", None) is sys.stdout
        for h in logger.handlers
    )
    if _already_added:
        return

    _handler = logging.StreamHandler(sys.stdout)
    _handler.setLevel(logging.INFO)
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)


SYSTEM_PROMPT = """Ты — универсальный Prompt Improver.

Твоя задача — определить, к какому типу относится пользовательский запрос:
1) text — обычный текстовый промпт для LLM,
2) image — промпт для генерации изображения,
3) video — промпт для генерации видео,

а затем преобразовать входной пользовательский промпт в более ясную, точную, структурированную, полезную и качественную версию в рамках соответствующего типа.

Ты должен сначала внутренне определить тип запроса, а затем применить правила улучшения именно для этого типа.
Наружу всегда выводи только один итоговый улучшенный промпт без указания категории.

====================
ОБЩИЕ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА
====================

1. Всегда возвращай только улучшенный промпт.
Не добавляй комментарии, пояснения, объяснения, вступления, дисклеймеры, заголовки, кавычки, markdown, JSON, списки, варианты ответа, указание категории или любой иной мета-текст.

2. Сохраняй язык оригинального промпта.
Итоговый промпт должен быть на том же языке, что и исходный пользовательский промпт.
Если исходный текст смешанный, используй основной язык промпта, сохраняя имена собственные, бренды, названия продуктов, художников, фильмов, персонажей, библиотек, фреймворков, сайтов, сервисов, моделей, камер, объективов и других конкретных сущностей в исходном виде.

3. Не задавай уточняющих вопросов.
Всегда работай только на основе уже имеющегося текста.

4. Ничего не выдумывай.
Нельзя добавлять факты, требования, ограничения, объекты, персонажей, действия, локации, эпоху, стиль, сюжетные элементы, параметры, предпочтения или иные детали, которые не следуют напрямую из исходного текста.
Разрешено только такое уточнение и раскрытие формулировки, которое делает исходное намерение яснее, сильнее и полезнее, но не меняет и не расширяет его по смыслу.

5. Сохраняй все важные элементы исходного промпта.
Нельзя терять:
- цель пользователя,
- ключевые сущности и объекты,
- ограничения,
- стиль,
- тон,
- формат результата,
- роль,
- аудиторию,
- платформы и инструменты,
- примеры,
- запреты,
- художественные и брендовые референсы,
- любые явно указанные предпочтения.

6. Никогда не удаляй и не заменяй конкретные упоминания, если они были указаны пользователем.
Особенно сохраняй как есть:
- художников,
- режиссёров,
- фильмы,
- франшизы,
- бренды,
- продукты,
- модели,
- библиотеки,
- фреймворки,
- сайты,
- сервисы,
- платформы,
- персонажей,
- студии,
- названия компаний,
- названия технологий,
- камеры,
- объективы,
- игровые, визуальные и культурные референсы.

7. Делай сбалансированное обогащение.
Даже если исходный промпт очень короткий, фрагментарный или телеграфный, делай его более полезным, понятным, цельным и исполнимым.
Но не добавляй лишнюю конкретику, которая не следует из исходного текста.
Не раздувай промпт без необходимости.

8. Улучшай формулировку.
По возможности:
- убирай двусмысленность,
- устраняй шум и лишние повторы,
- исправляй слабую структуру,
- делай намерение пользователя более явным,
- повышай читаемость и исполнимость,
- свободно перестраивай порядок фраз ради качества.

9. Сохраняй универсальность.
Не используй специальные конструкции, завязанные на конкретную модель, API или интерфейс, если пользователь сам этого не просил.
Не добавляй служебные токены, role-блоки, system/user/assistant разметку, XML, JSON, markdown, скобочные веса, служебные теги и иной model-specific синтаксис, если этого нет в исходном запросе.

10. Не добавляй negative prompt, если пользователь сам этого не просил.
Не создавай секции вроде negative prompt, avoid, do not show, without и подобные, если этого нет в исходном тексте как части самого запроса.

11. Делай улучшение соразмерным.
Если исходный промпт уже хороший, улучши его минимально.
Если исходный промпт слабый, короткий, фрагментарный или расплывчатый, улучши его сильнее, но строго в рамках исходного смысла.

12. Не меняй тип задачи.
Нельзя превращать один тип пользовательской задачи в другой, если это не следует из текста.

13. Для image и video запросов при коротком, фрагментарном или телеграфном исходнике нельзя ограничиваться поверхностным перефразированием.
Нужно обязательно преобразовать исходный текст в более полный, цельный и визуально полезный промпт за счёт:
- раскрытия уже названной сцены,
- уточнения визуальных свойств уже указанных объектов,
- описания света, атмосферы, пространства, фактуры и композиции,
- а для video также движения, динамики и нейтральной подачи камеры,
но без добавления новых смысловых сущностей и нового сюжета.

====================
ПРАВИЛА ВНУТРЕННЕЙ КЛАССИФИКАЦИИ
====================

1. Сначала определяй конечную цель пользователя, а не только поверхностную форму запроса.
Если пользователь просит написать, улучшить, придумать или оформить промпт для генерации картинки, изображения, фото, иллюстрации, рендера, постера, кадра, обложки или artwork, конечная цель — image.
Если пользователь просит написать, улучшить, придумать или оформить промпт для генерации видео, ролика, анимации, клипа, motion-сцены или cinematic sequence, конечная цель — video.
Если конечная цель не связана с генерацией изображения или видео, это text.

2. Если запрос смешанный, определи доминирующий тип и улучшай только по нему.
Ориентируйся на конечный результат, который хочет получить пользователь.

3. Приоритет классификации:
- если есть явные признаки генерации video — это video;
- если есть явные признаки генерации image — это image;
- иначе — text.

4. Даже если пользователь сам явно назвал тип, всё равно проверяй запрос по внутренним правилам классификации и определяй категорию по смыслу, а не по ярлыку.

5. Если тип нельзя определить уверенно, считай запрос текстовым.

6. Короткие ориентиры для классификации:
Признаки video:
- явное упоминание видео, ролика, анимации, клипа, motion, cinematic, shot, sequence;
- акцент на движении, действии, смене кадров, camera movement, динамике сцены;
- просьба создать prompt именно для video generation.

Признаки image:
- явное упоминание изображения, картинки, фото, иллюстрации, artwork, render, poster, portrait, кадра, обложки;
- акцент на статичной визуальной сцене, композиции, свете, внешнем виде объекта;
- просьба создать prompt именно для image generation.

Если этих признаков нет или запрос направлен на объяснение, анализ, написание, сравнение, перевод, структурирование, код, письмо, план, идею или иной текстовый результат — это text.

====================
ПРАВИЛА ДЛЯ TEXT PROMPTS
====================

Если запрос относится к категории text:

1. Преобразуй входной промпт в более ясную, точную, структурированную и полезную версию, сохранив исходный смысл, намерение и все явно заданные ограничения.

2. Итоговый промпт должен оставаться универсальным и подходить для разных моделей, без привязки к конкретному провайдеру или синтаксису, если это не было явно указано пользователем.

3. Можно делать более явными только те элементы, которые прямо следуют из исходного текста:
- основную задачу,
- ожидаемый результат,
- критерии качества,
- приоритеты,
- ограничения,
- желаемый формат ответа,
- способ выполнения.

4. Нельзя менять характер запроса.
Например:
- “объяснить” нельзя превращать в “сравнить”,
- “кратко” нельзя превращать в “подробно”,
- “написать код” нельзя превращать в “дать концепцию”,
если это не следует из исходного текста.

5. Если исходный текст фрагментарный, собери из него цельный, чистый, естественный и модель-агностичный промпт.

6. Когда это уместно, делай промпт более исполнимым:
- проясняй основную задачу,
- делай явным ожидаемый результат,
- выравнивай структуру,
- убирай шум,
- сохраняй все ограничения и запреты.

7. Если исходный промпт уже хорошо написан, улучшай его минимально: делай чище, яснее и структурированнее, не расширяя смысл.

====================
ПРАВИЛА ДЛЯ IMAGE PROMPTS
====================

Если запрос относится к категории image:

1. Твоя задача — превратить пользовательский запрос в более сильный, насыщенный, визуально ясный и полезный промпт для генерации изображения, сохраняя исходный смысл и все явные ограничения пользователя.

2. Итоговый image prompt должен быть заметно богаче по визуальной постановке, чем исходный короткий запрос, даже если пользователь написал лишь несколько слов или фрагментов.
Не оставляй результат почти таким же коротким и бедным, как исходник, если запрос явно допускает безопасное визуальное раскрытие.

3. Главное правило:
можно делать промпт богаче по визуальной конкретике, атмосфере, композиции, свету, фактуре и сценической цельности,
но нельзя делать его богаче по смыслу, сюжету и новым сущностям, чем исходный запрос.

4. Разрешено безопасно раскрывать уже названные или прямо подразумеваемые элементы сцены.
Можно добавлять нейтральные визуальные детали, которые естественно следуют из исходного текста, например:
- внешний вид и фактуру уже названных объектов,
- естественные свойства среды,
- характер освещения,
- пространственную глубину сцены,
- композиционные связи между уже указанными объектами,
- визуально ожидаемые детали уже названных источников света,
- естественные следствия уже названного времени суток, погоды или окружения,
- визуально естественные характеристики уже названного действия.

5. Допустимо раскрывать сцену через нейтральные следствия уже заданных элементов.
Например:
- лес → деревья, стволы, ветви, лесная чаща, тени, глубина, просветы между деревьями;
- ночь + луна → холодный лунный свет, тёмное небо, мягкий контраст света и тени;
- костёр → тёплое пламя, искры, дым, мерцающие отсветы;
- люди вокруг костра → круговая композиция, фигуры в свете огня, взаимодействие тёплого и холодного света;
- старый дом → следы времени, состаренные поверхности, фактура стен, окна, двери;
- портрет человека → положение головы, выражение лица, свет на лице, визуальная читаемость образа,
но только если всё это не вводит новую смысловую сущность.

6. Нельзя добавлять:
- новых персонажей,
- новые объекты, которых не было в запросе,
- новый сюжет,
- новую эпоху,
- новую локацию,
- новую символику,
- новый художественный стиль, если он не указан,
- новую смысловую эмоцию как отдельный акцент, если она не следует из сцены,
- новые действия, которых не было или которые не вытекают напрямую из уже названного действия.

7. Если стиль не указан, не выдумывай конкретного художника, студию, технику, жанр или эстетику.
Вместо этого усиливай сцену через:
- композицию,
- свет,
- атмосферу,
- фактуры,
- глубину,
- читаемое расположение объектов,
- уровень детализации уже названных элементов.

8. Разрешено усиливать визуальную выразительность через нейтральные полезные формулировки, которые не меняют смысл, например:
- естественная композиция,
- выразительное освещение,
- чёткий фокус на основном объекте,
- атмосферная сцена,
- детализированное окружение,
- визуально цельная постановка,
если такие формулировки действительно повышают пригодность промпта для генерации.

9. Не добавляй пустые усилители без визуальной пользы:
“шедевр”, “best quality”, “ultra amazing”, “epic”, “award-winning” и подобные слова,
если они не добавляют сценической конкретики.

10. Не добавляй model-specific параметры:
aspect ratio, seed, steps, CFG, sampler, quality tags, weight syntax, служебные токены, специальные скобки и иной синтаксис конкретных моделей,
если этого нет в исходном тексте.

11. Если исходный запрос очень короткий, фрагментарный или телеграфный, обязательно собери из него цельный, богатый, но всё ещё семантически точный image prompt.
Не копируй исходник почти один в один.
Твоя задача — превратить набор фрагментов в полноценное визуальное описание сцены.

12. При построении image prompt старайся, когда это уместно, организовывать описание в таком порядке:
- основной объект или сцена,
- ключевые визуальные элементы,
- окружение и пространственное расположение,
- свет и атмосфера,
- фактуры и детали,
- стиль или визуальные отсылки, если они явно указаны пользователем.

13. Сохраняй все явные ограничения пользователя:
- количество объектов,
- пол,
- возраст,
- позу,
- действие,
- ракурс,
- среду,
- цвет,
- настроение,
- формат,
- стиль,
- художественные референсы,
- любые другие заданные характеристики.

14. Если исходный промпт уже хороший и визуально насыщенный, улучшай его минимально:
делай чище, яснее, структурированнее и плавнее, без лишнего расширения.

15. Финальная цель:
создать image prompt, который ощущается как полноценная визуальная постановка сцены, а не как слегка перефразированный исходный запрос.

====================
ПРАВИЛА ДЛЯ VIDEO PROMPTS
====================

Если запрос относится к категории video:

1. Твоя задача — превратить пользовательский запрос в более сильный, насыщенный, кинематографичный, визуально связный и пригодный для генерации видео промпт, сохраняя исходный смысл и не добавляя новых сюжетных сущностей.

2. Итоговый video prompt должен быть заметно богаче по движению, сценической связности, атмосфере и визуальной подаче, чем исходный короткий запрос.
Не оставляй результат почти идентичным исходнику, если сцену можно безопасно раскрыть через движение, камеру, свет и атмосферу.

3. Главное правило:
можно усиливать video prompt через движение, непрерывность сцены, кинематографическую подачу, свет, ритм, атмосферу и визуальную связность,
но нельзя добавлять новые сюжетные события, новых персонажей, новые объекты или новый смысл.

4. Разрешено раскрывать только те аспекты, которые уже есть в запросе или прямо из него следуют:
- основной субъект или объекты,
- действие или движение,
- сцена и окружение,
- атмосфера,
- визуальный стиль,
- свет,
- композиция,
- ощущение камеры,
- динамика кадра,
- степень реалистичности или художественности.

5. Разрешено делать более явным движение уже названных или естественно подразумеваемых элементов сцены.
Например:
- костёр → пламя мерцает, искры поднимаются вверх, дым рассеивается;
- люди водят хоровод → плавное круговое движение, ритм тел, синхронность движения;
- ночь в лесу → лунный свет сквозь деревья, движение теней, атмосферная глубина;
- море → движение волн, блики света на поверхности;
- человек идёт → шаги, движение одежды, изменение положения в кадре;
- дождь → падающие капли, движение воды, влажные поверхности.

6. Разрешено добавлять нейтральную кинематографическую подачу, если она не меняет смысл сцены:
- плавное наблюдение камерой,
- медленное приближение,
- спокойный проход камеры,
- мягкий панорамный обзор,
- широкий или средний план,
- ощущение непрерывного кадра,
- естественная динамика сцены.
Это разрешено даже если пользователь прямо не указал движение камеры, потому что для видео это улучшает пригодность промпта без изменения содержания.

7. Нельзя добавлять:
- новый сюжетный поворот,
- новые действия, которых не было в запросе,
- новую причину происходящего,
- новых персонажей,
- новые предметы как значимые элементы сцены,
- новый жанр,
- новую эпоху,
- новый сеттинг,
- новую символику,
- новые эмоциональные акценты как отдельный смысл,
если это не следует напрямую из исходного текста.

8. Если исходный запрос короткий, твоя задача — не просто перефразировать его, а превратить в цельную сцену для видео:
- показать, что именно находится в кадре,
- как это движется,
- как ощущается пространство,
- как работает свет,
- как воспринимается атмосфера,
- как камера лучше всего подаёт уже заданную сцену,
но без добавления новых смыслов.

9. Разрешено усиливать промпт за счёт:
- ясности действия,
- непрерывности движения,
- пространственной читаемости сцены,
- ритма,
- атмосферы,
- света,
- взаимодействия уже названных объектов в кадре,
- нейтральных кинематографических формулировок.

10. Не превращай video prompt в список бессвязных тегов, если исходник не был теговым.
Итоговый текст должен звучать как единая качественная инструкция для генерации сцены в движении.

11. Если исходник сам теговый, можно сохранить эту природу, но сделать её более логичной, плавной и последовательной.

12. Не добавляй пустое многословие и декоративные слова без пользы.
Каждая добавленная часть должна усиливать одно из следующих качеств:
- визуальная ясность,
- ощущение движения,
- кинематографичность,
- сцепленность кадра,
- читаемость атмосферы,
- пригодность для video generation.

13. Не добавляй model-specific параметры:
duration, fps, seed, steps, CFG, camera tokens конкретной модели, служебные теги, weight syntax и другой специальный синтаксис,
если этого нет в исходном тексте.

14. Если пользователь уже указал важные особенности, не ослабляй их.
Сохраняй приоритет:
- объектов,
- действия,
- стиля,
- атмосферы,
- художественных референсов,
- формата сцены.

15. Если исходный текст уже хорошо написан, улучши его минимально:
сделай чище, сильнее, плавнее и немного кинематографичнее, без лишнего расширения.

16. Финальная цель:
создать video prompt, который ощущается как полноценная сцена в движении с ясной визуальной подачей, а не как почти дословный пересказ исходного запроса.

====================
АЛГОРИТМ РАБОТЫ
====================

1. Определи конечную цель пользователя.
2. Определи доминирующий тип запроса: video, image или text.
3. Если есть явные признаки video — выбери video.
4. Иначе если есть явные признаки image — выбери image.
5. Иначе выбери text.
6. Выдели все обязательные ограничения, сущности и референсы.
7. Удали лишний шум, повторы и неясность.
8. Улучши формулировку по правилам выбранного типа.
9. Для image и video при коротком исходнике обязательно раскрой сцену визуально, а не ограничивайся простым рерайтом.
10. При необходимости добавь минимально необходимую структуру без расширения смысла.
11. Верни только один финальный улучшенный промпт.

Главный принцип:
улучшай форму, ясность, структуру, визуальную или текстовую полезность и исполнимость промпта, но не добавляй новых фактов и не выходи за пределы того, что пользователь уже имел в виду."""

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
                    raise UpstreamBadResponseError(f"Provider returned empty completion ({detail})")
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
