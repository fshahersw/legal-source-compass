/**
 * PageTabs: one row of underline tabs, at most seven (AGENTS.md). With more items, six show and the rest sit in a
 * "More" menu; the active tab always stays visible (rule in tabs.ts). Arrow keys, Home and End move between tabs
 * (roving tabindex); the page renders the panel for `value`.
 *
 *   <PageTabs label="Views" items={[{ id: "overview", label: "Overview" }, { id: "trends", label: "Trends", count: 12 }]}
 *     value={view} onValueChange={setView} idPrefix="insights" />
 *   // the panel: <div role="tabpanel" aria-labelledby={tabId("insights", view)}>…</div>
 *
 * `pageTabClass(active)` is the same look for link tabs (the shell's section tabs use it with router links).
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { pageTabClass, tabId } from "./styles";
import { MAX_TABS, splitTabs } from "./tabs";

export type PageTabItem = {
  id: string;
  label: ReactNode;
  count?: ReactNode | undefined;
  disabled?: boolean | undefined;
};

function Count({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-medium tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

export function PageTabs({
  items,
  value,
  onValueChange,
  label,
  idPrefix = "tabs",
  max = MAX_TABS,
  className,
}: {
  items: readonly PageTabItem[];
  value: string;
  onValueChange: (id: string) => void;
  label: string;
  idPrefix?: string | undefined;
  max?: number | undefined;
  className?: string | undefined;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const { visible, overflow } = splitTabs(items, value, max);
  const enabled = visible.filter((t) => !t.disabled);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const i = enabled.findIndex((t) => t.id === id);
    const next =
      event.key === "ArrowRight"
        ? enabled[(i + 1) % enabled.length]
        : event.key === "ArrowLeft"
          ? enabled[(i - 1 + enabled.length) % enabled.length]
          : event.key === "Home"
            ? enabled[0]
            : event.key === "End"
              ? enabled[enabled.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    onValueChange(next.id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(idPrefix, next.id))}`)
      ?.focus();
  }

  return (
    <div className={cn("flex items-end gap-5 border-b border-border", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="flex min-w-0 items-end gap-5 overflow-x-auto"
      >
        {visible.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              id={tabId(idPrefix, t.id)}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              disabled={t.disabled}
              onClick={() => onValueChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, t.id)}
              className={cn(
                pageTabClass(active),
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {t.label}
              {t.count != null ? <Count>{t.count}</Count> : null}
            </button>
          );
        })}
      </div>
      {overflow.length ? (
        <Popover>
          <PopoverTrigger className={cn(pageTabClass(false), "gap-1")}>
            More
            <ChevronDown className="size-3.5" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <ul className="m-0 list-none p-0" aria-label={`More ${label.toLowerCase()}`}>
              {overflow.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={t.disabled}
                    onClick={() => onValueChange(t.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    {t.label}
                    {t.count != null ? <Count>{t.count}</Count> : null}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
