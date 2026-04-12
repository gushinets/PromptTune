import { createContext, useContext, type ReactNode } from "react";
import { en, type TranslationKeys } from "./en";
import { ru } from "./ru";

// Detect browser language once at module load — no runtime overhead
function detectLocale(): "en" | "ru" {
  try {
    const lang = chrome.i18n.getUILanguage();
    if (lang.startsWith("ru")) return "ru";
  } catch {
    // Fallback: use navigator.language if chrome.i18n is unavailable (e.g. in tests)
    if (navigator.language?.startsWith("ru")) return "ru";
  }
  return "en";
}

const TRANSLATIONS: Record<"en" | "ru", TranslationKeys> = { en, ru };

export const locale = detectLocale();
export const translations = TRANSLATIONS[locale];

// React context — lets components access translations without prop drilling
const I18nContext = createContext<TranslationKeys>(translations);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={translations}>{children}</I18nContext.Provider>;
}

/** Use inside any component to get the current translations object. */
export function useT(): TranslationKeys {
  return useContext(I18nContext);
}
