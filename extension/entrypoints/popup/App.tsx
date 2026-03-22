import { useState, useEffect, useCallback } from "react";
import browser from "webextension-polyfill";
import { PromptForm } from "./components/PromptForm";
import { ActionBar } from "./components/ActionBar";
import { SiteIcons } from "./components/SiteIcons";
import { Library } from "./components/Library";
import { ErrorToast } from "./components/ErrorToast";
import { RatingBar } from "./components/RatingBar";
import { getAll, save, getInstallationId } from "@shared/storage";
import { LIMITS, FEATURES, BACKEND_MODE } from "@shared/constants";
import { apiClient } from "@shared/api-client";
import type { ImproveResponse as ImproveResponseBody } from "@shared/types";

type ImproveResultMessage = { type: "IMPROVE_RESULT"; payload: ImproveResponseBody };

// TODO: Replace with actual upgrade URL
const UPGRADE_URL = "https://forgekit.io/upgrade";

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
        const rate_limit = res?.payload?.rate_limit;
        if (!rate_limit) return;
        setRateLimit({
          remaining: rate_limit.per_day_remaining,
          total: rate_limit.per_day_total,
        });
        setLimitsLoaded(true);
      })
      .catch(() => {
        // Best-effort; fall back to 0/0 until we have a proper value.
        setLimitsLoaded(true);
      });
  }, []);

  const isExhausted =
    BACKEND_MODE === "fastapi" && limitsLoaded ? rateLimit.remaining <= 0 : false;

  const handleImprove = useCallback(async () => {
    const trimmed = original.trim();
    if (!trimmed) return;

    if (trimmed.length > LIMITS.MAX_TEXT_LENGTH) {
      setError({
        type: "generic",
        message: `Prompt exceeds maximum length of ${LIMITS.MAX_TEXT_LENGTH.toLocaleString()} characters.`,
      });
      return;
    }

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
      const response = (await browser.runtime.sendMessage({
        type: "IMPROVE_REQUEST",
        payload: { text: trimmed },
      })) as ImproveResultMessage;

      if (response?.payload?.improved_text) {
        setImproved(response.payload.improved_text);
        if (response.payload.rate_limit) {
          setRateLimit({
            remaining: response.payload.rate_limit.per_day_remaining,
            total: response.payload.rate_limit.per_day_total,
          });
          setLimitsLoaded(true);
        }
      } else {
        throw new Error("Unexpected response from background.");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (
        message.includes("403") ||
        message.toLowerCase().includes("login is invalid")
      ) {
        setError({
          type: "auth",
          message:
            "Your login is invalid. Try refreshing the extension or reinstalling.",
        });
      } else if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
        setError({
          type: "rate-limit",
          message:
            rateLimit.total > 0
              ? `You've used all ${rateLimit.total.toLocaleString()} requests today. Resets at midnight UTC.`
              : "You've used all requests today. Resets at midnight UTC.",
        });
        setRateLimit((prev) => ({ ...prev, remaining: 0 }));
        setLimitsLoaded(true);
      } else if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.toLowerCase().includes("network")
      ) {
        setError({
          type: "network",
          message: "Check your internet and try again.",
        });
      } else {
        setError({
          type: "generic",
          message: message || "Something went wrong. Please try again.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [original, isExhausted, rateLimit.total]);

  const handleSave = useCallback(async () => {
    const originalTrimmed = original.trim();
    const improvedTrimmed = improved.trim();
    if (!originalTrimmed || !improvedTrimmed) return;

    await save({ original: originalTrimmed, improved: improvedTrimmed });
    refreshLibraryCount();

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
      } catch {
        // Best-effort; ignore backend save errors for now.
      }
    }
  }, [original, improved, refreshLibraryCount]);

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
        <span
          className={`rate-limit-badge${isExhausted ? " exhausted" : ""}`}
        >
          {BACKEND_MODE !== "fastapi"
            ? "Unlimited"
            : !limitsLoaded
              ? "Loading limits..."
              : rateLimit.total > 0
                ? `${rateLimit.remaining}/${rateLimit.total} today`
                : `${rateLimit.remaining} today`}
        </span>
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
          {libraryCount > 0 && (
            <span className="tab-badge">{libraryCount}</span>
          )}
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
                <p>You&apos;ve used all 50 free improvements today.</p>
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
            <ActionBar
              improved={improved}
              disabled={!improved}
              onSave={handleSave}
            />
            {FEATURES.OPEN_AND_PASTE && (
              <SiteIcons improved={improved} disabled={!improved} />
            )}
          </>
        ) : (
          <Library onCountChange={setLibraryCount} />
        )}
      </div>
      <RatingBar />
    </div>
  );
}
