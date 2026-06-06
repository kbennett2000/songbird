import { type ReactNode, useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A centered, accessible modal — used by the Map View, where a side drawer would be too cramped.
 * Near-full-screen on small viewports (a first-class mobile constraint), centered with a cap on
 * desktop. Closes on Esc, on backdrop click, and via a visible ✕. Focus moves into the dialog on
 * open and is restored to the trigger on close.
 */
export function Modal({ open, title, onClose, children }: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes; restore focus to whatever was focused before the modal opened.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex h-full w-full flex-col bg-white shadow-xl outline-none sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
