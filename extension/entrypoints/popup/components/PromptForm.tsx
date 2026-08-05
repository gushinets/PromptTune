import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import browser from "webextension-polyfill";
import { locale, useT } from "@shared/i18n";
import type { AudienceMode, ImproveGoal } from "@shared/types";

const PROMPT_TEXTAREA_MIN_HEIGHT = 72;
const PROMPT_TEXTAREA_WITH_IMPROVEMENTS_MIN_HEIGHT = 56;
const RESIZE_KEYBOARD_STEP = 12;
const RESIZE_KEYBOARD_LARGE_STEP = 48;
const PROMPT_TEXTAREA_ARIA_MAX_HEIGHT = 2000;

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

const APP_ICON_SRC = browser.runtime.getURL("icon-32.png");

function promptTextareaShellStyle(height: number | null): CSSProperties | undefined {
  if (!height) return undefined;
  return {
    flex: `0 0 ${height}px`,
    height: `${height}px`,
  };
}

function clampHeight(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getTabContentBottomLimit(promptForm: HTMLDivElement, ownerWindow: Window): number {
  const tabContent = promptForm.closest(".tab-content") as HTMLElement | null;
  const promptFormNextSibling = promptForm.nextElementSibling as HTMLElement | null;
  const tabContentGap =
    tabContent !== null
      ? Number.parseFloat(ownerWindow.getComputedStyle(tabContent).rowGap || "0") || 0
      : 0;

  return (
    (promptFormNextSibling?.getBoundingClientRect().top ??
      tabContent?.getBoundingClientRect().bottom ??
      promptForm.getBoundingClientRect().bottom) - tabContentGap
  );
}

function isVisibleForLayout(element: HTMLElement): boolean {
  if (element.classList.contains("improved-output-section")) {
    return false;
  }

  const closedDetails = element.closest("details:not([open])");
  if (closedDetails && element !== closedDetails && element.tagName !== "SUMMARY") {
    return false;
  }

  return element.getClientRects().length > 0;
}

function getPromptFormContentBottom(promptForm: HTMLDivElement): number {
  return Array.from(promptForm.querySelectorAll<HTMLElement>("*"))
    .filter(isVisibleForLayout)
    .reduce(
      (bottom, child) => Math.max(bottom, child.getBoundingClientRect().bottom),
      promptForm.getBoundingClientRect().top,
    );
}

function applyResize(
  requestedHeight: number,
  minHeight: number,
  setHeight: (height: number) => void,
  maxHeight = PROMPT_TEXTAREA_ARIA_MAX_HEIGHT,
): void {
  setHeight(clampHeight(requestedHeight, minHeight, maxHeight));
}

function getResizeMaxHeight(
  promptForm: HTMLDivElement,
  ownerWindow: Window,
  shell: HTMLDivElement,
): number {
  const shellHeight = shell.getBoundingClientRect().height;
  const freeSpaceUntilActions = Math.max(
    0,
    getTabContentBottomLimit(promptForm, ownerWindow) - getPromptFormContentBottom(promptForm),
  );

  return Math.min(PROMPT_TEXTAREA_ARIA_MAX_HEIGHT, shellHeight + freeSpaceUntilActions);
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
  const [originalHeight, setOriginalHeight] = useState<number | null>(null);
  const [improvedHeight, setImprovedHeight] = useState<number | null>(null);
  const promptFormRef = useRef<HTMLDivElement | null>(null);
  const improvementsDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const originalShellRef = useRef<HTMLDivElement | null>(null);
  const originalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const improvedShellRef = useRef<HTMLDivElement | null>(null);
  const improvedTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hadImprovedTextRef = useRef(Boolean(improved.trim()));
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

  useEffect(() => {
    const hasImprovedText = Boolean(improved.trim());
    const hadImprovedText = hadImprovedTextRef.current;
    hadImprovedTextRef.current = hasImprovedText;

    if (!hasImprovedText || !hadImprovedText) {
      setImprovedHeight(null);
    }
  }, [improved]);

  useEffect(() => {
    if (!isImprovementsOpen) return;

    const ownerDocument = promptFormRef.current?.ownerDocument;
    if (!ownerDocument) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!improvementsDetailsRef.current?.contains(event.target as Node)) {
        setIsImprovementsOpen(false);
      }
    };

    ownerDocument.addEventListener("mousedown", handlePointerDown);
    return () => {
      ownerDocument.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isImprovementsOpen]);

  const localizedImprovements = useMemo(() => {
    if (locale !== "ru") return improvements;
    return improvements.map((line) => CHANGE_LINE_TRANSLATIONS_RU[line] ?? line);
  }, [improvements]);
  const promptTextareaMinHeight =
    localizedImprovements.length > 0
      ? PROMPT_TEXTAREA_WITH_IMPROVEMENTS_MIN_HEIGHT
      : PROMPT_TEXTAREA_MIN_HEIGHT;

  useLayoutEffect(() => {
    if (loading || localizedImprovements.length === 0) return;

    const promptForm = promptFormRef.current;
    const originalShell = originalShellRef.current;
    const improvedShell = improvedShellRef.current;
    const ownerWindow = promptForm?.ownerDocument.defaultView;
    if (!promptForm || !originalShell || !improvedShell || !ownerWindow) return;

    const overflow = Math.ceil(
      getPromptFormContentBottom(promptForm) - getTabContentBottomLimit(promptForm, ownerWindow),
    );
    if (overflow <= 0) return;

    const originalStartHeight = originalShell.getBoundingClientRect().height;
    const improvedStartHeight = improvedShell.getBoundingClientRect().height;
    const originalRoom = Math.max(0, originalStartHeight - promptTextareaMinHeight);
    const improvedRoom = Math.max(0, improvedStartHeight - promptTextareaMinHeight);
    const totalRoom = originalRoom + improvedRoom;
    if (totalRoom <= 0) return;

    const requestedReduction = Math.min(overflow, totalRoom);
    const originalReduction = Math.min(
      originalRoom,
      Math.ceil(requestedReduction * (originalRoom / totalRoom)),
    );
    const improvedReduction = Math.min(improvedRoom, requestedReduction - originalReduction);
    const remainingReduction = requestedReduction - originalReduction - improvedReduction;

    setOriginalHeight(
      originalStartHeight -
        originalReduction -
        Math.min(originalRoom - originalReduction, remainingReduction),
    );
    setImprovedHeight(
      improvedStartHeight -
        improvedReduction -
        Math.min(
          improvedRoom - improvedReduction,
          Math.max(0, remainingReduction - (originalRoom - originalReduction)),
        ),
    );
  }, [
    improved,
    isImprovementsOpen,
    loading,
    localizedImprovements.length,
    original,
    promptTextareaMinHeight,
  ]);

  const goalOrder = mode === "ai" ? AI_GOAL_ORDER : CONTENT_GOAL_ORDER;
  const promptTextareaResizeProps = (
    shellRef: RefObject<HTMLDivElement | null>,
    currentHeight: number | null,
    setHeight: (height: number) => void,
    otherShellRef: RefObject<HTMLDivElement | null>,
    setOtherHeight: (height: number) => void,
    label: string,
    minHeight: number,
  ) => ({
    role: "separator",
    tabIndex: 0,
    "aria-label": label,
    "aria-orientation": "horizontal" as const,
    "aria-valuemin": minHeight,
    "aria-valuemax": PROMPT_TEXTAREA_ARIA_MAX_HEIGHT,
    "aria-valuenow": Math.round(Math.max(currentHeight ?? minHeight, minHeight)),
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;

      const shell = shellRef.current;
      const otherShell = otherShellRef.current;
      const promptForm = promptFormRef.current;
      const ownerWindow = shell?.ownerDocument.defaultView;
      if (!shell || !promptForm || !ownerWindow) return;

      event.preventDefault();

      const shellRect = shell.getBoundingClientRect();
      const otherStartHeight = otherShell?.getBoundingClientRect().height ?? 0;
      const maxHeight = getResizeMaxHeight(promptForm, ownerWindow, shell);
      if (otherShell) {
        setOtherHeight(Math.max(minHeight, otherStartHeight));
      }

      const step = event.shiftKey ? RESIZE_KEYBOARD_LARGE_STEP : RESIZE_KEYBOARD_STEP;
      const currentShellHeight = shellRect.height;
      const requestedHeight =
        event.key === "Home"
          ? minHeight
          : event.key === "End"
            ? maxHeight
            : currentShellHeight + (event.key === "ArrowDown" ? step : -step);

      applyResize(requestedHeight, minHeight, setHeight, maxHeight);
    },
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      const shell = shellRef.current;
      const otherShell = otherShellRef.current;
      const promptForm = promptFormRef.current;
      const ownerWindow = shell?.ownerDocument.defaultView;
      if (!shell || !promptForm || !ownerWindow) return;

      event.preventDefault();

      const startY = event.clientY;
      const shellRect = shell.getBoundingClientRect();
      const startHeight = shellRect.height;
      const otherStartHeight = otherShell?.getBoundingClientRect().height ?? 0;
      const maxHeight = getResizeMaxHeight(promptForm, ownerWindow, shell);
      if (otherShell) {
        setOtherHeight(Math.max(minHeight, otherStartHeight));
      }

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        applyResize(startHeight + (moveEvent.clientY - startY), minHeight, setHeight, maxHeight);
      };

      const handlePointerUp = () => {
        ownerWindow.removeEventListener("pointermove", handlePointerMove);
        ownerWindow.removeEventListener("pointerup", handlePointerUp);
      };

      ownerWindow.addEventListener("pointermove", handlePointerMove);
      ownerWindow.addEventListener("pointerup", handlePointerUp);
    },
  });

  return (
    <div
      className={`prompt-form${localizedImprovements.length > 0 ? " has-improvements" : ""}`}
      ref={promptFormRef}
    >
      <span className="section-label">{t.labelOriginalPrompt}</span>
      <div
        className="prompt-textarea-shell original-textarea-shell"
        ref={originalShellRef}
        style={promptTextareaShellStyle(originalHeight)}
      >
        <textarea
          ref={originalTextareaRef}
          className="prompt-textarea original-textarea"
          value={original}
          onChange={(e) => onOriginalChange(e.target.value)}
          placeholder={t.placeholderOriginal}
          rows={isCompactLayout ? 2 : 4}
        />
        <div
          className="prompt-textarea-resize"
          {...promptTextareaResizeProps(
            originalShellRef,
            originalHeight,
            setOriginalHeight,
            improvedShellRef,
            setImprovedHeight,
            "Resize original prompt area",
            promptTextareaMinHeight,
          )}
        >
          <span className="prompt-textarea-resize-grip" />
        </div>
      </div>
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
            <img className="btn-icon" src={APP_ICON_SRC} alt="" aria-hidden="true" />
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
        <div className="improved-output-section">
          <div
            className="prompt-textarea-shell improved-textarea-shell"
            ref={improvedShellRef}
            style={promptTextareaShellStyle(improvedHeight)}
          >
            <textarea
              ref={improvedTextareaRef}
              className="prompt-textarea improved-textarea"
              value={improved}
              readOnly
              placeholder={t.placeholderImproved}
              rows={localizedImprovements.length > 0 ? 2 : 3}
            />
            <div
              className="prompt-textarea-resize improved-textarea-resize"
              {...promptTextareaResizeProps(
                improvedShellRef,
                improvedHeight,
                setImprovedHeight,
                originalShellRef,
                setOriginalHeight,
                "Resize improved prompt area",
                promptTextareaMinHeight,
              )}
            >
              <span className="prompt-textarea-resize-grip" />
            </div>
          </div>
          {improved && !isImprovementsOpen && <p className="improve-hint">{t.improveHint}</p>}
          {localizedImprovements.length > 0 && (
            <details
              ref={improvementsDetailsRef}
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
        </div>
      )}
    </div>
  );
}
