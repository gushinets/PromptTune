import { useState, useEffect, useCallback, type FocusEvent } from "react";
import browser from "webextension-polyfill";
import { PromptForm } from "./components/PromptForm";
import { ActionBar } from "./components/ActionBar";
import { SiteIcons } from "./components/SiteIcons";
import { Library } from "./components/Library";
import { ErrorToast } from "./components/ErrorToast";
import { RatingBar } from "./components/RatingBar";
import { getAll, save, getInstallationId } from "@shared/storage";
import { FEATURES, BACKEND_MODE } from "@shared/constants";
import { apiClient, ApiError } from "@shared/api-client";
import {
  describeUnexpectedBackgroundResponse,
  extractImproveResponse,
  extractRateLimitResponse,
} from "@shared/response-utils";

// TODO: Replace with actual upgrade URL
const UPGRADE_URL = "https://forgekit.io/upgrade";
const RATE_LIMIT_TOOLTIP_ID = "rate-limit-tooltip";

type TabId = "improve" | "library";

export interface ErrorInfo {
  type: "rate-limit" | "network" | "auth" | "generic";
  message: string;
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

function BookmarkIcon({ className }: { className?: string }) {
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
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>("improve");
  const [original, setOriginal] = useState("");
  const [improved, setImproved] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [rateLimit, setRateLimit] = useState({ remaining: 0, total: 0 });
  const [limitsLoaded, setLimitsLoaded] = useState(false);
  const [limitsUnavailable, setLimitsUnavailable] = useState(false);
  const [libraryCount, setLibraryCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const refreshLibraryCount = useCallback(() => {
    getAll().then((entries) => setLibraryCount(entries.length));
  }, []);

  useEffect(() => {
    refreshLibraryCount();
  }, [refreshLibraryCount]);

  useEffect(() => {
    // Populate totals + remaining counts on popup open, so UI matches backend/env limits.
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
        // Best-effort; allow improving even if the balance lookup fails.
        setLimitsUnavailable(true);
      });
  }, []);

  const isExhausted = BACKEND_MODE === "fastapi" && limitsLoaded ? rateLimit.remaining <= 0 : false;
  const isWarning =
    BACKEND_MODE === "fastapi" && limitsLoaded
      ? rateLimit.remaining > 0 && rateLimit.remaining <= 10
      : false;
  const showRateLimitTooltip = BACKEND_MODE === "fastapi";
  const rateLimitBadgeText =
    BACKEND_MODE !== "fastapi"
      ? "Unlimited"
      : !limitsLoaded
        ? limitsUnavailable
          ? "Limits unavailable"
          : "Loading limits..."
        : rateLimit.total > 0
          ? `${rateLimit.remaining}/${rateLimit.total} today`
          : `${rateLimit.remaining} today`;

  const handleTooltipBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(nextTarget)) {
      setShowTooltip(false);
    }
  }, []);

  const mapErrorToToast = useCallback(
    (err: unknown): ErrorInfo => {
      if (err instanceof ApiError) {
        if (err.status === 403 || err.detail.toLowerCase().includes("login is invalid")) {
          return {
            type: "auth",
            message: "Your login is invalid. Try refreshing the extension or reinstalling.",
          };
        }
        if (err.status === 429 || err.detail.toLowerCase().includes("rate limit")) {
          return {
            type: "rate-limit",
            message:
              rateLimit.total > 0
                ? `You've used all ${rateLimit.total.toLocaleString()} requests today. Resets at midnight UTC.`
                : "You've used all requests today. Resets at midnight UTC.",
          };
        }
        if (err.status === 422) {
          return {
            type: "generic",
            message: err.detail,
          };
        }
      }

      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("403") || message.toLowerCase().includes("login is invalid")) {
        return {
          type: "auth",
          message: "Your login is invalid. Try refreshing the extension or reinstalling.",
        };
      }
      if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
        return {
          type: "rate-limit",
          message:
            rateLimit.total > 0
              ? `You've used all ${rateLimit.total.toLocaleString()} requests today. Resets at midnight UTC.`
              : "You've used all requests today. Resets at midnight UTC.",
        };
      }
      if (message.includes("422")) {
        const validationDetail = message.replace(/^.*API 422:\s*/i, "").trim();
        return {
          type: "generic",
          message: validationDetail || message,
        };
      }
      if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.toLowerCase().includes("network")
      ) {
        return {
          type: "network",
          message: "Check your internet and try again.",
        };
      }

      return {
        type: "generic",
        message: message || "Something went wrong. Please try again.",
      };
    },
    [rateLimit.total],
  );

  const handleImprove = useCallback(async () => {
    const trimmed = original.trim();
    if (!trimmed) return;

    if (isExhausted) {
      setError({
        type: "rate-limit",
        message:
          rateLimit.total > 0
            ? `You've used all ${rateLimit.total.toLocaleString()} requests today. Resets at midnight UTC.`
            : "You've used all requests today. Resets at midnight UTC.",
      });
      return;
    }

    setLoading(true);
    setError(null);
    setImproved("");

    try {
      const response = await browser.runtime.sendMessage({
        type: "IMPROVE_REQUEST",
        payload: { text: trimmed },
      });
      const result = extractImproveResponse(response);

      if (result) {
        if (!result.improved_text.trim()) {
          throw new Error("The backend returned an empty improved prompt.");
        }
        setImproved(result.improved_text);
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
  }, [original, isExhausted, mapErrorToToast, rateLimit.total]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const originalTrimmed = original.trim();
    const improvedTrimmed = improved.trim();
    if (!originalTrimmed || !improvedTrimmed) return false;

    if (BACKEND_MODE === "fastapi") {
      try {
        const installationId = await getInstallationId();
        const client = "extension";
        const clientVersion = browser.runtime.getManifest().version;
        await apiClient.savePrompt({
          installation_id: installationId,
          client,
          client_version: clientVersion,
          original_text: originalTrimmed,
          improved_text: improvedTrimmed,
          site: undefined,
          page_url: undefined,
          meta: { source: "popup" },
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
  }, [original, improved, refreshLibraryCount, mapErrorToToast]);

  const handleDismissError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <div className="popup-container">
      <header className="header">
        <div className="header-brand">
          <SparkleIcon className="header-icon" />
          <span className="header-title">PromptTune</span>
        </div>
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
                <p>Loading your daily free request balance.</p>
              ) : !limitsLoaded ? (
                <p>
                  We couldn&apos;t load your current balance. Improvements still work, and the next
                  successful request will refresh this count.
                </p>
              ) : (
                <>
                  <p>
                    <strong>
                      {rateLimit.total > 0 ? `${rateLimit.remaining} free` : rateLimit.remaining}
                    </strong>{" "}
                    improvements left today
                  </p>
                  <p>
                    {rateLimit.total > 0 ? `Daily limit: ${rateLimit.total}. ` : ""}
                    Resets at midnight UTC.{" "}
                    <a
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        browser.tabs.create({ url: UPGRADE_URL });
                      }}
                    >
                      Upgrade for unlimited
                    </a>
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <nav className="tab-bar">
        <button
          className={`tab${activeTab === "improve" ? " active" : ""}`}
          onClick={() => setActiveTab("improve")}
        >
          <SparkleIcon className="tab-icon" />
          Improve
        </button>
        <button
          className={`tab${activeTab === "library" ? " active" : ""}`}
          onClick={() => {
            setActiveTab("library");
            refreshLibraryCount();
          }}
        >
          <BookmarkIcon className="tab-icon" />
          Library
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
                <p>You&apos;ve used all free improvements today.</p>
                <button
                  className="btn-upgrade"
                  onClick={() => browser.tabs.create({ url: UPGRADE_URL })}
                >
                  Upgrade for unlimited
                </button>
              </div>
            )}
            <PromptForm
              original={original}
              improved={improved}
              loading={loading}
              onOriginalChange={setOriginal}
              onImprove={handleImprove}
            />
            <ActionBar improved={improved} disabled={!improved} onSave={handleSave} />
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
