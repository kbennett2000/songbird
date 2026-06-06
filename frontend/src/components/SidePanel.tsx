import { type ReactNode } from "react";

interface SidePanelProps {
  open: boolean;
  title: string;
  subtitle?: string | null;
  scopeLabel?: string | null;
  onClose: () => void;
  children: ReactNode;
}

/** A right-hand drawer that keeps the passage visible while you write (SPEC §8.2). */
export function SidePanel({
  open,
  title,
  subtitle,
  scopeLabel,
  onClose,
  children,
}: SidePanelProps): JSX.Element | null {
  if (!open) return null;
  return (
    <aside
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl"
      aria-label="Note panel"
    >
      <header className="flex items-start justify-between border-b border-gray-200 p-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          {scopeLabel && <p className="mt-1 text-sm text-amber-700">⚠ {scopeLabel}</p>}
        </div>
        <button
          type="button"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          onClick={onClose}
          aria-label="Close note panel"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}
