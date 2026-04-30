export const en = {
  // Header
  appName: "PromptTune",
  rateLimitUnlimited: "Unlimited",
  rateLimitLoading: "Loading limits...",
  rateLimitUnavailable: "Limits unavailable",
  rateLimitToday: (remaining: number, total: number) =>
    total > 0 ? `${remaining}/${total} today` : `${remaining} today`,
  tooltipLoading: "Loading your daily free request balance.",
  tooltipUnavailable:
    "We couldn't load your current balance. Improvements still work, and the next successful request will refresh this count.",
  tooltipRemaining: (remaining: number, total: number) =>
    total > 0 ? `${remaining} free` : String(remaining),
  tooltipImprovementsLeft: "improvements left today",
  tooltipDailyLimit: (total: number) => `Daily limit: ${total}. `,
  tooltipResets: "Resets at midnight UTC.",
  tooltipUpgrade: "Upgrade for unlimited",

  // Layout toggle
  switchToSidebar: "Open as sidebar",
  switchToPopup: "Close sidebar (click extension icon to open popup)",

  // Tabs
  tabImprove: "Improve",
  tabLibrary: "Library",

  // Improve tab
  exhaustedTitle: "You've used all free improvements today.",
  btnUpgrade: "Upgrade for unlimited",

  // PromptForm
  labelOriginalPrompt: "Original Prompt",
  labelImprovedPrompt: "Improved Prompt",
  placeholderOriginal:
    "e.g. Write a follow-up email to a client who didn't respond to my roof repair quote...",
  placeholderImproved: "Improved version will appear here...",
  btnImprove: "Improve",
  btnImproving: "Improving...",
  improveHint: "✦ Prompt optimized for clarity, specificity and structure",
  whatWasImproved: "What was improved",

  // ActionBar
  btnCopy: "Copy",
  btnCopied: "Copied!",
  btnInsert: "Insert",
  btnInserted: "Inserted!",
  btnSaveToLibrary: "Save to Library",
  btnSaved: "Saved!",

  // LibraryItem
  siteGeneral: "General",
  labelOriginal: "Original:",
  labelImproved: "Improved:",
  timeJustNow: "Just now",
  timeMinsAgo: (m: number) => `${m}m ago`,
  timeHoursAgo: (h: number) => `${h}h ago`,
  timeYesterday: "Yesterday",
  timeDaysAgo: (d: number) => `${d}d ago`,
  timeMonthsAgo: (mo: number) => `${mo}mo ago`,
  titleCopy: "Copy improved prompt",
  titleCopied: "Copied!",
  titleDelete: "Delete",

  // ErrorToast
  errorTitleRateLimit: "Rate limit exceeded.",
  errorTitleAuth: "Invalid login.",
  errorTitleNetwork: "Connection failed.",
  errorTitleGeneric: "Error",
  btnRetry: "Retry",
  ariaLabelDismiss: "Dismiss",

  // Library
  emptyStateNoPrompts: "No saved prompts yet.",
  emptyStateNoResults: "No prompts match your search.",
  storagePromptSingular: "prompt",
  storagePromptPlural: "prompts",
  storageUsed: "used",

  // RatingBar
  ratingLabel: "Rate us",
  ariaLabelRateStar: (star: number) => `Rate ${star} star${star > 1 ? "s" : ""}`,

  // SearchBar
  searchPlaceholder: "Search prompts...",

  // SiteIcons
  openAndPasteLabel: "Open & Paste",
  openAndPasteTitle: (site: string) => `Open & Paste in ${site}`,

  // Errors
  errorAuthMessage: "Your login is invalid. Try refreshing the extension or reinstalling.",
  errorNetworkMessage: "Check your internet and try again.",
  errorRateLimitMessage: (total: number) =>
    total > 0
      ? `You've used all ${total.toLocaleString()} requests today. Resets at midnight UTC.`
      : "You've used all requests today. Resets at midnight UTC.",
  errorGenericFallback: "Something went wrong. Please try again.",
  errorEmptyResponse: "The backend returned an empty improved prompt.",
} as const;

export type TranslationKeys = typeof en;
