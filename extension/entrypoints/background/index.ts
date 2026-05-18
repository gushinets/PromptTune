import browser from "webextension-polyfill";
import { apiClient, ApiError } from "@shared/api-client";
import { ANALYTICS_ENABLED, STORAGE_KEYS } from "@shared/constants";
import { getInstallationId } from "@shared/storage";
import type { Message } from "@shared/messages";
import type {
  AnalyticsEventName,
  AnalyticsEventOut,
  AnalyticsProperties,
  AnalyticsSessionState,
  AnalyticsSource,
  AnalyticsTrackPayload,
} from "@shared/analytics-types";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_QUEUE_ITEMS = 500;
const ANALYTICS_BATCH_SIZE = 50;

function detectChromeMajor(): string {
  const match = navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/i);
  return match?.[1] ?? "unknown";
}

function mapPlatformOs(os: string): string {
  if (os === "mac") return "mac";
  if (os === "win") return "win";
  if (os === "linux") return "linux";
  if (os === "android") return "android";
  if (os === "cros") return "cros";
  return "unknown";
}

export default defineBackground(() => {
  const client = "extension";
  const clientVersion = browser.runtime.getManifest().version;

  let sessionOpChain: Promise<void> = Promise.resolve();
  let flushInFlight = false;

  const enqueueSessionOp = async <T>(op: () => Promise<T>): Promise<T> => {
    let resolveOut: (value: T) => void;
    let rejectOut: (reason?: unknown) => void;
    const out = new Promise<T>((resolve, reject) => {
      resolveOut = resolve;
      rejectOut = reject;
    });

    sessionOpChain = sessionOpChain
      .then(async () => {
        try {
          resolveOut(await op());
        } catch (err) {
          rejectOut(err);
        }
      })
      .catch(() => undefined);

    return out;
  };

  async function getSessionState(): Promise<AnalyticsSessionState | null> {
    const data = await browser.storage.local.get(STORAGE_KEYS.ANALYTICS_SESSION_STATE);
    return (data[STORAGE_KEYS.ANALYTICS_SESSION_STATE] as AnalyticsSessionState | undefined) ?? null;
  }

  async function setSessionState(state: AnalyticsSessionState): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEYS.ANALYTICS_SESSION_STATE]: state });
  }

  async function ensureSessionUnlocked(now = new Date()): Promise<AnalyticsSessionState> {
    const current = await getSessionState();
    const nowMs = now.getTime();

    if (!current || nowMs - new Date(current.last_activity_at).getTime() > SESSION_TIMEOUT_MS) {
      const next: AnalyticsSessionState = {
        session_id: crypto.randomUUID(),
        session_started_at: now.toISOString(),
        last_activity_at: now.toISOString(),
        session_prompt_n: 0,
      };
      await setSessionState(next);
      return next;
    }

    const next: AnalyticsSessionState = {
      ...current,
      last_activity_at: now.toISOString(),
    };
    await setSessionState(next);
    return next;
  }

  async function ensureAnalyticsSession(now = new Date()): Promise<AnalyticsSessionState> {
    return enqueueSessionOp(async () => ensureSessionUnlocked(now));
  }

  async function incrementSessionPromptCount(now = new Date()): Promise<AnalyticsSessionState> {
    return enqueueSessionOp(async () => {
      const state = await ensureSessionUnlocked(now);
      const next: AnalyticsSessionState = {
        ...state,
        session_prompt_n: state.session_prompt_n + 1,
        last_activity_at: now.toISOString(),
      };
      await setSessionState(next);
      return next;
    });
  }

  async function getQueue(): Promise<AnalyticsEventOut[]> {
    const data = await browser.storage.local.get(STORAGE_KEYS.ANALYTICS_QUEUE);
    return (data[STORAGE_KEYS.ANALYTICS_QUEUE] as AnalyticsEventOut[] | undefined) ?? [];
  }

  async function setQueue(queue: AnalyticsEventOut[]): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEYS.ANALYTICS_QUEUE]: queue });
  }

  async function enqueueEvent(event: AnalyticsEventOut): Promise<void> {
    const queue = await getQueue();
    queue.push(event);
    const next = queue.slice(-MAX_QUEUE_ITEMS);
    await setQueue(next);
  }

  async function flushAnalytics(): Promise<void> {
    if (flushInFlight) return;
    flushInFlight = true;
    try {
      while (true) {
        const queue = await getQueue();
        if (!queue.length) return;

        const batch = queue.slice(0, ANALYTICS_BATCH_SIZE);
        await apiClient.events(batch);
        await setQueue(queue.slice(batch.length));
      }
    } catch {
      // Keep queue for later retry.
    } finally {
      flushInFlight = false;
    }
  }

  async function buildEvent(
    name: AnalyticsEventName,
    properties: AnalyticsProperties,
    source: AnalyticsSource,
    options?: { promptSubmitted?: boolean },
  ): Promise<AnalyticsEventOut> {
    const installationId = await getInstallationId();
    const platform = await browser.runtime.getPlatformInfo();
    const session = options?.promptSubmitted
      ? await incrementSessionPromptCount()
      : await ensureAnalyticsSession();

    const eventProperties: AnalyticsProperties = { ...properties };
    if (options?.promptSubmitted) {
      eventProperties.session_prompt_n = session.session_prompt_n;
    }

    return {
      event_id: crypto.randomUUID(),
      name,
      user_id: installationId,
      session_id: session.session_id,
      occurred_at: new Date().toISOString(),
      extension_version: clientVersion,
      os: mapPlatformOs(platform.os),
      chrome_version: detectChromeMajor(),
      user_plan: "free",
      source,
      properties: eventProperties,
    };
  }

  async function track(payload: AnalyticsTrackPayload): Promise<void> {
    if (!ANALYTICS_ENABLED) return;
    const source = payload.context?.source ?? "background";
    const event = await buildEvent(payload.name, payload.properties ?? {}, source);
    await enqueueEvent(event);
    await flushAnalytics();

    if (payload.name === "result_copied") {
      const first = await browser.storage.local.get(STORAGE_KEYS.FIRST_RESULT_COPIED_AT);
      if (!first[STORAGE_KEYS.FIRST_RESULT_COPIED_AT]) {
        const installData = await browser.storage.local.get(STORAGE_KEYS.INSTALL_AT);
        const installAt = installData[STORAGE_KEYS.INSTALL_AT] as string | undefined;
        const minutes = installAt
          ? Math.max(0, Math.floor((Date.now() - new Date(installAt).getTime()) / 60000))
          : undefined;
        await browser.storage.local.set({ [STORAGE_KEYS.FIRST_RESULT_COPIED_AT]: new Date().toISOString() });
        const firstEvent = await buildEvent(
          "first_result_copied",
          minutes !== undefined ? { time_since_install_min: minutes } : {},
          source,
        );
        await enqueueEvent(firstEvent);
        await flushAnalytics();
      }
    }
  }

  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== "install") return;

    const installAt = new Date().toISOString();
    await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_AT]: installAt });

    if (ANALYTICS_ENABLED) {
      await track({
        name: "extension_installed",
        context: { source: "background" },
        properties: { install_source: "unknown" },
      });
    }
  });

  if (ANALYTICS_ENABLED) {
    void flushAnalytics();
  }

  browser.runtime.onMessage.addListener(async (raw: unknown) => {
    const msg = raw as Message;

    switch (msg.type) {
      case "TRACK_EVENT": {
        await track(msg.payload);
        return { ok: true };
      }

      case "TRACK_EVENTS": {
        for (const event of msg.payload.events) {
          await track(event);
        }
        return { ok: true };
      }

      case "FLUSH_ANALYTICS": {
        if (ANALYTICS_ENABLED) {
          await flushAnalytics();
        }
        return { ok: true };
      }

      case "IMPROVE_REQUEST": {
        const installationId = await getInstallationId();
        const trimmed = msg.payload.text.trim();

        if (!trimmed) {
          throw new Error("Prompt text is required");
        }

        if (ANALYTICS_ENABLED) {
          const promptEvent = await buildEvent(
            "prompt_submitted",
            {
              prompt_length: trimmed.length,
              site: msg.payload.site,
              view_mode: msg.payload.analytics_context?.view_mode,
            },
            msg.payload.analytics_context?.source ?? "background",
            { promptSubmitted: true },
          );
          await enqueueEvent(promptEvent);

          const firstPromptData = await browser.storage.local.get(STORAGE_KEYS.FIRST_PROMPT_SUBMITTED_AT);
          if (!firstPromptData[STORAGE_KEYS.FIRST_PROMPT_SUBMITTED_AT]) {
            const installData = await browser.storage.local.get(STORAGE_KEYS.INSTALL_AT);
            const installAt = installData[STORAGE_KEYS.INSTALL_AT] as string | undefined;
            const minutes = installAt
              ? Math.max(0, Math.floor((Date.now() - new Date(installAt).getTime()) / 60000))
              : undefined;
            await browser.storage.local.set({
              [STORAGE_KEYS.FIRST_PROMPT_SUBMITTED_AT]: new Date().toISOString(),
            });
            const firstPromptEvent = await buildEvent(
              "first_prompt_submitted",
              minutes !== undefined
                ? { time_since_install_min: minutes, site: msg.payload.site }
                : { site: msg.payload.site },
              msg.payload.analytics_context?.source ?? "background",
            );
            await enqueueEvent(firstPromptEvent);
          }

          const totalUsesData = await browser.storage.local.get(STORAGE_KEYS.TOTAL_USES);
          const totalUses = Number(totalUsesData[STORAGE_KEYS.TOTAL_USES] ?? 0);
          await browser.storage.local.set({ [STORAGE_KEYS.TOTAL_USES]: totalUses + 1 });

          await flushAnalytics();
        }

        const startedAt = Date.now();
        try {
          const result = await apiClient.improve({
            text: trimmed,
            audience_mode: msg.payload.audience_mode,
            goal: msg.payload.goal,
            installation_id: installationId,
            client,
            client_version: clientVersion,
            site: msg.payload.site,
            page_url: msg.payload.page_url,
            client_ts: Date.now() / 1000,
          });

          if (typeof result.latency_ms !== "number") {
            result.latency_ms = Date.now() - startedAt;
          }

          return { type: "IMPROVE_RESULT", payload: result };
        } catch (error: unknown) {
          if (ANALYTICS_ENABLED && error instanceof ApiError) {
            const apiErrorEvent = await buildEvent(
              "api_error",
              {
                endpoint: "/v1/improve",
                status: error.status,
                error_code: error.detail,
                error_type:
                  error.status === 429
                    ? "rate_limit"
                    : error.status === 401 || error.status === 403
                      ? "auth"
                      : error.status >= 500
                        ? "upstream"
                        : error.status === 422
                          ? "validation"
                          : "unknown",
              },
              msg.payload.analytics_context?.source ?? "background",
            );
            await enqueueEvent(apiErrorEvent);
            await flushAnalytics();
          }
          throw error;
        }
      }

      case "GET_LIMITS": {
        const installationId = await getInstallationId();
        const rate_limit = await apiClient.limits(installationId);
        return { type: "LIMITS_RESULT", payload: { rate_limit } };
      }

      case "OPEN_AND_PASTE": {
        const tab = await browser.tabs.create({ url: msg.payload.url });
        browser.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === "complete") {
            browser.tabs.onUpdated.removeListener(listener);
            browser.tabs.sendMessage(tabId, {
              type: "PASTE_TEXT",
              payload: { text: msg.payload.text },
            });
          }
        });
        return { success: true };
      }
    }
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command === "improve-active-field") {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        browser.tabs.sendMessage(tab.id, { type: "IMPROVE_ACTIVE_FIELD" });
      }
    }
  });
});
