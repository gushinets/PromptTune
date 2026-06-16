import { describe, it, expect, vi, beforeEach } from "vitest";
import browser from "webextension-polyfill";
import {
  getInstallationId,
  getAll,
  save,
  remove,
  getAudienceMode,
  setAudienceMode,
  getPopupSessionDraft,
  setPopupSessionDraft,
} from "@shared/storage";
import { LIMITS, STORAGE_KEYS } from "@shared/constants";

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe("getInstallationId", () => {
    it("returns existing installation_id", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        installation_id: "existing-id",
      });
      const id = await getInstallationId();
      expect(id).toBe("existing-id");
    });

    it("generates and stores new id if missing", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({});
      const id = await getInstallationId();
      expect(id).toBeTruthy();
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        installation_id: expect.any(String),
      });
    });
  });

  describe("library CRUD", () => {
    it("returns empty array when no entries", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({});
      const entries = await getAll();
      expect(entries).toEqual([]);
    });

    it("saves an entry", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({});
      const entry = await save({ original: "test", improved: "improved test" });
      expect(entry.id).toBeTruthy();
      expect(entry.original).toBe("test");
      expect(browser.storage.local.set).toHaveBeenCalled();
    });

    it("removes an entry", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        library: [{ id: "1", original: "a", improved: "b", createdAt: 0 }],
      });
      await remove("1");
      expect(browser.storage.local.set).toHaveBeenCalledWith({ library: [] });
    });
  });

  describe("audience mode", () => {
    it("returns null when no mode exists", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({});
      expect(await getAudienceMode()).toBeNull();
    });

    it("returns stored mode", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({ audience_mode: "content" });
      expect(await getAudienceMode()).toBe("content");
    });

    it("persists mode", async () => {
      await setAudienceMode("ai");
      expect(browser.storage.local.set).toHaveBeenCalledWith({ audience_mode: "ai" });
    });
  });

  describe("popup session draft", () => {
    it("stores draft with last activity timestamp", async () => {
      vi.setSystemTime(new Date("2026-06-16T09:00:00.000Z"));

      await setPopupSessionDraft({
        activeTab: "improve",
        original: "draft",
        improved: "better draft",
        changes: [],
        goal: "general",
        lastRequestId: null,
        lastRequestContextKey: null,
        lastModel: null,
        lastLatencyMs: null,
        attemptN: 1,
      });

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: expect.objectContaining({
          original: "draft",
          improved: "better draft",
          updatedAt: new Date("2026-06-16T09:00:00.000Z").getTime(),
        }),
      });
    });

    it("returns a fresh draft", async () => {
      vi.setSystemTime(new Date("2026-06-16T12:00:00.000Z"));
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: {
          activeTab: "improve",
          original: "draft",
          improved: "better draft",
          changes: ["change"],
          goal: "general",
          lastRequestId: "req-1",
          lastRequestContextKey: "ctx",
          lastModel: "gpt",
          lastLatencyMs: 123,
          attemptN: 2,
          updatedAt: new Date("2026-06-16T11:00:00.000Z").getTime(),
        },
      });

      await expect(getPopupSessionDraft()).resolves.toEqual({
        activeTab: "improve",
        original: "draft",
        improved: "better draft",
        changes: ["change"],
        goal: "general",
        lastRequestId: "req-1",
        lastRequestContextKey: "ctx",
        lastModel: "gpt",
        lastLatencyMs: 123,
        attemptN: 2,
      });
      expect(browser.storage.local.remove).not.toHaveBeenCalled();
    });

    it("clears an expired draft", async () => {
      vi.setSystemTime(new Date("2026-06-16T12:00:00.000Z"));
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: {
          activeTab: "improve",
          original: "stale",
          improved: "stale improved",
          changes: [],
          goal: "general",
          lastRequestId: null,
          lastRequestContextKey: null,
          lastModel: null,
          lastLatencyMs: null,
          attemptN: 1,
          updatedAt:
            new Date("2026-06-16T12:00:00.000Z").getTime() - LIMITS.POPUP_SESSION_TTL_MS - 1,
        },
      });

      await expect(getPopupSessionDraft()).resolves.toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith(STORAGE_KEYS.POPUP_SESSION_DRAFT);
    });

    it("clears a draft with a non-finite timestamp", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: {
          activeTab: "improve",
          original: "corrupted",
          improved: "corrupted improved",
          changes: [],
          goal: "general",
          lastRequestId: null,
          lastRequestContextKey: null,
          lastModel: null,
          lastLatencyMs: null,
          attemptN: 1,
          updatedAt: Number.NaN,
        },
      });

      await expect(getPopupSessionDraft()).resolves.toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith(STORAGE_KEYS.POPUP_SESSION_DRAFT);
    });
  });
});
