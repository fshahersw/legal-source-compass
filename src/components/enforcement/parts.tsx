import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  actions,
  footnote,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border bg-surface",
        className,
      )}
      aria-label={title}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-5">{title}</h3>
          {subtitle ? <p className="text-xs leading-4 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>
      {children}
      {footnote ? (
        <div className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
          {footnote}
        </div>
      ) : null}
    </section>
  );
}

export function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: "warning" | "destructive" | undefined;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-mono text-lg font-semibold leading-tight",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </p>
      {note ? <p className="truncate text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] focus-visible:outline-2 focus-visible:outline-ring",
            value === o.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SortHeader({
  label,
  active,
  desc,
  onClick,
  align = "right",
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const Icon = desc ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      className={cn("px-2 py-1.5 font-medium", align === "right" ? "text-right" : "text-left")}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? <Icon className="size-3" aria-hidden /> : null}
      </button>
    </th>
  );
}

export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-primary hover:underline"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function FlagChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded border border-warning/40 bg-warning/15 px-1 py-px text-[10px] font-medium text-warning-foreground"
    >
      {children}
    </span>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={label}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-muted/50" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-md border border-border bg-muted/50" />
    </div>
  );
}

export function StateNote({
  tone = "muted",
  children,
  action,
}: {
  tone?: "muted" | "error";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-border px-4 py-4 text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
      {action}
    </div>
  );
}

export const tooltipStyle = { fontSize: 11, padding: "4px 8px" };
export const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };
