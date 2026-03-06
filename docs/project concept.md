## **Зафиксированные решения**

* **V1:** popup, ручной ввод, кнопки “Improve / Copy improved / Save to Library / Open & Paste”.  
* **V2:** **toolbar-плашка рядом** с композером; улучшать **только активное поле**.  
* **Backend:** FastAPI \+ LiteLLM; **без логина** в MVP.  
* **Хранение:** тексты промптов **сохраняем на сервере в Postgres** (и локально в библиотеку в extension storage).  
* **Лимиты free-tier:** **50 запросов/день** и **10 запросов/мин**.  
* **Кросс-браузер:** Chrome \+ Edge \+ Firefox, позже Safari; публикация в сторах.

---

# **Концепция проекта**

## **1\) Архитектура расширения**

### **Компоненты**

1. **Popup UI (V1)**  
* `Original prompt` (textarea)  
* `Improved prompt` (textarea, read-only или editable)  
* Кнопки:  
  * **Improve**  
  * **Copy improved**  
  * **Save to Library** (локально)  
  * Иконки сайтов: **Open & Paste** (открыть сайт и вставить)  
2. **Background (service worker / background script)**  
* Единая точка сетевого взаимодействия с backend (`/v1/improve`, `/v1/save`)  
* Хранит `installation_id` (генерируется один раз, хранится в storage)  
* Обрабатывает хоткеи (`commands`)  
* Управляет “Open & Paste”: открывает вкладку и отправляет контент-скрипту команду вставки  
3. **Content Script (V2 \+ вставка)**  
* На поддерживаемых доменах:  
  * ищет композер  
  * монтирует **toolbar-плашку** рядом  
  * определяет **active field** (последнее сфокусированное поле ввода)  
  * по клику/хоткею: читает текст → вызывает backend → вставляет improved обратно  
4. **Локальная библиотека (MVP)**  
* В extension: `storage.local` (унифицированно через `webextension-polyfill`)  
* Там же можно хранить:  
  * последнюю пару (original/improved)  
  * настройки: включённые сайты, хоткеи подсказки, режимы (потом)

---

## **2\) Почему toolbar-плашка устойчивее**

* Минимум CSS-магии (не нужно “внутри input” с оверлеем и учётом padding/scroll/theme)  
* Меньше ломается при редизайнах сайтов  
* Можно сделать **fallback**: если не найден “идеальный контейнер” — показываем кнопку рядом с активным элементом (позиционирование absolute около `getBoundingClientRect()`).

---

# **3\) Контракт взаимодействия extension ↔ content scripts**

### **Сообщения (message bus)**

**content → background**

* `GET_ACTIVE_TEXT` (опционально; чаще content сам читает)  
* `IMPROVE_REQUEST`:  
  * `text`  
  * `site`  
  * `page_url`  
  * `installation_id` (может добавлять background)  
  * `active_field_meta` (тип: textarea/contenteditable)

**background → content**

* `IMPROVE_RESULT`:  
  * `improved_text`  
  * `request_id`  
* `PASTE_TEXT`:  
  * `text` (для Open & Paste)

---

# **4\) “Site adapters” (чтобы расширять список сайтов без боли)**

Делаем единый интерфейс адаптера \+ общий “эвристический” fallback.

### **Интерфейс адаптера**

* `match(hostname): boolean`  
* `findComposerContainer(): HTMLElement | null`  
* `findEditableField(): HTMLElement | null` *(или логика “последний focused”)*  
* `getText(el): string`  
* `setText(el, text): void` \+ обязательно:  
  * выставить value/innerText  
  * задиспатчить события `input`, иногда `change`, иногда симуляция `KeyboardEvent`  
* `mountToolbar(container): void`

### **Fallback-эвристика (если сайт новый/сломался)**

* “активное поле” \= `document.activeElement`  
* если это `textarea/input` — ok  
* если `contenteditable=true` — работаем через `innerText`/`textContent` (аккуратно)  
* если поле не найдено — показываем уведомление “Focus the input field first”.

Так вы сможете добавлять новые сайты “конфигом” (селекторы) \+ точечно дописывать адаптер, когда сайт требует особого подхода.

---

# **5\) Хоткеи (V2)**

В `commands`:

* `improve-active-field`: например `Ctrl/Cmd+Shift+I`  
* (опционально) `open-popup`: например `Ctrl/Cmd+Shift+P`

Логика:

* hotkey → background → отправить в content “забери active field, улучши, вставь”.

---

## **6\) UX детали MVP (важные мелочи)**

* **Copy improved**:  
  * в popup: `navigator.clipboard.writeText(improved)`  
  * в content script: тоже можно (но иногда потребуются права/контекст; проще делать через background \+ clipboard permission, либо через user gesture в контенте)  
* **Save to Library**:  
  * локально сохраняем запись  
  * *и дополнительно* отправляем на сервер `/v1/prompts` (раз вы решили хранить тексты в Postgres)  
* **Open & Paste**:  
  * открываем вкладку на домен  
  * content script на этом домене при загрузке ждёт поле → вставляет текст

---

# **Backend концепция (FastAPI \+ LiteLLM)**

## **1\) API (MVP)**

### **`POST /v1/improve`**

Request:

* `text: string`  
* `installation_id: string`  
* `site?: string` (например `chatgpt`, `claude`, `perplexity`)  
* `page_url?: string`  
* `client_ts?: number` (опционально)

Response:

* `request_id: string`  
* `improved_text: string`  
* `rate_limit: { per_minute_remaining, per_day_remaining }` *(опционально, но удобно для UI)*

### **`POST /v1/prompts` (сохранение в Postgres)**

Request:

* `installation_id`  
* `site?`  
* `original_text`  
* `improved_text`  
* `page_url?`  
* `meta?` (json: lang, lengths, model, latency)

Response:

* `prompt_id`

*(Можно объединить: improve сразу пишет в БД; а Save to Library — только локально. Но ты явно хочешь хранить тексты на сервере, поэтому логично писать в БД на каждое улучшение.)*

---

## **2\) Rate limiting (Redis): 10/мин \+ 50/день**

Рекомендую делать **двойное ограничение**:

* **Per-minute**: token bucket / fixed window  
* **Per-day**: fixed window по дате (UTC или Europe/Amsterdam — выберите и зафиксируйте)

Ключи:

* `rl:ip:min:{ip}:{minute_bucket}`  
* `rl:ip:day:{ip}:{yyyy-mm-dd}`  
* `rl:inst:min:{installation_id}:{minute_bucket}`  
* `rl:inst:day:{installation_id}:{yyyy-mm-dd}`

Политика:

* Блокируем, если превышен **любой** лимит (ip или installation).  
* TTL:  
  * minute keys: 2–3 минуты  
  * day keys: 2–3 дня

Плюс:

* whitelist для ваших тестовых IP  
* denylist для явного абьюза

---

## **3\) Хранение в Postgres (MVP схема)**

### **Таблица `installations`**

* `id (uuid / text)` — installation\_id  
* `created_at`  
* `last_seen_at`  
* `first_user_agent?`  
* `first_ip?` *(если храните — это privacy аспект)*

### **Таблица `prompt_improvements`**

* `id (uuid)`  
* `installation_id`  
* `created_at`  
* `site`  
* `page_url`  
* `original_text` **TEXT**  
* `improved_text` **TEXT**  
* `model` (что выбрал LiteLLM)  
* `latency_ms`  
* `status` (ok/error)  
* индексы: `(installation_id, created_at desc)`, `(created_at desc)`

Если хочешь “готовность к подписке”:

* добавим позже `users`, `installation_user_link`, `plans`, `usage_ledger`.

---

## **4\) Безопасность публичного endpoint (реалистичный MVP)** 

Так как без логина, “идеальной” защиты не будет, но можно сделать достаточно крепко:

* Rate limit ip \+ installation\_id (основа)  
* Ограничение длины `text` (например до 8000 символов)  
* Ограничение частоты ошибок (если много 4xx/5xx — бан IP на время)  
* Reverse proxy (Caddy/Nginx) с:  
  * basic rate limiting на уровне edge (грубая отсечка)  
  * TLS  
* Логи: request\_id, ip, installation\_id, latency, status  
* (позже) включить “challenge по подозрению” (turnstile/captcha) только для плохих паттернов

---

# **Технологии и структура репозитория**

## **Рекомендуемый фронтенд-стек**

* **WXT \+ TypeScript \+ webextension-polyfill**  
* UI popup: либо vanilla, либо React/Preact (на твой вкус)  
* Хранилище MVP: `storage.local`

## **Backend**

* FastAPI  
* LiteLLM (одна точка для разных LLM)  
* Postgres, Redis  
* Docker Compose  
* Alembic миграции

## **Монорепо (пример)**

* `/extension/`  
  * `entrypoints/popup/`  
  * `entrypoints/background/`  
  * `entrypoints/content/`  
  * `shared/` (api client, storage, types)  
  * `adapters/` (chatgpt, claude, perplexity, …)  
* `/backend/`  
  * `app/api/` (routers)  
  * `app/services/` (litellm, rate\_limit, persistence)  
  * `app/db/` (models, migrations)  
* `/infra/`  
  * `docker-compose.yml`  
  * `caddy/` или `nginx/`

---

# **План работ (по шагам)**

## **MVP V1 (Popup)**

1. Popup UI: improve/copy/save/open\&paste  
2. Storage.local библиотека (CRUD)  
3. Background: вызовы backend \+ installation\_id  
4. Open & Paste: открыть вкладку \+ вставка через content script  
5. Backend `/v1/improve` \+ Redis rate limit \+ Postgres запись  
6. Подготовка к публикации: политики, описание, permissions минимальные

## **V2 (in-page toolbar \+ hotkeys)**

7. Content script: tracking active field \+ toolbar mount  
8. Улучшение активного поля \+ вставка (textarea/contenteditable)  
9. Хоткеи через commands  
10. Site adapters для первых 5 сайтов \+ fallback на другие

## **Дальше**

11. Настройки: включить/выключить сайты, лимиты/статус  
12. Логин/подписка/планы

---

Ниже — декомпозиция на **эпики → фичи → задачи → подзадачи** так, чтобы разработчики могли ставить оценки. Я добавил **Acceptance Criteria / DoD** и **риски**, чтобы оценка была реалистичнее.

---

# **EPIC 0 — Репозиторий, базовая инфраструктура, стандарты**

## **0.1 Монорепо и базовая структура**

**Задачи**

* Создать структуру репозитория: `/extension`, `/backend`, `/infra`, `/docs`  
* Настроить линтеры/форматтеры:  
  * extension: ESLint \+ Prettier  
  * backend: ruff \+ black \+ mypy (по желанию)  
* Настроить pre-commit hooks

**DoD**

* Репозиторий собирается локально в 1 команду для extension и backend

---

## **0.2 CI (минимальный)**

**Задачи**

* GitHub Actions:  
  * extension: lint \+ build  
  * backend: lint \+ unit tests  
* Артефакты сборки extension (zip для Chrome/Firefox/Edge)

**DoD**

* PR не проходит без сборки/линта

---

# **EPIC 1 — Extension V1 (Popup MVP)**

## **1.1 Каркас extension (WXT \+ TS \+ polyfill)**

**Задачи**

* Инициализировать WXT проект  
* Подключить `webextension-polyfill`  
* Настроить сборки под:  
  * Chrome/Edge (Chromium)  
  * Firefox  
* Настроить manifest permissions (минимальный набор):  
  * `storage`, `tabs`, `activeTab`, `scripting`, `commands`  
  * `host_permissions` для целевых сайтов (список доменов)  
* Добавить env/config для base URL backend

**DoD**

* Extension устанавливается в Chrome и Firefox  
* Popup открывается

**Риски**

* Различия MV3 у Firefox → нужен отдельный build target/условия

---

## **1.2 Popup UI: поля \+ кнопки (Improve / Copy / Save / Open\&Paste)**

**Задачи**

* Верстка popup:  
  * textarea “Original”  
  * textarea “Improved”  
  * кнопки: Improve / Copy improved / Save to Library  
  * иконки сайтов: ChatGPT, Deepseek, Perplexity, Groq, Claude  
* UX:  
  * disabled состояние кнопок при пустом тексте  
  * loading/spinner на Improve  
  * обработка ошибок (toast/строка ошибки)  
* Copy improved:  
  * копирование в буфер \+ короткое подтверждение “Copied\!”

**Acceptance Criteria**

* Improve отправляет запрос на backend и показывает improved  
* Copy копирует ровно improved текст  
* Ошибки rate limit/сети отображаются понятно

---

## **1.3 Local Library (storage.local): сохранить/список/удалить**

**Задачи**

* Схема записи в storage.local:  
  * `id`, `createdAt`, `site?`, `original`, `improved`, `title?`, `tags?`  
* Операции:  
  * Save (из popup)  
  * List (минимально: отдельная вкладка/секция в popup)  
  * Delete  
  * Copy из библиотеки  
* Ограничения:  
  * max N записей (например 200\) или max size (чтобы не разрасталось)

**Acceptance Criteria**

* Сохранённые записи переживают перезапуск браузера  
* Можно удалить запись и она исчезает

**Риски**

* `storage.local` квоты могут отличаться по браузерам → предусмотреть лимит

---

## **1.4 Open & Paste (из popup): открыть сайт и вставить improved**

**Задачи**

* Background:  
  * открыть новую вкладку по выбранному сайту  
  * дождаться загрузки (tabs.onUpdated)  
  * отправить message в content script: `PASTE_TEXT`  
* Content script (для каждого домена минимум-вставки):  
  * найти поле ввода (селекторы/эвристики)  
  * вставить текст и триггернуть `input` событие  
  * обработать ретраи (DOM ещё не готов): 5–10 попыток с задержкой

**Acceptance Criteria**

* Нажатие на иконку сайта открывает сайт и вставляет improved в поле ввода  
* Если вставить не удалось — понятное уведомление (например в popup: “Couldn’t find input, click the input and try again”)

**Риски**

* Композеры SPA/React/contenteditable часто меняются → ретраи и адаптеры обязательны

---

# **EPIC 2 — Backend MVP (FastAPI \+ LiteLLM \+ Postgres \+ Redis)**

Иосиф: 145 часов \- всего

## **2.1 Backend skeleton \+ docker-compose**

25 часов 

**Задачи**

* FastAPI проект: структура `app/api`, `app/services`, `app/db`  
* Docker compose:  
  * api  
  * postgres  
  * redis  
  * reverse proxy (Caddy или Nginx) \+ TLS  
* Health endpoints:  
  * `GET /healthz`  
  * `GET /readyz` (опционально: проверка БД/Redis)

**DoD**

* `docker compose up` поднимает весь стек

---

## **2.2 DB schema \+ миграции (Alembic)**

20 часов

**Задачи**

* Таблицы:  
  * `installations` (installation\_id, created\_at, last\_seen\_at, first\_user\_agent?, first\_ip?)  
  * `prompt_improvements` (id, installation\_id, created\_at, site, page\_url, original\_text, improved\_text, model, latency\_ms, status, error?)  
* Индексы:  
  * `(installation_id, created_at desc)`  
  * `(created_at desc)`  
* Alembic migrations \+ базовые модели SQLAlchemy

**Acceptance Criteria**

* Миграции применяются и откатываются  
* Запись “improvement” создаётся на успешный вызов

---

## **2.3 Endpoint `/v1/improve` \+ интеграция LiteLLM**

30 часов

**Задачи**

* Контракт запроса/ответа (Pydantic)  
* Вызов LiteLLM:  
  * system prompt (MVP)  
  * user text  
  * параметры модели/провайдера из env/config  
* Нормализация ответа:  
  * убрать “Вот улучшенный промпт:” (если модель добавит)  
  * тримминг  
* Логирование request\_id \+ latency  
* Запись в Postgres результата (original+improved)

**Acceptance Criteria**

* На валидный ввод возвращается improved\_text  
* В БД сохраняется original и improved  
* Ошибки провайдера возвращаются в контролируемом формате

---

## **2.4 Rate limiting (Redis): 10/мин \+ 50/день**

25 часов

**Задачи**

* Определить ключи:  
  * по IP  
  * по installation\_id  
* Реализовать лимиты:  
  * per-minute (10)  
  * per-day (50)  
* Возврат заголовков/полей в ответе (опционально):  
  * remaining/minute, remaining/day  
  * reset time  
* Обработка edge cases:  
  * отсутствие IP (если нет proxy headers) — fallback  
  * clock/timezone (фиксировать UTC или Europe/Amsterdam)

**Acceptance Criteria**

* 11-й запрос в минуту блокируется (429)  
* 51-й запрос в день блокируется (429)  
* Лимиты применяются и к installation\_id, и к IP

---

## **2.5 Конфиг лимитов “настраиваемый”**

20 часов

**Вариант MVP (быстро): env-переменные**

* `FREE_REQ_PER_DAY`, `FREE_REQ_PER_MIN`  
* Документация, как менять и перезапускать

**Вариант \+1 (лучше): DB settings \+ кеш**

* Таблица `settings`  
* Admin endpoint `/admin/settings` под секретом \+ IP allowlist  
* Кешировать settings в Redis (TTL 60–300s)

**Acceptance Criteria**

* Лимиты можно изменить без релиза extension  
* Изменение вступает в силу в разумное время (до 5 минут)

---

## **2.6 Security baseline**

25 часов

**Задачи**

* Ограничение размера текста (например 8000 символов)  
* Ограничение тела запроса (на уровне proxy)  
* CORS политика (если нужна; для extension обычно можно вообще не полагаться на CORS)  
* Логи: request\_id, installation\_id, ip, status, latency  
* Basic denylist (ручной список IP)

**Acceptance Criteria**

* Большие/пустые запросы отклоняются  
* Логи содержат достаточно данных для диагностики

---

# **EPIC 3 — Extension V2 (toolbar рядом \+ активное поле \+ хоткеи)**

## **3.1 Content script framework: tracking active field**

**Задачи**

* Логика “active field”:  
  * слушать `focusin` и хранить последнюю цель  
  * поддержка `textarea`, `input`, `contenteditable`  
* Общая функция `getText/setText` для разных типов  
* Проверка “если нет активного поля” → показать уведомление

**Acceptance Criteria**

* Улучшение работает только для последнего сфокусированного поля  
* Корректно читается/вставляется текст в textarea и contenteditable (минимально)

---

## **3.2 Toolbar-плашка: mount \+ позиционирование \+ стили**

**Задачи**

* Компонент toolbar:  
  * иконка ✨  
  * tooltip “Improve prompt”  
  * состояние loading/disabled  
* Mount:  
  * попытка привязать к найденному контейнеру композера (через адаптер)  
  * fallback: позиционировать рядом с active field по bounding rect  
* Обновление при SPA навигации:  
  * MutationObserver  
  * ремоунт при исчезновении/замене DOM

**Acceptance Criteria**

* Плашка появляется на целевых сайтах  
* Плашка не перекрывает ввод и не ломает layout  
* Не дублируется бесконечно при обновлениях DOM

---

## **3.3 Улучшение из in-page toolbar**

**Задачи**

* По клику:  
  * взять текст из active field  
  * отправить background `IMPROVE_REQUEST`  
  * получить improved  
  * вставить обратно и триггернуть события  
* Обработка ошибок:  
  * rate limit → показать сообщение (toast)  
  * сеть → показать сообщение

**Acceptance Criteria**

* Один клик → заменяет текст на improved  
* При ошибках текст не теряется

---

## **3.4 Hotkeys (commands)**

**Задачи**

* Добавить `commands` в manifest  
* Background обработчик команды:  
  * отправить в активную вкладку команду “improve active field”  
* Content script обработчик

**Acceptance Criteria**

* Хоткей работает на поддерживаемых сайтах  
* Если активного поля нет — подсказка пользователю

---

# **EPIC 4 — Site adapters (первые 5 сайтов) \+ расширяемость**

## **4.1 Общий интерфейс адаптера \+ fallback**

**Задачи**

* Определить интерфейс:  
  * findComposerContainer  
  * findEditableField (optional)  
  * mountToolbar  
* Реализовать fallback через activeElement  
* Логирование/diagnostics режим (в dev)

**DoD**

* Новый сайт добавляется минимально: домен \+ селектор \+ тест

---

## **4.2 Адаптеры (MVP набор)**

**Для каждого сайта отдельный набор задач**

* ChatGPT  
* Claude  
* Perplexity  
* Groq  
* Deepseek

**Подзадачи на сайт**

* Найти стабильные селекторы композера/поля  
* Реализовать `setText` корректно под их композер  
* Протестировать:  
  * вставку через Open & Paste  
  * toolbar улучшение  
  * hotkey

**Acceptance Criteria**

* На каждом сайте работают:  
  * Open & Paste  
  * toolbar improve  
  * hotkey improve

**Риски**

* Сайты часто меняют DOM → нужна стратегия обновлений и ретраи

---

# **EPIC 5 — Публикация в сторах и соответствие политикам**

## **5.1 Подготовка пакетов и метаданных**

**Задачи**

* Сборка артефактов:  
  * Chrome Web Store zip  
  * Firefox AMO zip  
  * Edge Add-ons (обычно можно тот же chromium билд)  
* Иконки, скриншоты, описания, privacy policy  
* Проверка permissions минимизации  
* Проверка на “remote code” запреты (в расширении не должно быть подтягивания JS)

**Acceptance Criteria**

* Пакеты проходят локальную проверку  
* Готовы тексты для стора

---

## **5.2 Прохождение ревью (процессная задача)**

**Задачи**

* Исправления по замечаниям стора (обычно: permissions, privacy, disclosure)

---

# **EPIC 6 — Observability и эксплуатация на VPS**

## **6.1 Reverse proxy \+ TLS \+ базовая защита**

**Задачи**

* Настроить Caddy/Nginx:  
  * TLS  
  * ограничения размера body  
  * базовый rate limit на уровне proxy (грубая отсечка)  
* Логи доступа

---

## **6.2 Мониторинг/ошибки (минимум)**

**Задачи**

* Sentry (backend) или аналог  
* Метрики latency/rate-limit counts (опционально)

---

# **EPIC 7 — Будущее: Safari (не в MVP, но подготовить)**

## **7.1 Анализ требований Safari Web Extension**

**Задачи**

* Проверить совместимость API, ограничений, сборки WXT под Safari  
* План упаковки в app и публикации через App Store Connect

---

# **Тестирование (рекомендуем как отдельные задачи внутри эпиков)**

## **Extension**

* Unit tests для storage/utils (по желанию)  
* Минимальные e2e-сценарии руками: чеклист для 5 сайтов

## **Backend**

* Unit tests:  
  * rate limiting  
  * нормализация ответа  
* Интеграционные:  
  * Redis \+ Postgres в docker compose  
  * мок LiteLLM (или тестовый провайдер)

---

