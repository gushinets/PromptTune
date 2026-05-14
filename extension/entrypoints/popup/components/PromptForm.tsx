import { useEffect, useId, useMemo, useState } from "react";
import { locale, useT } from "@shared/i18n";
import type { AudienceMode, ImproveGoal } from "@shared/types";

const AI_GOAL_ORDER: ImproveGoal[] = [
  "general",
  "chatgpt",
  "claude",
  "perplexity",
  "structured",
  "deep_research",
];
const CONTENT_GOAL_ORDER: ImproveGoal[] = [
  "general",
  "seo_article",
  "product_description",
  "ad_copy",
  "email",
  "landing_page",
];

const CHANGE_LINE_TRANSLATIONS_RU: Record<string, string> = {
  "Made the goal and expected result more explicit.":
    "Сделали цель и ожидаемый результат более явными.",
  "Improved wording for clearer, more reliable execution.":
    "Улучшили формулировки для более понятного и стабильного выполнения.",
  "Preserved the original intent while tightening the instructions.":
    "Сохранили исходный замысел и сделали инструкции точнее.",
  "Balanced clarity, specificity, and structure without changing intent.":
    "Сбалансировали ясность, конкретику и структуру без изменения исходного смысла.",
  "Adjusted wording for ChatGPT-style instruction following and response quality.":
    "Скорректировали формулировки под стиль ChatGPT: лучшее следование инструкциям и качество ответа.",
  "Adjusted wording for Claude-style long-context reasoning and safer framing.":
    "Скорректировали формулировки под стиль Claude: работа с длинным контекстом и более безопасная подача.",
  "Adjusted wording for web-grounded answers with stronger source expectations.":
    "Скорректировали формулировки под ответы с опорой на веб-источники и более строгие требования к источникам.",
  "Reshaped the prompt toward predictable structured output.":
    "Перестроили промпт под предсказуемый структурированный результат.",
  "Expanded scope and rigor for deeper research-style responses.":
    "Расширили охват и требования, чтобы получить более глубокий исследовательский ответ.",
  "Balanced clarity and structure for content production tasks.":
    "Сбалансировали ясность и структуру для задач по созданию контента.",
  "Added SEO-oriented structure with heading and keyword guidance.":
    "Добавили SEO-структуру с заголовками и подсказками по ключевым словам.",
  "Focused wording on product value, features, and clear CTA.":
    "Сфокусировали формулировки на ценности продукта, характеристиках и понятном CTA.",
  "Tightened the copy around hook, offer, and action-oriented CTA.":
    "Сделали текст более точным вокруг хука, оффера и CTA с призывом к действию.",
  "Improved message flow for concise, actionable email communication.":
    "Улучшили логику сообщения для краткого и практичного email-формата.",
  "Structured the prompt for offer, value proposition, and proof elements.":
    "Структурировали промпт под оффер, ценностное предложение и элементы доказательности.",
  "Added structure to improve readability and step-by-step execution.":
    "Добавили структуру для лучшей читаемости и пошагового выполнения.",
  "Added concrete context to improve answer precision.":
    "Добавили конкретный контекст, чтобы повысить точность ответа.",
  "Condensed the wording while preserving key constraints.":
    "Сократили формулировки, сохранив ключевые ограничения.",
  "Made key constraints more explicit for better output control.":
    "Сделали ключевые ограничения более явными для лучшего контроля результата.",
};

interface PromptFormProps {
  original: string;
  improved: string;
  improvements: string[];
  mode: AudienceMode;
  goal: ImproveGoal;
  loading: boolean;
  onGoalChange: (goal: ImproveGoal) => void;
  onOriginalChange: (text: string) => void;
  onImprove: () => void;
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
      <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z" />
    </svg>
  );
}

export function PromptForm({
  original,
  improved,
  improvements,
  mode,
  goal,
  loading,
  onGoalChange,
  onOriginalChange,
  onImprove,
}: PromptFormProps) {
  const t = useT();
  const goalGroupName = useId();
  const [isImprovementsOpen, setIsImprovementsOpen] = useState(false);
  const isCompactLayout = loading || Boolean(improved) || improvements.length > 0;
  const goalLabels: Record<ImproveGoal, string> = {
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
  };

  useEffect(() => {
    if (improvements.length === 0) {
      setIsImprovementsOpen(false);
    }
  }, [improvements]);

  const localizedImprovements = useMemo(() => {
    if (locale !== "ru") return improvements;
    return improvements.map((line) => CHANGE_LINE_TRANSLATIONS_RU[line] ?? line);
  }, [improvements]);

  const goalOrder = mode === "ai" ? AI_GOAL_ORDER : CONTENT_GOAL_ORDER;

  return (
    <div className="prompt-form">
      <span className="section-label">{t.labelOriginalPrompt}</span>
      <textarea
        value={original}
        onChange={(e) => onOriginalChange(e.target.value)}
        placeholder={t.placeholderOriginal}
        rows={isCompactLayout ? 2 : 4}
      />
      <fieldset className="goal-pills">
        <legend className="sr-only">{t.goalLabel}</legend>
        {goalOrder.map((option) => {
          const isActive = goal === option;
          return (
            <label key={option} className={`goal-pill${isActive ? " active" : ""}`}>
              <input
                className="goal-pill-input"
                type="radio"
                name={goalGroupName}
                value={option}
                checked={isActive}
                onChange={() => onGoalChange(option)}
                disabled={loading}
              />
              <span className="goal-pill-text">{goalLabels[option]}</span>
            </label>
          );
        })}
      </fieldset>
      <button className="btn-improve" onClick={onImprove} disabled={!original.trim() || loading}>
        {loading ? (
          <>
            <span className="spinner" />
            {t.btnImproving}
          </>
        ) : (
          <>
            <SparkleIcon className="btn-icon" />
            {t.btnImprove}
          </>
        )}
      </button>
      <span className="section-label">{t.labelImprovedPrompt}</span>
      {loading ? (
        <div className="skeleton-loader">
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      ) : (
        <>
          <textarea
            className="improved-textarea"
            value={improved}
            readOnly
            placeholder={t.placeholderImproved}
            rows={localizedImprovements.length > 0 ? 2 : 3}
          />
          {improved && <p className="improve-hint">{t.improveHint}</p>}
          {localizedImprovements.length > 0 && (
            <details
              className="improvements-details"
              open={isImprovementsOpen}
              onToggle={(event) => setIsImprovementsOpen(event.currentTarget.open)}
            >
              <summary>{t.whyItChanged}</summary>
              <ul className="improvements-list">
                {localizedImprovements.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
