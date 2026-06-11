import { useState, useEffect, useCallback, useRef, type FocusEvent } from "react";
import browser from "webextension-polyfill";
import { PromptForm } from "./components/PromptForm";
import { ActionBar } from "./components/ActionBar";
import { SiteIcons } from "./components/SiteIcons";
import { Library } from "./components/Library";
import { ErrorToast } from "./components/ErrorToast";
import { RatingBar } from "./components/RatingBar";
import {
  getAll,
  save,
  getInstallationId,
  getAudienceMode,
  getPopupSessionDraft,
  setAudienceMode,
  setPopupSessionDraft,
} from "@shared/storage";
import { FEATURES, BACKEND_MODE } from "@shared/constants";
import { apiClient, ApiError } from "@shared/api-client";
import {
  describeUnexpectedBackgroundResponse,
  extractImproveResponse,
  extractRateLimitResponse,
} from "@shared/response-utils";
import { useT } from "@shared/i18n";
import { trackEvent } from "@shared/analytics";
import type { AiImproveGoal, AudienceMode, ImproveGoal } from "@shared/types";

// TODO: Replace with actual upgrade URL
const UPGRADE_URL = "https://forgekit.io/upgrade";
const RATE_LIMIT_TOOLTIP_ID = "rate-limit-tooltip";

function detectAiGoalFromUrl(rawUrl: string | undefined): AiImproveGoal {
  if (!rawUrl) return "general";
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host.endsWith("chatgpt.com")) return "chatgpt";
    if (host.endsWith("claude.ai")) return "claude";
    if (host.endsWith("perplexity.ai")) return "perplexity";
  } catch {
    // Ignore malformed tab URLs.
  }
  return "general";
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

function SparkleIcon({ className }: { className?: string }) {
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
    >
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
      <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z" />
    </svg>
  );
}

function BookmarkIcon({ className }: { className?: string }) {
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
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
  );
}

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
}

export function App({ viewMode = "popup" }: AppProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabId>("improve");
  const [original, setOriginal] = useState("");
  const [improved, setImproved] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [audienceMode, setAudienceModeState] = useState<AudienceMode | null>(null);
  const [modeReady, setModeReady] = useState(false);
  const [detectedAiGoal, setDetectedAiGoal] = useState<AiImproveGoal>("general");
  const [goal, setGoal] = useState<ImproveGoal>("general");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [rateLimit, setRateLimit] = useState({ remaining: 0, total: 0 });
  const [limitsLoaded, setLimitsLoaded] = useState(false);
  const [limitsUnavailable, setLimitsUnavailable] = useState(false);
  const [libraryCount, setLibraryCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [siteHostname, setSiteHostname] = useState<string | undefined>(undefined);
  const [siteResolved, setSiteResolved] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [lastRequestContextKey, setLastRequestContextKey] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [attemptN, setAttemptN] = useState(0);
  const [sessionDraftLoaded, setSessionDraftLoaded] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const hasUserSelectedGoalRef = useRef(false);
  const hasTrackedPopupOpenedRef = useRef(false);

  const refreshLibraryCount = useCallback(() => {
    getAll().then((entries) => setLibraryCount(entries.length));
  }, []);

  useEffect(() => {
    refreshLibraryCount();
  }, [refreshLibraryCount]);

  useEffect(() => {
    Promise.all([getAudienceMode(), getPopupSessionDraft()])
      .then(([mode, draft]) => {
        setAudienceModeState(mode);

        if (!draft) return;

        setActiveTab(draft.activeTab);
        setOriginal(draft.original);
        setImproved(draft.improved);
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
  }, []);

  useEffect(() => {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        try {
          setSiteHostname(tabs[0]?.url ? new URL(tabs[0].url).hostname : undefined);
        } catch {
          setSiteHostname(undefined);
        }
        const goalFromSite = detectAiGoalFromUrl(tabs[0]?.url);
        setDetectedAiGoal(goalFromSite);
        setSiteResolved(true);
      })
      .catch(() => {
        setDetectedAiGoal("general");
        setSiteResolved(true);
      });
  }, []);

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
    });
  }, [
    activeTab,
    attemptN,
    changes,
    goal,
    improved,
    lastLatencyMs,
    lastModel,
    lastRequestContextKey,
    lastRequestId,
    original,
    sessionDraftLoaded,
  ]);

  useEffect(() => {
    if (!showSettings) return;

    function handlePointerDown(event: MouseEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setShowSettings(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [showSettings]);

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
    try {
      if (viewMode === "popup") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.windowId != null) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        }
        window.close();
      } else {
        // Cannot open popup programmatically — just close sidebar
        // User needs to click the extension icon to open popup
        window.close();
      }
    } catch {
      // fail silently
    }
  }, [viewMode]);

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

  // ── Error mapping ────────────────────────────────────────────────────────────
  const mapErrorToToast = useCallback(
    (err: unknown): ErrorInfo => {
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
    const trimmed = original.trim();
    if (!trimmed) return;
    if (!audienceMode) return;

    if (isExhausted) {
      setError({ type: "rate-limit", message: t.errorRateLimitMessage(rateLimit.total) });
      return;
    }

    const currentRequestContextKey = `${audienceMode}|${goal}|${trimmed}`;
    const isRegeneration =
      !!lastRequestId &&
      !!lastRequestContextKey &&
      lastRequestContextKey === currentRequestContextKey;

    setLoading(true);
    setError(null);
    setImproved("");
    setChanges([]);

    try {
      const nextAttempt = isRegeneration ? attemptN + 1 : 1;
      const response = await browser.runtime.sendMessage({
        type: "IMPROVE_REQUEST",
        payload: {
          text: trimmed,
          audience_mode: audienceMode,
          goal,
          site: siteHostname,
          analytics_context: { source: viewMode, view_mode: viewMode, attempt_n: nextAttempt },
        },
      });
      const result = extractImproveResponse(response);

      if (result) {
        if (!result.improved_text.trim()) throw new Error(t.errorEmptyResponse);
        setImproved(result.improved_text);
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
      const info = mapErrorToToast(err);
      setError(info);
      if (info.type === "rate-limit") {
        setRateLimit((prev) => ({ ...prev, remaining: 0 }));
        setLimitsUnavailable(false);
        setLimitsLoaded(true);
      }
    } finally {
      setLoading(false);
    }
  }, [
    audienceMode,
    attemptN,
    goal,
    isExhausted,
    lastRequestId,
    lastRequestContextKey,
    mapErrorToToast,
    original,
    rateLimit.total,
    siteHostname,
    t,
    viewMode,
  ]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const originalTrimmed = original.trim();
    const improvedTrimmed = improved.trim();
    if (!originalTrimmed || !improvedTrimmed) return false;

    if (BACKEND_MODE === "fastapi") {
      try {
        const installationId = await getInstallationId();
        await apiClient.savePrompt({
          installation_id: installationId,
          client: "extension",
          client_version: browser.runtime.getManifest().version,
          original_text: originalTrimmed,
          improved_text: improvedTrimmed,
          site: undefined,
          page_url: undefined,
          meta: { source: viewMode },
        });
      } catch (err: unknown) {
        const info = mapErrorToToast(err);
        setError(info);
        if (info.type === "rate-limit") {
          setRateLimit((prev) => ({ ...prev, remaining: 0 }));
          setLimitsUnavailable(false);
          setLimitsLoaded(true);
        }
        return false;
      }
    }

    await save({ original: originalTrimmed, improved: improvedTrimmed });
    refreshLibraryCount();
    return true;
  }, [original, improved, refreshLibraryCount, mapErrorToToast, viewMode]);

  const handleDismissError = useCallback(() => setError(null), []);

  const handleGoalChange = useCallback((nextGoal: ImproveGoal) => {
    hasUserSelectedGoalRef.current = true;
    setGoal(nextGoal);
  }, []);

  const handleModeSelection = useCallback(
    async (mode: AudienceMode) => {
      hasUserSelectedGoalRef.current = false;
      setAudienceModeState(mode);
      setGoal(defaultGoalForMode(mode, detectedAiGoal));
      setShowSettings(false);
      try {
        await setAudienceMode(mode);
      } catch {
        // Ignore storage write failures; mode stays active for current popup session.
      }
    },
    [detectedAiGoal],
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={`popup-container ${viewMode}`}>
      <header className="header">
        <div className="header-brand">
          <SparkleIcon className="header-icon" />
          <div className="header-brand-text">
            <span className="header-title">{t.appName}</span>
          </div>
        </div>

        {audienceMode && (
          <div className="settings-menu mode-switch-menu" ref={settingsRef}>
            <button
              type="button"
              className={`mode-badge mode-switch-btn ${audienceMode}`}
              title={t.settingsOpen}
              aria-label={t.settingsOpen}
              data-testid="mode-switch-trigger"
              aria-expanded={showSettings}
              onClick={() => setShowSettings((current) => !current)}
            >
              {audienceMode === "ai" ? t.modeBadgeAi : t.modeBadgeContent}
            </button>
            {showSettings && (
              <div className="settings-popover" role="dialog" aria-label={t.settingsTitle}>
                <p className="settings-hint">{t.settingsModeHint}</p>
                <div className="settings-mode-field">
                  <button
                    type="button"
                    className={`settings-mode-card${audienceMode === "ai" ? " active" : ""}`}
                    data-mode="ai"
                    onClick={() => handleModeSelection("ai")}
                  >
                    <strong>{t.onboardingAiTitle}</strong>
                  </button>
                  <button
                    type="button"
                    className={`settings-mode-card${audienceMode === "content" ? " active" : ""}`}
                    data-mode="content"
                    onClick={() => handleModeSelection("content")}
                  >
                    <strong>{t.onboardingContentTitle}</strong>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="header-actions">
          {/* Layout toggle button */}
          <button
            type="button"
            className="layout-toggle-btn"
            title={viewMode === "popup" ? t.switchToSidebar : t.switchToPopup}
            onClick={handleLayoutToggle}
            aria-label={viewMode === "popup" ? t.switchToSidebar : t.switchToPopup}
          >
            <LayoutSidebarRightIcon
              className="layout-toggle-icon"
              mirrored={viewMode === "sidepanel"}
            />
          </button>

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
              className={`rate-limit-badge${isExhausted ? " exhausted" : isWarning ? " warn" : ""}`}
              aria-describedby={showTooltip ? RATE_LIMIT_TOOLTIP_ID : undefined}
              aria-expanded={showRateLimitTooltip ? showTooltip : undefined}
            >
              {showRateLimitTooltip && <span className="status-dot" />}
              {rateLimitBadgeText}
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
                      <a
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          browser.tabs.create({ url: UPGRADE_URL });
                        }}
                      >
                        {t.tooltipUpgrade}
                      </a>
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
          onClick={() => setActiveTab("improve")}
        >
          <SparkleIcon className="tab-icon" />
          {t.tabImprove}
        </button>
        <button
          className={`tab${activeTab === "library" ? " active" : ""}`}
          onClick={() => {
            setActiveTab("library");
            refreshLibraryCount();
          }}
        >
          <BookmarkIcon className="tab-icon" />
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
                  onClick={() => browser.tabs.create({ url: UPGRADE_URL })}
                >
                  {t.btnUpgrade}
                </button>
              </div>
            )}
            {!modeReady ? null : audienceMode ? (
              <PromptForm
                original={original}
                improved={improved}
                improvements={changes}
                mode={audienceMode}
                goal={goal}
                loading={loading}
                onGoalChange={handleGoalChange}
                onOriginalChange={setOriginal}
                onImprove={handleImprove}
              />
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
            <ActionBar
              improved={improved}
              disabled={!improved}
              onSave={handleSave}
              requestId={lastRequestId}
              source={viewMode}
              model={lastModel}
              latencyMs={lastLatencyMs}
            />
            {FEATURES.OPEN_AND_PASTE && <SiteIcons improved={improved} disabled={!improved} />}
          </>
        ) : (
          <Library onCountChange={setLibraryCount} />
        )}
      </div>
      <RatingBar />
    </div>
  );
}
