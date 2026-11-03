import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
    const queues = new Map<string, Promise<unknown>>();
    const held = new Set<string>();
    vi.stubGlobal("navigator", {
      locks: {
        request: <T>(name: string, operation: () => Promise<T>) => {
          const result = (queues.get(name) ?? Promise.resolve()).then(async () => {
            held.add(name);
            try {
              return await operation();
            } finally {
              held.delete(name);
            }
          });
          queues.set(
            name,
            result.catch(() => undefined),
          );
          return result;
        },
        query: async () => ({ held: [...held].map((name) => ({ name })) }),
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      const state: Record<string, unknown> = { library: previous };
      vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
      vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
        Object.assign(state, data);
      });
      await expect(
        save({ original: "a", improved: "b" }, async () => {
          throw new Error("remote failed");
        }),
      ).rejects.toThrow("remote failed");
      expect(await getAll()).toEqual(previous);
    });

    it.each([false, true])(
      "keeps old entries when A fails after B completes (delete old=%s)",
      async (deleteOld) => {
        const existing = Array.from({ length: 199 }, (_, i) => ({
          id: `old-${i}`,
          original: `old-${i}`,
          improved: "old",
          createdAt: 0,
        }));
        const state: Record<string, unknown> = { library: existing };
        vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
        vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
          Object.assign(state, data);
        });
        let rejectA!: (error: Error) => void;
        let startedA!: () => void;
        const started = new Promise<void>((resolve) => {
          startedA = resolve;
        });
        const a = save({ original: "A", improved: "a" }, () => {
          startedA();
          return new Promise((_resolve, reject) => {
            rejectA = reject;
          });
        }).catch((error) => error);
        await started;
        await save({ original: "B", improved: "b" }, async () => {});
        if (deleteOld) await remove("old-1");
        rejectA(new Error("A failed"));
        await a;
        const result = await getAll();
        expect(result).toHaveLength(deleteOld ? 199 : 200);
        expect(result.some((entry) => entry.original === "B")).toBe(true);
        expect(result.some((entry) => entry.id === "old-198")).toBe(true);
        expect(result.some((entry) => entry.id === "old-1")).toBe(!deleteOld);
        expect(result.some((entry) => entry.original === "A")).toBe(false);
      },
    );

    it("preserves all old entries when overlapping provisional saves both fail", async () => {
      const existing = Array.from({ length: 199 }, (_, i) => ({
        id: `old-${i}`,
        original: `old-${i}`,
        improved: "old",
        createdAt: 0,
      }));
      const state: Record<string, unknown> = { library: existing };
      vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
      vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
        Object.assign(state, data);
      });
      let rejectA!: (error: Error) => void;
      let rejectB!: (error: Error) => void;
      let startedA!: () => void;
      let startedB!: () => void;
      const first = new Promise<void>((resolve) => {
        startedA = resolve;
      });
      const second = new Promise<void>((resolve) => {
        startedB = resolve;
      });
      const a = save({ original: "A", improved: "a" }, () => {
        startedA();
        return new Promise((_resolve, reject) => {
          rejectA = reject;
        });
      }).catch((error) => error);
      await first;
      const b = save({ original: "B", improved: "b" }, () => {
        startedB();
        return new Promise((_resolve, reject) => {
          rejectB = reject;
        });
      }).catch((error) => error);
      await second;
      rejectA(new Error("A failed"));
      await a;
      rejectB(new Error("B failed"));
      await b;
      expect(await getAll()).toEqual(existing);
    });

    it("commits both successful overlapping saves without reclaiming a live reservation", async () => {
      const state: Record<string, unknown> = { library: [] };
      vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
      vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
        Object.assign(state, data);
      });
      let finishA!: () => void;
      let startedA!: () => void;
      const started = new Promise<void>((resolve) => {
        startedA = resolve;
      });
      const a = save({ original: "A", improved: "a" }, () => {
        startedA();
        return new Promise<void>((resolve) => {
          finishA = resolve;
        });
      });
      await started;
      await save({ original: "B", improved: "b" }, async () => {});
      finishA();
      await a;
      expect((await getAll()).map((entry) => entry.original)).toEqual(["A", "B"]);
      expect(state.pending_library_saves).toEqual([]);
    });

    it("reclaims reservations left by a closed context before reserving new data", async () => {
      const state: Record<string, unknown> = {
        library: [],
        pending_library_saves: [
          { id: "orphan", original: "orphan", improved: "orphan", createdAt: Date.now() },
        ],
      };
      vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
      vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
        Object.assign(state, data);
      });
      await save({ original: "new", improved: "better" }, async () => {
        expect(
          (state.pending_library_saves as LibraryEntry[]).map((entry) => entry.original),
        ).toEqual(["new"]);
      });
      expect((await getAll()).map((entry) => entry.original)).toEqual(["new"]);
      expect(state.pending_library_saves).toEqual([]);
    });

    it("reserves Unicode data without pruning the library until remote success", async () => {
      const original = "😀".repeat(30000);
      const state: Record<string, unknown> = {
        library: Array.from({ length: 52 }, (_, i) => ({
          id: `old-${i}`,
          original,
          improved: "ok",
          createdAt: 0,
        })),
      };
      vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
      const sizes: number[] = [];
      vi.mocked(browser.storage.local.set).mockImplementation(async (data) => {
        Object.assign(state, data);
        sizes.push(
          Object.entries(state).reduce(
            (total, [key, value]) =>
              total + key.length + new TextEncoder().encode(JSON.stringify(value)).byteLength,
            0,
          ),
        );
      });
      const entry = await save({ original, improved: "new" }, async () => {
        expect((await getAll()).map((item) => item.id)).toContain("old-51");
        expect(
          (state.pending_library_saves as LibraryEntry[]).map((item) => item.original),
        ).toEqual([original]);
      });
      expect((await getAll())[0].id).toBe(entry.id);
      expect(await getAll()).toHaveLength(52);
      expect((await getAll()).some((item) => item.id === "old-51")).toBe(false);
      expect(sizes).toHaveLength(2);
      expect(sizes[1]).toBeLessThanOrEqual(sizes[0]);
      expect(Math.max(...sizes)).toBeLessThan(10 * 1024 * 1024);
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
