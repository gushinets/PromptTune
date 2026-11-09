import type { ImproveGoal } from "./types";
import type { TranslationKeys } from "./i18n/en";

export const AI_GOALS: ImproveGoal[] = [
  "general",
  "chatgpt",
  "claude",
  "perplexity",
  "structured",
  "deep_research",
];
export const CONTENT_GOALS: ImproveGoal[] = [
  "general",
  "seo_article",
  "product_description",
  "ad_copy",
  "email",
  "landing_page",
];
export function goalLabel(t: TranslationKeys, goal: ImproveGoal): string {
  return {
    general: t.goalGeneral,
    chatgpt: t.goalChatgpt,
    claude: t.goalClaude,
    perplexity: t.goalPerplexity,
    structured: t.goalStructured,
    deep_research: t.goalDeepResearch,
    seo_article: t.goalSeoArticle,
    product_description: t.goalProductDescription,
    ad_copy: t.goalAdCopy,
    email: t.goalEmail,
    landing_page: t.goalLandingPage,
  }[goal];
}
