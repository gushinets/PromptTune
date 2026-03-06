import type { LibraryEntry } from "@shared/storage";

interface LibraryItemProps {
  entry: LibraryEntry;
  onDelete: (id: string) => void;
}

export function LibraryItem({ entry, onDelete }: LibraryItemProps) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.improved);
  };

  return (
    <div className="library-item">
      <p className="library-item-text">{entry.original.slice(0, 80)}...</p>
      <div className="library-item-actions">
        <button onClick={handleCopy}>Copy</button>
        <button onClick={() => onDelete(entry.id)}>Delete</button>
      </div>
    </div>
  );
}
