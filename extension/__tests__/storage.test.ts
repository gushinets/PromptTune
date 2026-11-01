import { describe, it, expect, vi, beforeEach } from "vitest";
import browser from "webextension-polyfill";
import {
  type LibraryEntry,
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

    it("prunes a library of large Unicode prompts to a safe byte budget", async () => {
      const original = "😀".repeat(30000);
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        library: Array.from({ length: 88 }, (_, i) => ({
          id: String(i),
          original,
          improved: "ok",
          createdAt: 0,
        })),
      });
      const entry = await save({ original, improved: "ok" });
      const written = vi.mocked(browser.storage.local.set).mock.calls.at(-1)?.[0]
        .library as LibraryEntry[];
      expect(new TextEncoder().encode(JSON.stringify(written)).byteLength + 7).toBeLessThanOrEqual(
        6 * 1024 * 1024,
      );
      expect(written).toHaveLength(52);
      expect(written[0].id).toBe(entry.id);
      expect(written.at(-1)?.id).toBe("50");
    });

    it("does not save remotely when local persistence fails", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({ library: [] });
      vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error("QUOTA_BYTES"));
      const remote = vi.fn();
      await expect(save({ original: "a", improved: "b" }, remote)).rejects.toThrow();
      expect(remote).not.toHaveBeenCalled();
    });

    it("restores the library when the remote save fails", async () => {
      const previous = [{ id: "old", original: "old", improved: "old result", createdAt: 0 }];
      let library = previous;
      vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ library }));
      vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
        library = data.library as LibraryEntry[];
      });
      await expect(
        save({ original: "a", improved: "b" }, async () => {
          throw new Error("remote failed");
        }),
      ).rejects.toThrow("remote failed");
      expect(library).toEqual(previous);
    });

    it("serializes rollback with a concurrent successful save", async () => {
      let queue: Promise<unknown> = Promise.resolve();
      vi.stubGlobal("navigator", {
        locks: {
          request: (_name: string, callback: () => Promise<unknown>) => {
            const next = queue.then(callback);
            queue = next.catch(() => {});
            return next;
          },
        },
      });
      try {
        let library: LibraryEntry[] = [];
        let reads = 0;
        let resolveRollbackRead!: (value: unknown) => void;
        let notifyRollbackRead!: () => void;
        const rollbackRead = new Promise<void>((resolve) => {
          notifyRollbackRead = resolve;
        });
        vi.mocked(browser.storage.local.get).mockImplementation(async () => {
          reads++;
          if (reads === 2) {
            const snapshot = library;
            notifyRollbackRead();
            return new Promise((resolve) => {
              resolveRollbackRead = () => resolve({ library: snapshot });
            });
          }
          return { library };
        });
        vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
          library = data.library as LibraryEntry[];
        });
        const a = save({ original: "A", improved: "a" }, async () => {
          throw new Error("A failed");
        }).catch((error) => error);
        await rollbackRead;
        const b = save({ original: "B", improved: "b" }, async () => {});
        await Promise.resolve();
        await Promise.resolve();
        resolveRollbackRead(undefined);
        await a;
        await b;
        expect(library.map((entry) => entry.original)).toEqual(["B"]);
      } finally {
        vi.unstubAllGlobals();
      }
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

    it("migrates a legacy draft without timestamp", async () => {
      vi.setSystemTime(new Date("2026-06-16T12:00:00.000Z"));
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: {
          activeTab: "improve",
          original: "legacy draft",
          improved: "legacy improved",
          changes: ["change"],
          goal: "general",
          lastRequestId: "req-legacy",
          lastRequestContextKey: "ctx-legacy",
          lastModel: "gpt",
          lastLatencyMs: 123,
          attemptN: 2,
        },
      });

      await expect(getPopupSessionDraft()).resolves.toEqual({
        activeTab: "improve",
        original: "legacy draft",
        improved: "legacy improved",
        changes: ["change"],
        goal: "general",
        lastRequestId: "req-legacy",
        lastRequestContextKey: "ctx-legacy",
        lastModel: "gpt",
        lastLatencyMs: 123,
        attemptN: 2,
      });
      expect(browser.storage.local.set).toHaveBeenCalledWith({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: expect.objectContaining({
          original: "legacy draft",
          improved: "legacy improved",
          updatedAt: new Date("2026-06-16T12:00:00.000Z").getTime(),
        }),
      });
      expect(browser.storage.local.remove).not.toHaveBeenCalled();
    });

    it("clears a truthy primitive draft value", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: "corrupted",
      });

      await expect(getPopupSessionDraft()).resolves.toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith(STORAGE_KEYS.POPUP_SESSION_DRAFT);
    });

    it("clears a legacy draft with non-finite numeric fields", async () => {
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        [STORAGE_KEYS.POPUP_SESSION_DRAFT]: {
          activeTab: "improve",
          original: "legacy draft",
          improved: "legacy improved",
          changes: ["change"],
          goal: "general",
          lastRequestId: "req-legacy",
          lastRequestContextKey: "ctx-legacy",
          lastModel: "gpt",
          lastLatencyMs: Number.POSITIVE_INFINITY,
          attemptN: 2,
        },
      });

      await expect(getPopupSessionDraft()).resolves.toBeNull();
      expect(browser.storage.local.remove).toHaveBeenCalledWith(STORAGE_KEYS.POPUP_SESSION_DRAFT);
      expect(browser.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({
          [STORAGE_KEYS.POPUP_SESSION_DRAFT]: expect.anything(),
        }),
      );
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
