interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  return (
    <div className="error-toast" onClick={onDismiss} role="alert">
      {message}
    </div>
  );
}
