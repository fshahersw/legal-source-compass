import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewTab<T extends string> = {
  id: T;
  label: string;
  Icon?: LucideIcon;
  disabled?: boolean | undefined;
  note?: string | undefined;
};

/** A compact tab strip whose state lives in the URL (the caller navigates); arrow keys move between tabs. */
export function ViewTabs<T extends string>({
  label,
  tabs,
  active,
  onSelect,
  idPrefix,
}: {
  label: string;
  tabs: readonly ViewTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  idPrefix: string;
}) {
  const enabled = tabs.filter((t) => !t.disabled);
  const move = (dir: 1 | -1) => {
    const i = enabled.findIndex((t) => t.id === active);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (next) {
      onSelect(next.id);
      document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
    }
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(1);
        else if (e.key === "ArrowLeft") move(-1);
      }}
    >
      {tabs.map(({ id, label: text, Icon, disabled, note }) => (
        <button
          key={id}
          id={`${idPrefix}-tab-${id}`}
          type="button"
          role="tab"
          aria-selected={active === id}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={active === id ? 0 : -1}
          disabled={disabled}
          title={note}
          onClick={() => onSelect(id)}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            active === id
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
            disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
          )}
        >
          {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
          {text}
        </button>
      ))}
    </div>
  );
}
