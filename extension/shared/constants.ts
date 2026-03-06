export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const STORAGE_KEYS = {
  INSTALLATION_ID: "installation_id",
  LIBRARY: "library",
} as const;

export const LIMITS = {
  MAX_TEXT_LENGTH: 8000,
  MAX_LIBRARY_ENTRIES: 200,
} as const;
