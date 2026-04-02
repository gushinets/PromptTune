import { useEffect, useState, useMemo, useCallback } from "react";
import { SearchBar } from "./SearchBar";
import { LibraryItem } from "./LibraryItem";
import { getAll, remove, type LibraryEntry } from "@shared/storage";

function estimateStorageBytes(entries: LibraryEntry[]): string {
  const bytes = new Blob([JSON.stringify(entries)]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface LibraryProps {
  onCountChange?: (count: number) => void;
}

export function Library({ onCountChange }: LibraryProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const loadEntries = useCallback(() => {
    getAll().then((loaded) => {
      setEntries(loaded);
      onCountChange?.(loaded.length);
    });
  }, [onCountChange]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleDelete = async (id: string) => {
    await remove(id);
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      onCountChange?.(updated.length);
      return updated;
    });
  };

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (e) =>
        e.original.toLowerCase().includes(q) ||
        e.improved.toLowerCase().includes(q) ||
        (e.site?.toLowerCase().includes(q) ?? false),
    );
  }, [entries, searchQuery]);

  return (
    <div className="library">
      <SearchBar query={searchQuery} onChange={setSearchQuery} />

      {entries.length === 0 ? (
        <p className="empty-state">No saved prompts yet.</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">No prompts match your search.</p>
      ) : (
        filtered.map((entry) => (
          <LibraryItem key={entry.id} entry={entry} onDelete={handleDelete} />
        ))
      )}

      {entries.length > 0 && (
        <div className="storage-stats">
          {entries.length} {entries.length === 1 ? "prompt" : "prompts"} &middot;{" "}
          {estimateStorageBytes(entries)} used
        </div>
      )}
    </div>
  );
}
