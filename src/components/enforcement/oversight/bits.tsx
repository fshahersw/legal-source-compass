import { useId } from "react";
import { Search } from "lucide-react";
import type { FacetOption } from "@/lib/external/oversight.functions";
import { rangeLabel } from "./oversightView";

const control =
  "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function SearchBox({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  const id = useId();
  return (
    <div className="relative min-w-0 flex-1 basis-56">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
      />
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  any = "Any",
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly FacetOption[];
  any?: string;
  className?: string;
}) {
  return (
    <label className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${control} min-w-0 max-w-[14rem] ${className ?? ""}`}
      >
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pager({
  page,
  pageSize,
  shown,
  total,
  onPage,
  busy,
  noun,
}: {
  page: number;
  pageSize: number;
  shown: number;
  total: number | null;
  onPage: (p: number) => void;
  busy?: boolean;
  noun: string;
}) {
  const last = total != null ? Math.max(0, Math.ceil(total / pageSize) - 1) : null;
  const next = last != null ? page < last : shown === pageSize;
  const btn =
    "rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5">
      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        {rangeLabel(page, pageSize, shown, total)} {noun}
        {busy ? " · updating…" : ""}
      </p>
      <div className="flex gap-1">
        <button type="button" className={btn} disabled={page <= 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className={btn} disabled={!next} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      Retry
    </button>
  );
}

export function Skeleton({ label, className = "h-40" }: { label: string; className?: string }) {
  return (
    <div
      className={`${className} animate-pulse rounded-md border border-border bg-muted/40`}
      aria-busy="true"
      aria-label={label}
    />
  );
}
