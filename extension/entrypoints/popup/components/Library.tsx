import { useEffect, useState } from "react";
import { LibraryItem } from "./LibraryItem";
import { getAll, remove, type LibraryEntry } from "@shared/storage";

export function Library() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);

  useEffect(() => {
    getAll().then(setEntries);
  }, []);

  const handleDelete = async (id: string) => {
    await remove(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  if (entries.length === 0) {
    return <p style={{ textAlign: "center", color: "var(--text-muted)" }}>No saved prompts yet.</p>;
  }

  return (
    <div className="library">
      {entries.map((entry) => (
        <LibraryItem key={entry.id} entry={entry} onDelete={handleDelete} />
      ))}
    </div>
  );
}
