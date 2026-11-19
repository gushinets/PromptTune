import type { ImproveGoal } from "../types";
import { formatCharacterCount } from "../prompt-length";
export const en = {
  returnToResult: "Return to result",
  emailBonusTitle: "Get 50 more improvements?",
  emailBonusDescription: "Leave your email and get 50 more free PromptOptimizer improvements",
  emailBonusRequest: "Get 50 more improvements",
  emailBonusCodeTitle: "Confirm your email",
  emailBonusCodeDescription: "Enter the six-digit code from the email. It expires in 10 minutes.",
  emailBonusConfirm: "Confirm email",
  emailBonusResend: "Send a new code",
  emailBonusChange: "Change email",
  emailBonusClose: "Return to result and library",
  emailBonusPending: "Please wait…",
  emailBonusSent: "A new code has been sent",
  emailBonusCodeLabel: "Verification code",
  quotaRenewal: (date: string) => `50 free improvements will be available again on ${date}.`,
  quotaTemporary: "Too many requests. Please try again shortly.",

  modeShortAi: "AI",
  modeShortContent: "Content",
  btnCancel: "Cancel",
  btnEditOriginal: "Edit original",
  btnNew: "New",
  processingTitle: "Improving your prompt…",
  processingWaiting:
    "Waiting for the improved prompt. These steps illustrate the optimization process.",
  processingStepIntent: "Analyzing the intent",
  processingStepContext: "Refining role and context",
  processingStepStructure: "Structuring the output",
  processingStepConstraints: "Checking constraints",
  insertHint: "Insert directly into the AI chat input",
  errorCopyMessage: "Could not copy the prompt. Select the result and copy it manually.",
  errorNoEditableField:
    "No supported input field found. Open an AI chat and focus its prompt field.",
  goalHint: (goal: ImproveGoal) =>
    ({
      general: "A clear role, task, context and output format.",
      chatgpt: "Clear instructions and a step-by-step response format.",
      claude: "Distinct context, task and output requirements for Claude.",
      perplexity: "Source requirements and up-to-date information.",
      structured: "Markdown sections and a predictable output structure.",
      deep_research: "A research plan, evidence and confidence levels.",
      seo_article: "A prompt for an SEO article with structure and keywords.",
      product_description: "A prompt focused on product value, benefits and key details.",
      ad_copy: "A prompt for persuasive copy with a clear call to action.",
      email: "A prompt for an email with an audience, purpose and next step.",
      landing_page: "A prompt for a landing page with an offer and supporting evidence.",
    })[goal] ?? "",

  // Header
  appName: "PromptOptimizer",
  modeBadgeAi: "AI Mode",
  modeBadgeContent: "Content Mode",
  settingsOpen: "Open settings",
  settingsTitle: "Settings",
  settingsClose: "Close settings",
  settingsModeHint: "Pick your primary workflow. You can change this anytime.",
  settingsModeRequiredTitle: "Choose mode to continue",
  settingsModeRequiredSubtitle: "Set your mode once in settings to tailor goal presets.",
  rateLimitUnlimited: "Unlimited",
  rateLimitLoading: "Loading limits...",
  rateLimitUnavailable: "Limits unavailable",
  rateLimitToday: (remaining: number, total: number) =>
    total > 0 ? `${remaining}/${total} this month` : `${remaining} this month`,
  tooltipLoading: "Loading your monthly free improvement balance.",
  tooltipUnavailable:
    "We couldn't load your current balance. Improvements still work, and the next successful request will refresh this count.",
  tooltipRemaining: (remaining: number, total: number) =>
    total > 0 ? `${remaining} free` : String(remaining),
  tooltipImprovementsLeft: "improvements left this month",
  tooltipDailyLimit: (total: number) => `Monthly package: ${total}. `,
  tooltipResets: "Renews monthly at midnight Moscow time.",
  tooltipUpgrade: "Upgrade for unlimited",

  // Layout toggle
  switchToSidebar: "Open as sidebar",
  switchToPopup: "Close sidebar (click extension icon to open popup)",

  // Tabs
  tabImprove: "Improve",
  tabLibrary: "Library",

  // Improve tab
  exhaustedTitle: "You've used all free improvements this month.",
  btnUpgrade: "Upgrade for unlimited",
  proComingSoonTitle: "Pro soon",
  proComingSoonSubtitle: "Paid plans and waitlist are not open yet.",

  // PromptForm
  modeLabel: "Mode",
  modeAi: "AI prompts",
  modeContent: "Marketing content",
  onboardingTitle: "Choose your mode",
  onboardingSubtitle: "You can switch this anytime in settings below.",
  onboardingAiTitle: "I work with AI prompts",
  onboardingAiDescription: "Model-aware optimization for ChatGPT, Claude, and research workflows.",
  onboardingContentTitle: "I create marketing content",
  onboardingContentDescription:
    "Output-focused optimization for SEO pages, product copy, ads, emails, and landing pages.",
  labelOriginalPrompt: "Original Prompt",
  labelImprovedPrompt: "Improved Prompt",
  placeholderOriginal:
    "e.g. Write a follow-up email to a client who didn't respond to my roof repair quote...",
  placeholderImproved: "Improved version will appear here...",
  goalLabel: "Improvement goal",
  goalGeneral: "General",
  goalChatgpt: "ChatGPT",
  goalClaude: "Claude",
  goalPerplexity: "Perplexity",
  goalStructured: "Structured",
  goalDeepResearch: "Deep research",
  goalSeoArticle: "SEO article",
  goalProductDescription: "Product description",
  goalAdCopy: "Ad copy",
  goalEmail: "Email",
  goalLandingPage: "Landing page",
  btnImprove: "Improve",
  btnImproving: "Improving...",
  improveHint: "✦ Prompt optimized for clarity, specificity and structure",
  whyItChanged: "Why it changed",

  // ActionBar
  btnCopy: "Copy",
  btnCopied: "Copied!",
  btnInsert: "Insert",
  btnInserted: "Inserted!",
  btnSaveToLibrary: "Save to Library",
  btnSaveShort: "Save",
  btnSaved: "Saved!",

  // LibraryItem
  siteGeneral: "General",
  libraryExpand: "Read full entry",
  libraryCollapse: "Collapse",
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
    `You've used all ${total.toLocaleString()} improvements this month.`,
  errorGenericFallback: "Something went wrong. Please try again.",
  errorInputTooLong: (max: number) =>
    `Text is too long (maximum ${formatCharacterCount(max)} characters). Shorten it or split it into parts.`,
  errorLibraryStorageMessage:
    "Could not save the prompt on this device. Free up extension storage and try again." as string,
  errorSidePanelMessage:
    "Could not open the side panel. The source tab may have closed or the browser may not support it. Your prompt is still available here.",
  privateSelectionUnavailable:
    "Improving selected text from private browsing is not supported. Your selection has not been saved or sent to the optimizer.",
  errorSelectionUnavailable:
    "Could not load the selected text. Close this window and select the text again, or enter a new prompt here.",
  errorSourceSessionEnded:
    "The original browser session has ended. Use Copy or start a new prompt to insert into the current page.",
  errorPanelTransferPreserved:
    "The new prompt could not be transferred. This panel still shows your previous session; the new prompt remains in its optimizer window.",
  errorPanelReadMessage:
    "Could not load the transferred prompt. Retry to recover it before the transfer expires.",
  errorEmptyResponse: "The backend returned an empty improved prompt.",
} as const;

export type TranslationKeys = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? string : (typeof en)[K];
};
