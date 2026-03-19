import type { ReactElement } from "react";
import type { ErrorInfo } from "../App";

interface ErrorToastProps {
  error: ErrorInfo;
  onDismiss: () => void;
  onRetry?: () => void;
}

function AlertCircleIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function WifiOffIcon({ className }: { className?: string }) {
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
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const ERROR_CONFIG: Record<
  ErrorInfo["type"],
  {
    className: string;
    title: string;
    Icon: (props: { className?: string }) => ReactElement;
  }
> = {
  "rate-limit": {
    className: "error-rate-limit",
    title: "Rate limit exceeded.",
    Icon: AlertCircleIcon,
  },
  auth: {
    className: "error-auth",
    title: "Invalid login.",
    Icon: AlertCircleIcon,
  },
  network: {
    className: "error-network",
    title: "Connection failed.",
    Icon: WifiOffIcon,
  },
  generic: {
    className: "error-generic",
    title: "Error",
    Icon: AlertCircleIcon,
  },
};

export function ErrorToast({ error, onDismiss, onRetry }: ErrorToastProps) {
  const config = ERROR_CONFIG[error.type];
  const Icon = config.Icon;

  return (
    <div className={`error-toast ${config.className}`} role="alert">
      <Icon className="error-toast-icon" />
      <div className="error-toast-content">
        <div className="error-toast-title">{config.title}</div>
        <div className="error-toast-message">{error.message}</div>
        {onRetry && (
          <button className="error-toast-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
      <button
        className="error-toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
