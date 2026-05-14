import type { TranslationKeys } from "./en";

export const ru: TranslationKeys = {
  // Header
  appName: "PromptTune",
  modeBadgeAi: "AI режим",
  modeBadgeContent: "Content режим",
  settingsOpen: "Открыть настройки",
  settingsTitle: "Настройки",
  settingsClose: "Закрыть настройки",
  settingsModeHint: "Выберите основной сценарий работы. Это можно поменять в любой момент.",
  settingsModeRequiredTitle: "Выберите режим для продолжения",
  settingsModeRequiredSubtitle: "Установите режим в настройках, чтобы получить нужные пресеты.",
  rateLimitUnlimited: "Без лимита",
  rateLimitLoading: "Загрузка...",
  rateLimitUnavailable: "Лимиты недоступны",
  rateLimitToday: (remaining: number, total: number) =>
    total > 0 ? `${remaining}/${total} сегодня` : `${remaining} сегодня`,
  tooltipLoading: "Загружаем ваш дневной баланс бесплатных запросов.",
  tooltipUnavailable:
    "Не удалось загрузить баланс. Улучшения работают, следующий успешный запрос обновит счётчик.",
  tooltipRemaining: (remaining: number, total: number) =>
    total > 0 ? `${remaining} бесплатных` : String(remaining),
  tooltipImprovementsLeft: "улучшений осталось сегодня",
  tooltipDailyLimit: (total: number) => `Дневной лимит: ${total}. `,
  tooltipResets: "Сбрасывается в полночь UTC.",
  tooltipUpgrade: "Перейти на безлимит",

  // Layout toggle
  switchToSidebar: "Открыть как панель",
  switchToPopup: "Закрыть панель (нажмите на иконку расширения для попапа)",

  // Tabs
  tabImprove: "Улучшить",
  tabLibrary: "Библиотека",

  // Improve tab
  exhaustedTitle: "Вы использовали все бесплатные улучшения сегодня.",
  btnUpgrade: "Перейти на безлимит",

  // PromptForm
  modeLabel: "Режим",
  modeAi: "AI промпты",
  modeContent: "Маркетинговый контент",
  onboardingTitle: "Выберите режим",
  onboardingSubtitle: "Позже его можно изменить ниже в настройках.",
  onboardingAiTitle: "Я работаю с AI-промптами",
  onboardingAiDescription:
    "Оптимизация под модели: ChatGPT, Claude и сценарии глубокого исследования.",
  onboardingContentTitle: "Я создаю маркетинговый контент",
  onboardingContentDescription:
    "Оптимизация под результат: SEO, карточки товара, рекламу, email и лендинги.",
  labelOriginalPrompt: "Исходный промпт",
  labelImprovedPrompt: "Улучшенный промпт",
  placeholderOriginal: "например, Напиши письмо клиенту, который не ответил на мой запрос...",
  placeholderImproved: "Улучшенная версия появится здесь...",
  goalLabel: "Цель улучшения",
  goalGeneral: "Общее",
  goalChatgpt: "ChatGPT",
  goalClaude: "Claude",
  goalPerplexity: "Perplexity",
  goalStructured: "Структурировано",
  goalDeepResearch: "Глубокое исследование",
  goalSeoArticle: "SEO статья",
  goalProductDescription: "Описание товара",
  goalAdCopy: "Рекламный текст",
  goalEmail: "Email",
  goalLandingPage: "Лендинг",
  btnImprove: "Улучшить",
  btnImproving: "Улучшаем...",
  improveHint: "✦ Промпт оптимизирован по ясности, конкретности и структуре",
  whyItChanged: "Почему это изменилось",

  // ActionBar
  btnCopy: "Копировать",
  btnCopied: "Скопировано!",
  btnInsert: "Вставить",
  btnInserted: "Вставлено!",
  btnSaveToLibrary: "Сохранить в библиотеку",
  btnSaved: "Сохранено!",

  // LibraryItem
  siteGeneral: "Общее",
  labelOriginal: "Исходный:",
  labelImproved: "Улучшенный:",
  timeJustNow: "Только что",
  timeMinsAgo: (m: number) => `${m} мин. назад`,
  timeHoursAgo: (h: number) => `${h} ч. назад`,
  timeYesterday: "Вчера",
  timeDaysAgo: (d: number) => `${d} дн. назад`,
  timeMonthsAgo: (mo: number) => `${mo} мес. назад`,
  titleCopy: "Копировать улучшенный промпт",
  titleCopied: "Скопировано!",
  titleDelete: "Удалить",

  // ErrorToast
  errorTitleRateLimit: "Лимит запросов исчерпан.",
  errorTitleAuth: "Неверный логин.",
  errorTitleNetwork: "Нет соединения.",
  errorTitleGeneric: "Ошибка",
  btnRetry: "Повторить",
  ariaLabelDismiss: "Закрыть",

  // Library
  emptyStateNoPrompts: "Сохранённых промптов пока нет.",
  emptyStateNoResults: "Промпты не найдены.",
  storagePromptSingular: "промпт",
  storagePromptPlural: "промптов",
  storageUsed: "использовано",

  // RatingBar
  ratingLabel: "Оцените нас",
  ariaLabelRateStar: (star: number) =>
    `Оценить на ${star} ${star === 1 ? "звезду" : star < 5 ? "звезды" : "звёзд"}`,

  // SearchBar
  searchPlaceholder: "Поиск промптов...",

  // SiteIcons
  openAndPasteLabel: "Открыть и вставить",
  openAndPasteTitle: (site: string) => `Открыть и вставить в ${site}`,

  // Errors
  errorAuthMessage: "Ваш логин недействителен. Обновите или переустановите расширение.",
  errorNetworkMessage: "Проверьте интернет-соединение и попробуйте снова.",
  errorRateLimitMessage: (total: number) =>
    total > 0
      ? `Вы использовали все ${total.toLocaleString()} запросов сегодня. Сброс в полночь UTC.`
      : "Вы использовали все запросы сегодня. Сброс в полночь UTC.",
  errorGenericFallback: "Что-то пошло не так. Попробуйте снова.",
  errorEmptyResponse: "Бэкенд вернул пустой улучшенный промпт.",
};
