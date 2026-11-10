import { countPromptCharacters, parseInputLengthError } from "@shared/prompt-length";
import { useState, useEffect, useCallback, useMemo, useRef, type FocusEvent } from "react";
import browser from "webextension-polyfill";
import { PromptForm } from "./components/PromptForm";
import { ProcessingScreen } from "./components/ProcessingScreen";
import { OptimizerResult } from "./components/OptimizerResult";
import { ActionBar } from "./components/ActionBar";
import { SiteIcons } from "./components/SiteIcons";
import { Library } from "./components/Library";
import { ErrorToast } from "./components/ErrorToast";
import { RatingBar } from "./components/RatingBar";
import {
  getAll,
  LibraryStorageError,
  save,
  getInstallationId,
  getAudienceMode,
  getPopupSessionDraft,
  setAudienceMode,
  setPopupSessionDraft,
} from "@shared/storage";
import { FEATURES, BACKEND_MODE, DEFAULT_PROMPT_INPUT_MAX_CHARS } from "@shared/constants";
import { apiClient, ApiError } from "@shared/api-client";
import {
  describeUnexpectedBackgroundResponse,
  extractImproveResponse,
  extractRateLimitResponse,
} from "@shared/response-utils";
import { useT } from "@shared/i18n";
import { isOptimizerRequestContext } from "@shared/goal-options";
import { createImproveOwner, type ImproveOwner } from "@shared/improve-owner";
import { trackEvent } from "@shared/analytics";
import type {
  AiImproveGoal,
  AudienceMode,
  ImproveGoal,
  PromptInputLimit,
  OptimizerRequestContext,
} from "@shared/types";

import type { PromptSelection } from "@shared/selection";

const RATE_LIMIT_TOOLTIP_ID = "rate-limit-tooltip";
const SUPPORTED_AI_SITE_HOSTS = ["chatgpt.com", "claude.ai", "perplexity.ai"] as const;

function isSupportedAiSiteHost(hostname: string): boolean {
  return SUPPORTED_AI_SITE_HOSTS.some(
    (supportedHost) => hostname === supportedHost || hostname.endsWith(`.${supportedHost}`),
  );
}

function detectAiGoalFromUrl(rawUrl: string | undefined): AiImproveGoal {
  if (!rawUrl) return "general";
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (!isSupportedAiSiteHost(host)) return "general";
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "chatgpt";
    if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
    if (host === "perplexity.ai" || host.endsWith(".perplexity.ai")) return "perplexity";
  } catch {
    // Ignore malformed tab URLs.
  }
  return "general";
}

function getSupportedSiteHostname(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return isSupportedAiSiteHost(hostname) ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function defaultGoalForMode(mode: AudienceMode, detectedAiGoal: AiImproveGoal): ImproveGoal {
  if (mode === "content") return "general";
  return detectedAiGoal;
}

type TabId = "improve" | "library";

/** The mode this UI is rendered in — affects layout toggle behaviour. */
export type ViewMode = "popup" | "sidepanel";

export interface ErrorInfo {
  type: "rate-limit" | "network" | "auth" | "generic";
  message: string;
}

const APP_ICON_SRC = browser.runtime.getURL("icon-32.png");

function LayoutSidebarRightIcon({
  className,
  mirrored = false,
}: {
  className?: string;
  mirrored?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  );
}

interface AppProps {
  /** Whether the App is rendered inside the Chrome side panel. Defaults to false (popup). */
  viewMode?: ViewMode;
  initialSelection?: PromptSelection;
}

export function App({ viewMode = "popup", initialSelection }: AppProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabId>("improve");
  const [original, setOriginal] = useState(initialSelection?.text ?? "");
  const [promptInputMaxChars, setPromptInputMaxChars] = useState<number>(
    DEFAULT_PROMPT_INPUT_MAX_CHARS,
  );

  const hasAuthoritativeInputLimitRef = useRef(false);
  const inputLimitRevisionRef = useRef(0);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (BACKEND_MODE !== "fastapi") return;
    let active = true;
    let pending = false;
    const refreshInputLimit = async () => {
      if (pending) return;
      pending = true;
      const revision = ++inputLimitRevisionRef.current;
      try {
        const response = await browser.runtime.sendMessage({ type: "GET_PROMPT_LIMIT" });
        const info = response as Partial<PromptInputLimit> | undefined;
        const limit = info?.max_chars;
        if (
          active &&
          revision === inputLimitRevisionRef.current &&
          typeof limit === "number" &&
          Number.isSafeInteger(limit) &&
          limit > 0
        ) {
          const fallback = info?.fallback !== false;
          if (fallback && hasAuthoritativeInputLimitRef.current) return;
          if (!fallback) hasAuthoritativeInputLimitRef.current = true;
          setPromptInputMaxChars(limit);
        }
      } catch {
        // Keep the current limit until the next activation.
      } finally {
        pending = false;
      }
    };
    const handleFocus = () => {
      void refreshInputLimit();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshInputLimit();
    };
    void refreshInputLimit();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const isOriginalOverLimit = useMemo(
    () => BACKEND_MODE === "fastapi" && countPromptCharacters(original) > promptInputMaxChars,
    [original, promptInputMaxChars],
  );

  const [improved, setImproved] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [audienceMode, setAudienceModeState] = useState<AudienceMode | null>(null);
  const [modeReady, setModeReady] = useState(false);
  const [detectedAiGoal, setDetectedAiGoal] = useState<AiImproveGoal>("general");
  const [goal, setGoal] = useState<ImproveGoal>("general");
  const [processingContext, setProcessingContext] = useState<OptimizerRequestContext | null>(null);
  const [resultContext, setResultContext] = useState<OptimizerRequestContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [layoutTransition, setLayoutTransition] = useState(false);
  const layoutTransitionRef = useRef(false);
  const [editingOriginal, setEditingOriginal] = useState(false);
  const activeRequestRef = useRef<string | null>(null);
  const activeOwnerRef = useRef<ImproveOwner | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [rateLimit, setRateLimit] = useState({ remaining: 0, total: 0 });
  const [limitsLoaded, setLimitsLoaded] = useState(false);
  const [limitsUnavailable, setLimitsUnavailable] = useState(false);
  const [libraryCount, setLibraryCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showProComingSoon, setShowProComingSoon] = useState(false);
  const [siteHostname, setSiteHostname] = useState<string | undefined>(undefined);
  const [siteResolved, setSiteResolved] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [lastRequestContextKey, setLastRequestContextKey] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [attemptN, setAttemptN] = useState(0);
  const [sessionDraftLoaded, setSessionDraftLoaded] = useState(false);
  const hasUserSelectedGoalRef = useRef(false);
  const hasTrackedPopupOpenedRef = useRef(false);

  const refreshLibraryCount = useCallback(() => {
    getAll().then((entries) => setLibraryCount(entries.length));
  }, []);

  const refreshActiveTabContext = useCallback(() => {
    const tabs =
      initialSelection?.sourceTabId !== undefined
        ? browser.tabs.get(initialSelection.sourceTabId).then((tab) => [tab])
        : browser.tabs.query({ active: true, currentWindow: true });
    tabs
      .then((tabs) => {
        const tabUrl = tabs[0]?.url;
        setSiteHostname(getSupportedSiteHostname(tabUrl));
        setDetectedAiGoal(detectAiGoalFromUrl(tabUrl));
        setSiteResolved(true);
      })
      .catch(() => {
        setSiteHostname(undefined);
        setDetectedAiGoal("general");
        setSiteResolved(true);
      });
  }, [initialSelection?.sourceTabId]);

  useEffect(() => {
    refreshLibraryCount();
  }, [refreshLibraryCount]);

  useEffect(() => {
    Promise.all([getAudienceMode(), getPopupSessionDraft()])
      .then(([mode, draft]) => {
        setAudienceModeState(mode);

        if (initialSelection || !draft) return;

        setActiveTab(draft.activeTab);
        setOriginal(draft.original);
        setImproved(draft.improved);
        const [requestMode, requestGoal] = draft.lastRequestContextKey?.split("|") ?? [];
        const legacyContext = { mode: requestMode, goal: requestGoal };
        const fallbackContext = isOptimizerRequestContext(legacyContext)
          ? legacyContext
          : { mode, goal: draft.goal };
        setResultContext(
          isOptimizerRequestContext(draft.result_context)
            ? draft.result_context
            : isOptimizerRequestContext(fallbackContext)
              ? fallbackContext
              : null,
        );
        setEditingOriginal(draft.optimizer_screen === "input");
        setChanges(draft.changes);
        setLastRequestId(draft.lastRequestId);
        setLastRequestContextKey(draft.lastRequestContextKey);
        setLastModel(draft.lastModel);
        setLastLatencyMs(draft.lastLatencyMs);
        setAttemptN(draft.attemptN);

        if (draft.goal) {
          hasUserSelectedGoalRef.current = true;
          setGoal(draft.goal);
        }
      })
      .finally(() => {
        setSessionDraftLoaded(true);
        setModeReady(true);
      });
  }, [initialSelection]);

  useEffect(() => {
    refreshActiveTabContext();

    if (viewMode !== "sidepanel") return;

    browser.tabs.onActivated.addListener(refreshActiveTabContext);
    browser.tabs.onUpdated.addListener(refreshActiveTabContext);

    return () => {
      browser.tabs.onActivated.removeListener(refreshActiveTabContext);
      browser.tabs.onUpdated.removeListener(refreshActiveTabContext);
    };
  }, [refreshActiveTabContext, viewMode]);

  useEffect(() => {
    if (!siteResolved || hasTrackedPopupOpenedRef.current) return;
    hasTrackedPopupOpenedRef.current = true;
    void trackEvent(
      "popup_opened",
      {
        site_hostname: siteHostname,
        hour: new Date().getHours(),
        user_plan: "free",
        view_mode: viewMode,
      },
      viewMode,
    );
  }, [siteHostname, siteResolved, viewMode]);

  useEffect(() => {
    if (!modeReady || !audienceMode) return;
    if (hasUserSelectedGoalRef.current) return;
    setGoal(defaultGoalForMode(audienceMode, detectedAiGoal));
  }, [audienceMode, detectedAiGoal, modeReady]);

  useEffect(() => {
    if (!sessionDraftLoaded) return;

    void setPopupSessionDraft({
      optimizer_screen: improved && !editingOriginal ? "result" : "input",
      result_context: resultContext,
      activeTab,
      original,
      improved,
      changes,
      goal,
      lastRequestId,
      lastRequestContextKey,
      lastModel,
      lastLatencyMs,
      attemptN,
    }).catch(() => undefined);
  }, [
    activeTab,
    attemptN,
    changes,
    goal,
    improved,
    editingOriginal,
    resultContext,
    lastLatencyMs,
    lastModel,
    lastRequestContextKey,
    lastRequestId,
    original,
    sessionDraftLoaded,
  ]);

  useEffect(() => {
    if (BACKEND_MODE !== "fastapi") return;
    browser.runtime
      .sendMessage({ type: "GET_LIMITS" })
      .then((res) => {
        const rate_limit = extractRateLimitResponse(res);
        if (!rate_limit) {
          setLimitsUnavailable(true);
          return;
        }
        setRateLimit({
          remaining: rate_limit.per_day_remaining,
          total: rate_limit.per_day_total,
        });
        setLimitsUnavailable(false);
        setLimitsLoaded(true);
      })
      .catch(() => {
        setLimitsUnavailable(true);
      });
  }, []);

  useEffect(() => {
    const className = viewMode === "sidepanel" ? "sidepanel-body" : "popup-body";
    document.body.classList.add(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [viewMode]);

  // ── Layout toggle ────────────────────────────────────────────────────────────
  const handleLayoutToggle = useCallback(async () => {
    if (activeRequestRef.current || layoutTransitionRef.current) return;
    layoutTransitionRef.current = true;
    setLayoutTransition(true);
    let closing = false;
    try {
      if (viewMode === "popup") {
        const tab =
          initialSelection?.sourceTabId !== undefined
            ? await browser.tabs.get(initialSelection.sourceTabId)
            : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
        if (activeRequestRef.current) return;
        const sidePanel = (
          browser as typeof browser & {
            sidePanel?: { open: (options: { windowId: number }) => Promise<void> };
          }
        ).sidePanel;
        if (tab?.windowId != null && sidePanel) {
          await sidePanel.open({ windowId: tab.windowId });
          if (activeRequestRef.current) return;
          window.close();
          closing = true;
        }
      } else {
        // Cannot open popup programmatically — just close sidebar
        // User needs to click the extension icon to open popup
        window.close();
        closing = true;
      }
    } catch {
      // fail silently
    } finally {
      if (!closing) {
        layoutTransitionRef.current = false;
        setLayoutTransition(false);
      }
    }
  }, [viewMode, initialSelection?.sourceTabId]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const isExhausted = BACKEND_MODE === "fastapi" && limitsLoaded ? rateLimit.remaining <= 0 : false;
  const isWarning =
    BACKEND_MODE === "fastapi" && limitsLoaded
      ? rateLimit.remaining > 0 && rateLimit.remaining <= 10
      : false;
  const showRateLimitTooltip = BACKEND_MODE === "fastapi";

  const rateLimitBadgeText =
    BACKEND_MODE !== "fastapi"
      ? t.rateLimitUnlimited
      : !limitsLoaded
        ? limitsUnavailable
          ? t.rateLimitUnavailable
          : t.rateLimitLoading
        : t.rateLimitToday(rateLimit.remaining, rateLimit.total);

  const handleTooltipBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(nextTarget)) {
      setShowTooltip(false);
    }
  }, []);

  const handleUpgradeClick = useCallback(
    (surface: "rate_limit_tooltip" | "rate_limit_banner") => {
      setShowProComingSoon(true);
      void trackEvent(
        "upgrade_clicked",
        {
          surface,
          destination: "coming_soon",
          email_collected: false,
          paid_checkout_enabled: false,
        },
        viewMode,
      );
    },
    [viewMode],
  );

  // ── Error mapping ────────────────────────────────────────────────────────────
  const mapErrorToToast = useCallback(
    (err: unknown): ErrorInfo => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const lengthLimit = parseInputLengthError(errorMessage);
      if (
        BACKEND_MODE === "fastapi" &&
        (err instanceof ApiError ? err.status === 422 : errorMessage.includes("422")) &&
        lengthLimit
      ) {
        inputLimitRevisionRef.current++;
        hasAuthoritativeInputLimitRef.current = true;
        setPromptInputMaxChars(lengthLimit);
        return { type: "generic", message: t.errorInputTooLong(lengthLimit) };
      }
      if (err instanceof ApiError) {
        if (err.status === 403 || err.detail.toLowerCase().includes("login is invalid")) {
          return { type: "auth", message: t.errorAuthMessage };
        }
        if (err.status === 429 || err.detail.toLowerCase().includes("rate limit")) {
          return { type: "rate-limit", message: t.errorRateLimitMessage(rateLimit.total) };
        }
        if (err.status === 422) {
          return { type: "generic", message: err.detail };
        }
      }

      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("403") || message.toLowerCase().includes("login is invalid")) {
        return { type: "auth", message: t.errorAuthMessage };
      }
      if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
        return { type: "rate-limit", message: t.errorRateLimitMessage(rateLimit.total) };
      }
      if (message.includes("422")) {
        const validationDetail = message.replace(/^.*API 422:\s*/i, "").trim();
        return { type: "generic", message: validationDetail || message };
      }
      if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.toLowerCase().includes("network")
      ) {
        return { type: "network", message: t.errorNetworkMessage };
      }
      return { type: "generic", message: message || t.errorGenericFallback };
    },
    [rateLimit.total, t],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleImprove = useCallback(async () => {
    if (isOriginalOverLimit || activeRequestRef.current || layoutTransitionRef.current) return;
    const trimmed = original.trim();
    if (!trimmed) return;
    if (!audienceMode) return;

    const currentRequestContextKey = `${audienceMode}|${goal}|${trimmed}`;
    const isRegeneration =
      !!lastRequestId &&
      !!lastRequestContextKey &&
      lastRequestContextKey === currentRequestContextKey;

    const requestKey = crypto.randomUUID();
    activeRequestRef.current = requestKey;
    setProcessingContext({ mode: audienceMode, goal });
    setLoading(true);
    setError(null);

    let owner: ImproveOwner | null = null;
    let submitted = false;
    try {
      if (isExhausted) {
        // A canceled request may refund quota after a quick retry received 429.
        // Revalidate the cached zero so an open panel can recover without reopening.
        const limits = extractRateLimitResponse(
          await browser.runtime.sendMessage({ type: "GET_LIMITS" }),
        );
        if (activeRequestRef.current !== requestKey) return;
        if (!limits) throw new Error(t.tooltipUnavailable);
        setRateLimit({
          remaining: limits.per_day_remaining,
          total: limits.per_day_total,
        });
        setLimitsUnavailable(false);
        setLimitsLoaded(true);
        if (limits.per_day_remaining <= 0) {
          setError({ type: "rate-limit", message: t.errorRateLimitMessage(limits.per_day_total) });
          return;
        }
      }
      owner = createImproveOwner(requestKey);
      activeOwnerRef.current = owner;
      await owner.ready;
      if (activeRequestRef.current !== requestKey) return;
      submitted = true;
      setEditingOriginal(false);
      setImproved("");
      setChanges([]);
      setResultContext(null);
      const nextAttempt = isRegeneration ? attemptN + 1 : 1;
      const response = await browser.runtime.sendMessage({
        type: "IMPROVE_REQUEST",
        payload: {
          text: trimmed,
          client_request_id: requestKey,
          owner_required: true,
          audience_mode: audienceMode,
          goal,
          site: siteHostname,
          analytics_context: { source: viewMode, view_mode: viewMode, attempt_n: nextAttempt },
        },
      });
      if (activeRequestRef.current !== requestKey) return;
      const result = extractImproveResponse(response);

      if (result) {
        if (!result.improved_text.trim()) throw new Error(t.errorEmptyResponse);
        setImproved(result.improved_text);
        setResultContext({ mode: audienceMode, goal });
        setChanges(result.changes ?? []);
        setLastRequestId(result.request_id);
        setLastRequestContextKey(currentRequestContextKey);
        setLastModel(result.model ?? null);
        setLastLatencyMs(typeof result.latency_ms === "number" ? result.latency_ms : null);
        setAttemptN(nextAttempt);
        if (isRegeneration) {
          void trackEvent(
            "result_regenerated",
            { attempt_n: nextAttempt, request_id: result.request_id },
            viewMode,
          );
        }
        void trackEvent(
          "result_displayed",
          {
            request_id: result.request_id,
            model: result.model,
            latency_ms: result.latency_ms,
          },
          viewMode,
        );
        if (result.rate_limit) {
          setRateLimit({
            remaining: result.rate_limit.per_day_remaining,
            total: result.rate_limit.per_day_total,
          });
          setLimitsUnavailable(false);
          setLimitsLoaded(true);
        }
      } else {
        throw new Error(describeUnexpectedBackgroundResponse(response));
      }
    } catch (err: unknown) {
      if (activeRequestRef.current !== requestKey) return;
      const info = mapErrorToToast(err);
      setError(info);
      if (info.type === "rate-limit") {
        setRateLimit((prev) => ({ ...prev, remaining: 0 }));
        setLimitsUnavailable(false);
        setLimitsLoaded(true);
      }
    } finally {
      owner?.close();
      if (activeOwnerRef.current === owner) activeOwnerRef.current = null;
      if (activeRequestRef.current === requestKey) {
        if (!submitted && improved) setEditingOriginal(false);
        activeRequestRef.current = null;
        setLoading(false);
        setProcessingContext(null);
      }
    }
  }, [
    audienceMode,
    attemptN,
    goal,
    isExhausted,
    isOriginalOverLimit,
    lastRequestId,
    lastRequestContextKey,
    mapErrorToToast,
    original,
    improved,
    siteHostname,
    t,
    viewMode,
  ]);

  const handleCancel = useCallback(() => {
    const requestKey = activeRequestRef.current;
    activeRequestRef.current = null;
    activeOwnerRef.current?.close();
    activeOwnerRef.current = null;
    setLoading(false);
    setProcessingContext(null);
    setEditingOriginal(true);
    setError(null);
    if (requestKey)
      void browser.runtime
        .sendMessage({ type: "CANCEL_IMPROVE", payload: { client_request_id: requestKey } })
        .catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      const requestKey = activeRequestRef.current;
      activeRequestRef.current = null;
      activeOwnerRef.current?.close();
      activeOwnerRef.current = null;
      if (requestKey)
        void browser.runtime
          .sendMessage({ type: "CANCEL_IMPROVE", payload: { client_request_id: requestKey } })
          .catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        !(event.ctrlKey || event.metaKey) ||
        event.isComposing ||
        event.repeat ||
        activeTab !== "improve" ||
        loading ||
        (improved && !editingOriginal)
      )
        return;
      event.preventDefault();
      void handleImprove();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, loading, improved, editingOriginal, handleImprove]);

  const handleNew = useCallback(() => {
    setOriginal("");
    setImproved("");
    setResultContext(null);
    setChanges([]);
    setError(null);
    setEditingOriginal(false);
    setLastRequestId(null);
    setLastRequestContextKey(null);
    setLastModel(null);
    setLastLatencyMs(null);
    setAttemptN(0);
  }, []);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (isOriginalOverLimit || saveInFlightRef.current) return false;
    const requestParts = lastRequestContextKey?.split("|");
    const submittedOriginal =
      requestParts && isOptimizerRequestContext({ mode: requestParts[0], goal: requestParts[1] })
        ? requestParts.slice(2).join("|").trim()
        : "";
    const originalTrimmed = submittedOriginal || original.trim();
    const improvedTrimmed = improved.trim();
    if (!originalTrimmed || !improvedTrimmed) return false;
    saveInFlightRef.current = true;
    try {
      await save(
        { original: originalTrimmed, improved: improvedTrimmed },
        BACKEND_MODE === "fastapi"
          ? async () => {
              const installationId = await getInstallationId();
              await apiClient.savePrompt({
                installation_id: installationId,
                client: "extension",
                client_version: browser.runtime.getManifest().version,
                original_text: originalTrimmed,
                improved_text: improvedTrimmed,
                meta: { source: viewMode },
              });
            }
          : undefined,
      );
      refreshLibraryCount();
      return true;
    } catch (err: unknown) {
      const info: ErrorInfo =
        err instanceof LibraryStorageError
          ? { type: "generic", message: t.errorLibraryStorageMessage }
          : mapErrorToToast(err);
      setError(info);
      if (info.type === "rate-limit") {
        setRateLimit((prev) => ({ ...prev, remaining: 0 }));
        setLimitsUnavailable(false);
        setLimitsLoaded(true);
      }
      return false;
    } finally {
      saveInFlightRef.current = false;
    }
  }, [
    original,
    improved,
    lastRequestContextKey,
    isOriginalOverLimit,
    refreshLibraryCount,
    mapErrorToToast,
    viewMode,
    t,
  ]);

  const handleDismissError = useCallback(() => setError(null), []);

  const handleGoalChange = useCallback((nextGoal: ImproveGoal) => {
    hasUserSelectedGoalRef.current = true;
    setGoal(nextGoal);
  }, []);

  const handleModeSelection = useCallback(
    async (mode: AudienceMode) => {
      if (mode === audienceMode) return;
      hasUserSelectedGoalRef.current = false;
      setAudienceModeState(mode);
      setGoal(defaultGoalForMode(mode, detectedAiGoal));
      setEditingOriginal(true);
      setImproved("");
      setResultContext(null);
      setChanges([]);
      try {
        await setAudienceMode(mode);
      } catch {
        // Ignore storage write failures; mode stays active for current popup session.
      }
    },
    [audienceMode, detectedAiGoal],
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={`popup-container ${viewMode}`}>
      <header className="header">
        <div className="header-brand">
          <img className="header-icon" src={APP_ICON_SRC} alt="" aria-hidden="true" />
          <div className="header-brand-text">
            <span className="header-title">{t.appName}</span>
          </div>
        </div>

        <div className="header-actions">
          {audienceMode && (
            <div className="mode-toggle" role="group" aria-label={t.modeLabel}>
              <button
                className={audienceMode === "ai" ? "selected" : ""}
                aria-pressed={audienceMode === "ai"}
                data-mode="ai"
                disabled={loading || layoutTransition}
                onClick={() => handleModeSelection("ai")}
              >
                <span aria-hidden="true">{t.modeShortAi}</span>
                <span className="sr-only">{t.modeBadgeAi}</span>
              </button>
              <button
                className={audienceMode === "content" ? "selected" : ""}
                aria-pressed={audienceMode === "content"}
                data-mode="content"
                disabled={loading || layoutTransition}
                onClick={() => handleModeSelection("content")}
              >
                <span aria-hidden="true">{t.modeShortContent}</span>
                <span className="sr-only">{t.modeBadgeContent}</span>
              </button>
            </div>
          )}

          {/* Rate-limit badge */}
          <div
            className="rate-limit-wrapper"
            onMouseEnter={() => {
              if (showRateLimitTooltip) setShowTooltip(true);
            }}
            onMouseLeave={() => setShowTooltip(false)}
            onFocus={() => {
              if (showRateLimitTooltip) setShowTooltip(true);
            }}
            onBlur={handleTooltipBlur}
          >
            <button
              type="button"
              className={`rate-limit-badge${isExhausted ? " exhausted" : isWarning ? " warning" : ""}`}
              title={rateLimitBadgeText}
              aria-describedby={showTooltip ? RATE_LIMIT_TOOLTIP_ID : undefined}
              aria-expanded={showRateLimitTooltip ? showTooltip : undefined}
            >
              {showRateLimitTooltip && <span className="status-dot" />}
              <span className="sr-only">{rateLimitBadgeText}</span>
              <span aria-hidden="true">
                {BACKEND_MODE === "fastapi" && limitsLoaded
                  ? rateLimit.total > 0
                    ? `${rateLimit.remaining}/${rateLimit.total}`
                    : String(rateLimit.remaining)
                  : BACKEND_MODE !== "fastapi"
                    ? "∞"
                    : limitsUnavailable
                      ? "—"
                      : "…"}
              </span>
            </button>
            {showRateLimitTooltip && showTooltip && (
              <div className="rate-limit-tooltip" id={RATE_LIMIT_TOOLTIP_ID} role="tooltip">
                {!limitsLoaded && !limitsUnavailable ? (
                  <p>{t.tooltipLoading}</p>
                ) : !limitsLoaded ? (
                  <p>{t.tooltipUnavailable}</p>
                ) : (
                  <>
                    <p>
                      <strong>{t.tooltipRemaining(rateLimit.remaining, rateLimit.total)}</strong>{" "}
                      {t.tooltipImprovementsLeft}
                    </p>
                    <p>
                      {rateLimit.total > 0 ? t.tooltipDailyLimit(rateLimit.total) : ""}
                      {t.tooltipResets}{" "}
                      <button
                        type="button"
                        className="rate-limit-tooltip-link"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleUpgradeClick("rate_limit_tooltip");
                        }}
                      >
                        {t.tooltipUpgrade}
                      </button>
                    </p>
                    {showProComingSoon && (
                      <p className="tooltip-pro-coming-soon" role="status">
                        <strong>{t.proComingSoonTitle}</strong>
                        <span>{t.proComingSoonSubtitle}</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className="tab-bar">
        <button
          className={`tab${activeTab === "improve" ? " active" : ""}`}
          onClick={() => setActiveTab("improve")}
        >
          {t.tabImprove}
        </button>
        <button
          className={`tab${activeTab === "library" ? " active" : ""}`}
          onClick={() => {
            setActiveTab("library");
            refreshLibraryCount();
          }}
        >
          {t.tabLibrary}
          {libraryCount > 0 && <span className="tab-badge">{libraryCount}</span>}
        </button>
      </nav>

      <div className="tab-content">
        {activeTab === "improve" ? (
          <>
            {error && (
              <ErrorToast
                error={error}
                onDismiss={handleDismissError}
                onRetry={error.type === "network" ? handleImprove : undefined}
              />
            )}
            {isExhausted && (
              <div className="upgrade-banner">
                <p>{t.exhaustedTitle}</p>
                <button
                  className="btn-upgrade"
                  onClick={() => handleUpgradeClick("rate_limit_banner")}
                >
                  {t.btnUpgrade}
                </button>
                {showProComingSoon && (
                  <div className="pro-coming-soon" role="status">
                    <strong>{t.proComingSoonTitle}</strong>
                    <span>{t.proComingSoonSubtitle}</span>
                  </div>
                )}
              </div>
            )}
            {!modeReady ? null : audienceMode ? (
              <>
                <PromptForm
                  original={original}
                  maxInputChars={BACKEND_MODE === "fastapi" ? promptInputMaxChars : null}
                  mode={audienceMode}
                  goal={goal}
                  loading={loading || layoutTransition}
                  hidden={loading || Boolean(improved && !editingOriginal)}
                  onGoalChange={handleGoalChange}
                  onOriginalChange={(text) => {
                    setOriginal(text);
                    setEditingOriginal(true);
                    if (error?.message === t.errorInputTooLong(promptInputMaxChars)) setError(null);
                  }}
                  onImprove={handleImprove}
                />
                {loading && (
                  <ProcessingScreen
                    mode={processingContext?.mode ?? audienceMode}
                    goal={processingContext?.goal ?? goal}
                    onCancel={handleCancel}
                  />
                )}
                {improved && (
                  <OptimizerResult
                    improved={improved}
                    changes={changes}
                    goal={resultContext?.goal ?? goal}
                    hidden={loading || editingOriginal}
                    onEdit={() => {
                      setEditingOriginal(true);
                    }}
                    onNew={handleNew}
                    lengthWarning={
                      isOriginalOverLimit ? t.errorInputTooLong(promptInputMaxChars) : undefined
                    }
                    actions={
                      <>
                        <ActionBar
                          improved={improved}
                          targetTabId={initialSelection?.sourceTabId}
                          disabled={!improved}
                          saveDisabled={isOriginalOverLimit}
                          onSave={handleSave}
                          requestId={lastRequestId}
                          source={viewMode}
                          model={lastModel}
                          latencyMs={lastLatencyMs}
                        />
                        {FEATURES.OPEN_AND_PASTE && (
                          <SiteIcons improved={improved} disabled={!improved} />
                        )}
                      </>
                    }
                  />
                )}
              </>
            ) : (
              <div className="mode-onboarding">
                <h3>{t.settingsModeRequiredTitle}</h3>
                <p>{t.settingsModeRequiredSubtitle}</p>
                <button
                  type="button"
                  className="mode-onboarding-card"
                  data-mode="ai"
                  onClick={() => handleModeSelection("ai")}
                >
                  <strong>{t.onboardingAiTitle}</strong>
                  <span>{t.onboardingAiDescription}</span>
                </button>
                <button
                  type="button"
                  className="mode-onboarding-card"
                  data-mode="content"
                  onClick={() => handleModeSelection("content")}
                >
                  <strong>{t.onboardingContentTitle}</strong>
                  <span>{t.onboardingContentDescription}</span>
                </button>
              </div>
            )}
          </>
        ) : (
          <Library onCountChange={setLibraryCount} />
        )}
      </div>
      <footer className="utility-footer">
        <RatingBar />
        <button
          type="button"
          className="layout-toggle-btn"
          disabled={loading || layoutTransition}
          title={viewMode === "popup" ? t.switchToSidebar : t.switchToPopup}
          aria-label={viewMode === "popup" ? t.switchToSidebar : t.switchToPopup}
          onClick={handleLayoutToggle}
        >
          <LayoutSidebarRightIcon
            className="layout-toggle-icon"
            mirrored={viewMode === "sidepanel"}
          />
        </button>
      </footer>
    </div>
  );
}
