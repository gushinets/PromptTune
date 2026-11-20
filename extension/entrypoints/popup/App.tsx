import { countPromptCharacters, parseInputLengthError } from "@shared/prompt-length";
import { useState, useEffect, useCallback, useMemo, useRef, type FocusEvent } from "react";
import browser from "webextension-polyfill";
import { EmailBonusModal } from "./components/EmailBonusModal";
import { QuotaOnlyWindow } from "./QuotaOnlyWindow";
import { PromptForm } from "./components/PromptForm";
import { ProcessingScreen } from "./components/ProcessingScreen";
import { OptimizerResult } from "./components/OptimizerResult";
import { ActionBar } from "./components/ActionBar";
import { SiteIcons } from "./components/SiteIcons";
import { Library } from "./components/Library";
import { ErrorToast } from "./components/ErrorToast";
import { RatingBar } from "./components/RatingBar";
import {
  type PopupSessionDraft,
  getAll,
  LibraryStorageError,
  save,
  getInstallationId,
  getAudienceMode,
  getPopupSessionDraft,
  setAudienceMode,
  setPopupSessionDraft,
  preferPopupSessionDraft,
} from "@shared/storage";
import { FEATURES, BACKEND_MODE, DEFAULT_PROMPT_INPUT_MAX_CHARS } from "@shared/constants";
import { apiClient, ApiError } from "@shared/api-client";
import {
  describeUnexpectedBackgroundResponse,
  extractImproveResponse,
  extractRateLimitResponse,
  isPeriodQuotaExhausted,
} from "@shared/response-utils";
import { useT } from "@shared/i18n";
import { isOptimizerRequestContext } from "@shared/goal-options";
import { createImproveOwner, type ImproveOwner } from "@shared/improve-owner";
import { trackEvent } from "@shared/analytics";
import type {
  RateLimitInfo,
  AiImproveGoal,
  AudienceMode,
  ImproveGoal,
  PromptInputLimit,
  OptimizerRequestContext,
} from "@shared/types";

import { resolveBrowserTarget } from "@shared/browser-target";
import { getSelectionSessionId, type PromptSelection } from "@shared/selection";

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
  initialDraft?: PopupSessionDraft;
  initialQuota?: RateLimitInfo;
  quotaOnly?: boolean;
  quotaReturnTarget?: { tabId: number; sessionId: string };
}

export function App(props: AppProps) {
  if (props.quotaOnly)
    return (
      <QuotaOnlyWindow initialQuota={props.initialQuota} returnTarget={props.quotaReturnTarget} />
    );
  return <OptimizerApp {...props} />;
}

/** Shared optimizer UI; a selected session keeps its source tab across surface changes. */
function OptimizerApp({
  viewMode = "popup",
  initialSelection,
  initialDraft,
  initialQuota,
  quotaReturnTarget,
}: AppProps) {
  const t = useT();
  const [initialQuotaSnapshot] = useState(initialQuota);
  const [isSelectionLaunch] = useState(
    () => viewMode === "popup" && new URLSearchParams(window.location.search).has("selection"),
  );
  const selectionLaunchFailed = isSelectionLaunch && !initialSelection && !initialDraft;
  const [saveOnEditOnly, setSaveOnEditOnly] = useState(initialDraft?.saveOnEditOnly ?? false);
  const maySaveSelectionDraftRef = useRef(!selectionLaunchFailed);
  const [draftSessionId, setDraftSessionId] = useState(
    () =>
      initialSelection?.draftSessionId ??
      initialDraft?.draftSessionId ??
      (viewMode === "popup" ? getSelectionSessionId(window.location.search) : undefined) ??
      crypto.randomUUID(),
  );
  const [draftCreatedAt, setDraftCreatedAt] = useState(
    () => initialSelection?.draftCreatedAt ?? initialDraft?.draftCreatedAt ?? Date.now(),
  );
  const [activeTab, setActiveTab] = useState<TabId>("improve");
  const [original, setOriginal] = useState(initialSelection?.text ?? "");
  const [sourceTabId, setSourceTabId] = useState(
    initialSelection?.sourceTabId ?? initialDraft?.sourceTabId,
  );
  const [sourceSessionId, setSourceSessionId] = useState(
    initialSelection?.sourceSessionId ?? initialDraft?.sourceSessionId,
  );
  // A standalone window's target survives New independently of the current prompt binding.
  const [standaloneTarget, setStandaloneTarget] = useState<PopupSessionDraft["standaloneTarget"]>(
    () =>
      initialSelection?.sourceTabId !== undefined
        ? { tabId: initialSelection.sourceTabId, sessionId: initialSelection.sourceSessionId }
        : (initialDraft?.standaloneTarget ??
          (isSelectionLaunch && initialDraft?.sourceTabId !== undefined
            ? { tabId: initialDraft.sourceTabId, sessionId: initialDraft.sourceSessionId }
            : undefined)),
  );
  const isStandaloneWindow = isSelectionLaunch || initialSelection !== undefined;
  // A quota launch may borrow the current tab for an unbound toolbar result. Keep that
  // window target out of sessionDraft so later launches choose their own fallback.
  const windowTarget = standaloneTarget ?? quotaReturnTarget;
  const targetTabId = sourceTabId ?? (isStandaloneWindow ? windowTarget?.tabId : undefined);
  const targetSessionId =
    sourceTabId !== undefined
      ? sourceSessionId
      : isStandaloneWindow
        ? windowTarget?.sessionId
        : undefined;
  const [promptInputMaxChars, setPromptInputMaxChars] = useState<number>(
    DEFAULT_PROMPT_INPUT_MAX_CHARS,
  );

  const hasAuthoritativeInputLimitRef = useRef(false);
  const inputLimitRevisionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const [saving, setSaving] = useState(false);

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
  const [goal, setGoal] = useState<ImproveGoal>("general");
  const [processingContext, setProcessingContext] = useState<OptimizerRequestContext | null>(null);
  const [resultContext, setResultContext] = useState<OptimizerRequestContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [layoutTransition, setLayoutTransition] = useState(false);
  const layoutTransitionRef = useRef(false);
  const [editingOriginal, setEditingOriginal] = useState(false);
  const activeRequestRef = useRef<string | null>(null);
  const activeOwnerRef = useRef<ImproveOwner | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(() =>
    selectionLaunchFailed ? { type: "generic", message: t.errorSelectionUnavailable } : null,
  );
  const [rateLimit, setRateLimit] = useState(() => ({
    remaining: initialQuotaSnapshot?.remaining ?? initialQuotaSnapshot?.per_day_remaining ?? 0,
    total: initialQuotaSnapshot?.total ?? initialQuotaSnapshot?.per_day_total ?? 0,
  }));
  const [limitsLoaded, setLimitsLoaded] = useState(Boolean(initialQuotaSnapshot));
  const [limitsUnavailable, setLimitsUnavailable] = useState(false);
  const [libraryCount, setLibraryCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const quotaMutationVersion = useRef(0);
  const quotaRefreshRequest = useRef(0);
  const startQuotaLookup = useCallback(() => {
    const request = ++quotaRefreshRequest.current;
    const version = quotaMutationVersion.current;
    return () =>
      request === quotaRefreshRequest.current && version === quotaMutationVersion.current;
  }, []);
  const [quotaInfo, setQuotaInfo] = useState<RateLimitInfo | null>(initialQuotaSnapshot ?? null);
  const [showEmailBonus, setShowEmailBonus] = useState(
    () =>
      BACKEND_MODE === "fastapi" &&
      Boolean(
        initialQuotaSnapshot &&
        isPeriodQuotaExhausted(initialQuotaSnapshot) &&
        !initialQuotaSnapshot.bonus_claimed,
      ),
  );
  const [emailBonusNotice, setEmailBonusNotice] = useState(false);
  const applyQuota = useCallback(
    (info: RateLimitInfo, offer = false, source: "mutation" | "lookup" = "mutation") => {
      if (source === "mutation") quotaMutationVersion.current += 1;
      const remaining = info.remaining ?? info.per_day_remaining;
      if (remaining > 0 || info.bonus_claimed || !isPeriodQuotaExhausted(info))
        setShowEmailBonus(false);
      setRateLimit({ remaining, total: info.total ?? info.per_day_total });
      setQuotaInfo(info);
      setLimitsUnavailable(false);
      setLimitsLoaded(true);
      if (
        BACKEND_MODE === "fastapi" &&
        offer &&
        isPeriodQuotaExhausted(info) &&
        !info.bonus_claimed
      )
        setShowEmailBonus(true);
    },
    [],
  );
  const recoverQuota = useCallback(() => {
    const isCurrent = startQuotaLookup();
    void browser.runtime
      .sendMessage({ type: "GET_LIMITS" })
      .then((response) => {
        if (!isCurrent()) return;
        const info = extractRateLimitResponse(response);
        if (info) applyQuota(info, true, "lookup");
      })
      .catch(() => {
        if (isCurrent()) setLimitsUnavailable(true);
      });
  }, [applyQuota, startQuotaLookup]);
  const [siteContext, setSiteContext] = useState<{
    hostname?: string;
    goal: AiImproveGoal;
    resolved: boolean;
    revision: number;
  }>({ goal: "general", resolved: false, revision: 0 });
  const { hostname: siteHostname, goal: detectedAiGoal, resolved: siteResolved } = siteContext;
  const [layoutTargetLoading, setLayoutTargetLoading] = useState(true);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [lastRequestContextKey, setLastRequestContextKey] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [attemptN, setAttemptN] = useState(0);
  const [resultCompletedAt, setResultCompletedAt] = useState<number | null>(null);
  const [sessionDraftLoaded, setSessionDraftLoaded] = useState(false);
  const [goalIsUserSelected, setGoalIsUserSelected] = useState(false);
  const hasTrackedPopupOpenedRef = useRef(false);

  const refreshLibraryCount = useCallback(() => {
    getAll().then((entries) => setLibraryCount(entries.length));
  }, []);

  const layoutTargetRef = useRef<
    { tab: browser.Tabs.Tab; id?: number; session?: string } | undefined
  >(undefined);
  const contextRevisionRef = useRef(0);
  const siteContextPendingRef = useRef(true);
  const pendingActiveTabRef = useRef<{ tabId: number; windowId: number } | undefined>(undefined);
  const sourceContextReady =
    siteResolved &&
    (!audienceMode ||
      goalIsUserSelected ||
      goal === defaultGoalForMode(audienceMode, detectedAiGoal));

  useEffect(() => {
    const onRemoved = (tabId: number) => {
      if (
        layoutTargetRef.current?.tab.id === tabId ||
        tabId === targetTabId ||
        pendingActiveTabRef.current?.tabId === tabId
      ) {
        const revision = ++contextRevisionRef.current;
        siteContextPendingRef.current = true;
        pendingActiveTabRef.current = undefined;
        layoutTargetRef.current = undefined;
        setLayoutTargetLoading(false);
        setSiteContext({ hostname: undefined, goal: "general", resolved: true, revision });
      }
    };
    browser.tabs.onRemoved.addListener(onRemoved);
    return () => browser.tabs.onRemoved.removeListener(onRemoved);
  }, [targetTabId]);

  const refreshActiveTabContext = useCallback(() => {
    if (!sessionDraftLoaded) return;
    const revision = ++contextRevisionRef.current;
    siteContextPendingRef.current = true;
    setSiteContext((previous) => ({ ...previous, resolved: false, revision }));
    const cached = layoutTargetRef.current;
    setLayoutTargetLoading(
      !cached || cached.id !== targetTabId || cached.session !== targetSessionId,
    );
    const tabs = resolveBrowserTarget(targetTabId, targetSessionId).then((tab) =>
      tab ? [tab] : [],
    );
    tabs
      .then((tabs) => {
        if (revision !== contextRevisionRef.current) return;
        layoutTargetRef.current = tabs[0]
          ? { tab: tabs[0], id: targetTabId, session: targetSessionId }
          : undefined;
        setLayoutTargetLoading(false);
        const tabUrl = tabs[0]?.url;
        pendingActiveTabRef.current = undefined;
        setSiteContext({
          hostname: getSupportedSiteHostname(tabUrl),
          goal: detectAiGoalFromUrl(tabUrl),
          resolved: true,
          revision,
        });
      })
      .catch(() => {
        if (revision !== contextRevisionRef.current) return;
        layoutTargetRef.current = undefined;
        setLayoutTargetLoading(false);
        pendingActiveTabRef.current = undefined;
        setSiteContext({ hostname: undefined, goal: "general", resolved: true, revision });
      });
  }, [targetTabId, targetSessionId, sessionDraftLoaded]);

  useEffect(() => {
    refreshLibraryCount();
  }, [refreshLibraryCount]);

  useEffect(() => {
    Promise.all([
      // The global preference must not block restoration of a transferred draft.
      getAudienceMode().catch(() => null),
      initialSelection
        ? Promise.resolve(null)
        : initialDraft
          ? Promise.resolve(initialDraft)
          : isSelectionLaunch
            ? Promise.resolve(null)
            : getPopupSessionDraft(viewMode === "popup", { independent: true }),
    ])
      .then(([mode, draft]) => {
        const resultMode =
          draft && isOptimizerRequestContext(draft.result_context)
            ? draft.result_context.mode
            : null;
        const restoredMode = draft?.audienceMode ?? mode ?? resultMode;
        setAudienceModeState(restoredMode);

        if (initialSelection || !draft) return;

        setSaveOnEditOnly(draft.saveOnEditOnly ?? false);
        if (draft.draftSessionId) setDraftSessionId(draft.draftSessionId);
        if (typeof draft.draftCreatedAt === "number") setDraftCreatedAt(draft.draftCreatedAt);
        setSourceTabId(draft.sourceTabId);
        setSourceSessionId(draft.sourceSessionId);
        setStandaloneTarget(
          draft.standaloneTarget ??
            (isSelectionLaunch && draft.sourceTabId !== undefined
              ? { tabId: draft.sourceTabId, sessionId: draft.sourceSessionId }
              : undefined),
        );
        setActiveTab(draft.activeTab);
        setOriginal(draft.original);
        setImproved(draft.improved);
        const [requestMode, requestGoal] = draft.lastRequestContextKey?.split("|") ?? [];
        const legacyContext = { mode: requestMode, goal: requestGoal };
        const fallbackContext = isOptimizerRequestContext(legacyContext)
          ? legacyContext
          : { mode: restoredMode, goal: draft.goal };
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
        setResultCompletedAt(draft.resultCompletedAt ?? null);

        if (draft.goal && isOptimizerRequestContext({ mode: restoredMode, goal: draft.goal })) {
          // Legacy drafts do not distinguish explicit choices from detected defaults.
          setGoalIsUserSelected(draft.goalIsUserSelected ?? true);
          setGoal(draft.goal);
        }
      })
      .finally(() => {
        setSessionDraftLoaded(true);
        setModeReady(true);
      });
  }, [initialSelection, initialDraft, viewMode, isSelectionLaunch]);

  useEffect(() => {
    if (!sessionDraftLoaded) return;
    refreshActiveTabContext();

    if (viewMode !== "sidepanel" && targetTabId === undefined) return;

    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (targetTabId !== undefined) return;
      const windowId = layoutTargetRef.current?.tab.windowId;
      if (windowId !== undefined && info.windowId !== windowId) return;
      pendingActiveTabRef.current = info;
      refreshActiveTabContext();
    };
    const onUpdated = (tabId: number, _info: unknown, tab: browser.Tabs.Tab) => {
      const activeTab = layoutTargetRef.current?.tab;
      const pendingTab = pendingActiveTabRef.current;
      const expectedId = targetTabId ?? pendingTab?.tabId ?? activeTab?.id;
      if (expectedId !== undefined ? tabId !== expectedId : !tab.active) return;
      refreshActiveTabContext();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    const onAttached = (tabId: number, info: browser.Tabs.OnAttachedAttachInfoType) => {
      const cached = layoutTargetRef.current;
      if (
        tabId !== targetTabId &&
        tabId !== cached?.tab.id &&
        tabId !== pendingActiveTabRef.current?.tabId
      )
        return;
      if (cached?.tab.id === tabId) {
        layoutTargetRef.current = { ...cached, tab: { ...cached.tab, windowId: info.newWindowId } };
      }
      refreshActiveTabContext();
    };
    browser.tabs.onAttached.addListener(onAttached);

    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onAttached.removeListener(onAttached);
    };
  }, [refreshActiveTabContext, viewMode, sessionDraftLoaded, targetTabId]);

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
    if (goalIsUserSelected) return;
    setGoal(defaultGoalForMode(audienceMode, detectedAiGoal));
  }, [audienceMode, detectedAiGoal, modeReady, goalIsUserSelected]);

  useEffect(() => {
    if (sourceContextReady && siteContext.revision === contextRevisionRef.current)
      siteContextPendingRef.current = false;
  }, [sourceContextReady, siteContext.revision]);

  const sessionDraft = useMemo<PopupSessionDraft>(
    () => ({
      draftSessionId,
      draftCreatedAt,
      sourceTabId,
      sourceSessionId,
      standaloneTarget,
      audienceMode,
      ...(saveOnEditOnly ? { saveOnEditOnly: true } : {}),
      optimizer_screen: improved && !editingOriginal ? "result" : "input",
      result_context: resultContext,
      activeTab,
      original,
      improved,
      changes,
      goal,
      goalIsUserSelected,
      lastRequestId,
      lastRequestContextKey,
      lastModel,
      lastLatencyMs,
      attemptN,
      ...(resultCompletedAt !== null ? { resultCompletedAt } : {}),
    }),
    [
      draftSessionId,
      draftCreatedAt,
      sourceTabId,
      sourceSessionId,
      standaloneTarget,
      audienceMode,
      saveOnEditOnly,
      improved,
      editingOriginal,
      resultContext,
      activeTab,
      original,
      changes,
      goal,
      goalIsUserSelected,
      lastRequestId,
      lastRequestContextKey,
      lastModel,
      lastLatencyMs,
      attemptN,
      resultCompletedAt,
    ],
  );

  useEffect(() => {
    if (!sessionDraftLoaded || saveOnEditOnly) return;
    // An unsuccessful selection launch must not become a newer blank restore candidate.
    if (!maySaveSelectionDraftRef.current) {
      if (!sessionDraft.original && !sessionDraft.improved) return;
      maySaveSelectionDraftRef.current = true;
    }
    void setPopupSessionDraft(sessionDraft).catch(() => undefined);
  }, [sessionDraftLoaded, sessionDraft, saveOnEditOnly]);

  useEffect(() => {
    if (BACKEND_MODE !== "fastapi") return;
    let active = true;
    let initial = !initialQuotaSnapshot;
    const refresh = () => {
      const isCurrent = startQuotaLookup();
      void browser.runtime
        .sendMessage({ type: "GET_LIMITS" })
        .then((response) => {
          if (!active || !isCurrent()) return;
          const info = extractRateLimitResponse(response);
          if (info) {
            applyQuota(
              info,
              initial && new URLSearchParams(window.location.search).get("quota") === "1",
              "lookup",
            );
            initial = false;
          } else setLimitsUnavailable(true);
        })
        .catch(() => {
          if (active && isCurrent()) setLimitsUnavailable(true);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      active = false;
      quotaRefreshRequest.current += 1;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [applyQuota, startQuotaLookup, initialQuotaSnapshot]);

  useEffect(() => {
    const className = viewMode === "sidepanel" ? "sidepanel-body" : "popup-body";
    document.body.classList.add(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [viewMode]);

  // ── Layout toggle ────────────────────────────────────────────────────────────
  const handleLayoutToggle = useCallback(async () => {
    if (
      !sessionDraftLoaded ||
      activeRequestRef.current ||
      saveInFlightRef.current ||
      layoutTransitionRef.current
    )
      return;
    layoutTransitionRef.current = true;
    setLayoutTransition(true);
    let closing = false;
    try {
      if (viewMode === "popup") {
        // Resolve/validate ahead of the click so open() retains the user gesture.
        const cached = layoutTargetRef.current;
        const tab =
          cached?.id === targetTabId && cached?.session === targetSessionId
            ? cached?.tab
            : undefined;
        if (activeRequestRef.current) return;
        const sidePanel = (
          browser as typeof browser & {
            sidePanel?: {
              open: (options: { windowId: number }) => Promise<void>;
            };
          }
        ).sidePanel;
        if (tab?.windowId != null && sidePanel) {
          const response = await browser.runtime.sendMessage({
            type: "OPEN_OPTIMIZER_PANEL",
            windowId: tab.windowId,
            tabId: tab.id,
            draft: { ...sessionDraft, sourceTabId: targetTabId, sourceSessionId: targetSessionId },
          });
          if (!(response as { ok?: boolean } | undefined)?.ok)
            throw new Error("Panel transfer failed");
          window.close();
          closing = true;
        } else {
          throw new Error("Side panel unavailable");
        }
      } else {
        // The next toolbar popup explicitly resumes this panel, even if another session is newer.
        await preferPopupSessionDraft(sessionDraft);
        window.close();
        closing = true;
      }
    } catch {
      setError({ type: "generic", message: t.errorSidePanelMessage });
    } finally {
      if (!closing) {
        layoutTransitionRef.current = false;
        setLayoutTransition(false);
      }
    }
  }, [viewMode, targetTabId, targetSessionId, sessionDraft, sessionDraftLoaded, t]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const isExhausted = BACKEND_MODE === "fastapi" && limitsLoaded ? rateLimit.remaining <= 0 : false;
  const isQuotaPending = isExhausted && quotaInfo !== null && !isPeriodQuotaExhausted(quotaInfo);
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

  const renewalDate = quotaInfo?.next_reset_at
    ? new Date(quotaInfo.next_reset_at).toLocaleDateString(undefined, {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  const renewalMessage = renewalDate ? t.quotaRenewal(renewalDate) : t.tooltipResets;

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
      if (errorMessage.toLowerCase().includes("temporarily reserved by pending requests")) {
        return { type: "rate-limit", message: t.quotaPending };
      }
      if (err instanceof ApiError) {
        if (err.status === 403 || err.detail.toLowerCase().includes("login is invalid")) {
          return { type: "auth", message: t.errorAuthMessage };
        }
        if (err.detail.toLowerCase().includes("monthly improvement quota exhausted")) {
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
      if (message.toLowerCase().includes("monthly improvement quota exhausted")) {
        return { type: "rate-limit", message: t.errorRateLimitMessage(rateLimit.total) };
      }
      if (message.includes("422")) {
        const validationDetail = message.replace(/^.*API 422:\s*/i, "").trim();
        return { type: "generic", message: validationDetail || message };
      }
      if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
        return { type: "generic", message: t.quotaTemporary };
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
    if (
      siteContextPendingRef.current ||
      !sourceContextReady ||
      isOriginalOverLimit ||
      activeRequestRef.current ||
      layoutTransitionRef.current
    )
      return;
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
        const isCurrent = startQuotaLookup();
        const limits = extractRateLimitResponse(
          await browser.runtime.sendMessage({ type: "GET_LIMITS" }),
        );
        if (activeRequestRef.current !== requestKey || !isCurrent()) return;
        if (!limits) throw new Error(t.tooltipUnavailable);
        applyQuota(limits, true, "lookup");
        setLimitsUnavailable(false);
        setLimitsLoaded(true);
        if ((limits.remaining ?? limits.per_day_remaining) <= 0) {
          setError({
            type: "rate-limit",
            message: isPeriodQuotaExhausted(limits)
              ? t.errorRateLimitMessage(limits.total ?? limits.per_day_total)
              : t.quotaPending,
          });
          return;
        }
      }
      owner = createImproveOwner(requestKey);
      activeOwnerRef.current = owner;
      await owner.ready;
      if (activeRequestRef.current !== requestKey) return;
      submitted = true;
      setSaveOnEditOnly(false);
      setEditingOriginal(false);
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
        setResultCompletedAt(result.completed_at ?? Date.now());
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
          applyQuota(result.rate_limit, true);
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
        recoverQuota();
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
    startQuotaLookup,
    isOriginalOverLimit,
    lastRequestId,
    lastRequestContextKey,
    mapErrorToToast,
    applyQuota,
    recoverQuota,
    original,
    improved,
    siteHostname,
    sourceContextReady,
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
    if (layoutTransitionRef.current) return;
    setSaveOnEditOnly(false);
    // The standalone window keeps its launch target; only the prompt binding is cleared.
    setSourceTabId(undefined);
    setSourceSessionId(undefined);
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
    setResultCompletedAt(null);
  }, []);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (isOriginalOverLimit || saveInFlightRef.current || layoutTransitionRef.current) return false;
    const requestParts = lastRequestContextKey?.split("|");
    const submittedOriginal =
      requestParts && isOptimizerRequestContext({ mode: requestParts[0], goal: requestParts[1] })
        ? requestParts.slice(2).join("|").trim()
        : "";
    const originalTrimmed = submittedOriginal || original.trim();
    const improvedTrimmed = improved.trim();
    if (!originalTrimmed || !improvedTrimmed) return false;
    saveInFlightRef.current = true;
    setSaving(true);
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
        recoverQuota();
      }
      return false;
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }, [
    original,
    improved,
    lastRequestContextKey,
    isOriginalOverLimit,
    refreshLibraryCount,
    mapErrorToToast,
    recoverQuota,
    viewMode,
    t,
  ]);

  const handleDismissError = useCallback(() => setError(null), []);

  const handleGoalChange = useCallback((nextGoal: ImproveGoal) => {
    if (layoutTransitionRef.current) return;
    setSaveOnEditOnly(false);
    setGoalIsUserSelected(true);
    setGoal(nextGoal);
  }, []);

  const handleModeSelection = useCallback(
    async (mode: AudienceMode) => {
      if (layoutTransitionRef.current || mode === audienceMode) return;
      setSaveOnEditOnly(false);
      setGoalIsUserSelected(false);
      setAudienceModeState(mode);
      setGoal(defaultGoalForMode(mode, detectedAiGoal));
      setEditingOriginal(true);
      setImproved("");
      setResultCompletedAt(null);
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
      {showEmailBonus && (
        <EmailBonusModal
          initialQuota={quotaInfo}
          onPending={(info) => applyQuota(info)}
          onClose={() => setShowEmailBonus(false)}
          onConfirmed={(info) => {
            applyQuota(info);
            setEmailBonusNotice(info.email_bonus_outcome === "already_claimed");
            setShowEmailBonus(false);
            setError(null);
          }}
        />
      )}
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
                      {renewalMessage}
                    </p>
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
          disabled={layoutTransition}
          onClick={() => {
            if (!layoutTransitionRef.current) setActiveTab("improve");
          }}
        >
          {t.tabImprove}
        </button>
        <button
          className={`tab${activeTab === "library" ? " active" : ""}`}
          disabled={layoutTransition}
          onClick={() => {
            if (layoutTransitionRef.current) return;
            setActiveTab("library");
            refreshLibraryCount();
          }}
        >
          {t.tabLibrary}
          {libraryCount > 0 && <span className="tab-badge">{libraryCount}</span>}
        </button>
      </nav>

      <div className="tab-content">
        {error && (
          <ErrorToast
            error={error}
            onDismiss={handleDismissError}
            onRetry={
              activeTab === "improve" && error.type === "network" ? handleImprove : undefined
            }
          />
        )}
        {activeTab === "improve" ? (
          <>
            {isExhausted && (
              <div className="upgrade-banner">
                <p>{isQuotaPending ? t.quotaPending : t.exhaustedTitle}</p>
                {emailBonusNotice && <p role="status">{t.emailBonusAlreadyClaimed}</p>}
                {!isQuotaPending && (
                  <>
                    <p>{renewalMessage}</p>
                    {!quotaInfo?.bonus_claimed && (
                      <button className="btn-upgrade" onClick={() => setShowEmailBonus(true)}>
                        {t.emailBonusTitle}
                      </button>
                    )}
                  </>
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
                  submitDisabled={!sourceContextReady || isExhausted}
                  hidden={loading || Boolean(improved && !editingOriginal)}
                  onGoalChange={handleGoalChange}
                  onOriginalChange={(text) => {
                    if (layoutTransitionRef.current) return;
                    setSaveOnEditOnly(false);
                    setOriginal(text);
                    setEditingOriginal(true);
                    if (error?.message === t.errorInputTooLong(promptInputMaxChars)) setError(null);
                  }}
                  onImprove={handleImprove}
                />
                {editingOriginal && improved && !loading && (
                  <button
                    type="button"
                    className="email-bonus-return"
                    onClick={() => setEditingOriginal(false)}
                  >
                    {t.returnToResult}
                  </button>
                )}
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
                    disabled={layoutTransition}
                    onEdit={() => {
                      if (layoutTransitionRef.current) return;
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
                          targetTabId={targetTabId}
                          targetSessionId={targetSessionId}
                          disabled={!improved || layoutTransition}
                          saveDisabled={isOriginalOverLimit || layoutTransition}
                          onSave={handleSave}
                          requestId={lastRequestId}
                          source={viewMode}
                          model={lastModel}
                          latencyMs={lastLatencyMs}
                        />
                        {FEATURES.OPEN_AND_PASTE && (
                          <SiteIcons improved={improved} disabled={!improved || layoutTransition} />
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
                  disabled={layoutTransition}
                  data-mode="ai"
                  onClick={() => handleModeSelection("ai")}
                >
                  <strong>{t.onboardingAiTitle}</strong>
                  <span>{t.onboardingAiDescription}</span>
                </button>
                <button
                  type="button"
                  className="mode-onboarding-card"
                  disabled={layoutTransition}
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
          disabled={
            !sessionDraftLoaded ||
            loading ||
            saving ||
            layoutTransition ||
            (viewMode === "popup" && layoutTargetLoading)
          }
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
