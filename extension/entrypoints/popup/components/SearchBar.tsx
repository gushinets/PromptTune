import { useT } from "@shared/i18n";

interface SearchBarProps {
  query: string;
  onChange: (query: string) => void;
}

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export function SearchBar({ query, onChange }: SearchBarProps) {
  const t = useT();
  return (
    <div className="search-bar">
      <SearchIcon className="search-bar-icon" />
      <input
        type="text"
        placeholder={t.searchPlaceholder}
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
