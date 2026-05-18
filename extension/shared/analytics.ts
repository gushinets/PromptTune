import browser from "webextension-polyfill";
import type { AnalyticsEventName, AnalyticsProperties, AnalyticsSource } from "./analytics-types";
import { ANALYTICS_ENABLED } from "./constants";

export async function trackEvent(
  name: AnalyticsEventName,
  properties: AnalyticsProperties = {},
  source?: AnalyticsSource,
): Promise<void> {
  if (!ANALYTICS_ENABLED) return;
  await browser.runtime.sendMessage({
    type: "TRACK_EVENT",
    payload: {
      name,
      properties,
      context: source ? { source } : undefined,
    },
  });
}
