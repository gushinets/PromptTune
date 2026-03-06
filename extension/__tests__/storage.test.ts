import { describe, it, expect, vi, beforeEach } from "vitest";
import browser from "webextension-polyfill";
import { getInstallationId, getAll, save, remove } from "@shared/storage";

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
