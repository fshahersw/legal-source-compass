import { cn } from "@/lib/utils";

/**
 * A compact segmented switch between the datasets one page shows (committee reports / hearings / prints, nominations /
 * treaties). Buttons with aria-pressed; the page keeps the choice in its URL so back/forward works.
 */
export function DatasetSwitch<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: K; label: string }[];
  value: K;
  onChange: (next: K) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="mb-3 inline-flex max-w-full flex-wrap rounded-md border border-border bg-surface p-0.5"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded px-2.5 py-1 text-[12.5px] font-medium focus-visible:outline-2 focus-visible:outline-ring",
              on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
