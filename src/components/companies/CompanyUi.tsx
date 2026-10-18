import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { FlagKey, Role, Tier } from "./companyData";
import { ROLE_LABEL, ROLE_SHORT, TIER_LABEL, TIER_SHORT } from "./companyData";
import { kpiTooltip } from "./companyViewNotes";

/** KPI tile. Label, note and detail wrap to two lines; the tooltip carries every line in full. */
export function Kpi({
  label,
  value,
  note,
  detail,
  title,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  detail?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <div
      className="min-w-0 rounded-md border border-border bg-surface px-3 py-2.5"
      title={kpiTooltip({ label, value, note, detail, title })}
    >
      <div className="line-clamp-2 break-words text-xs leading-4 text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate font-sans text-xl font-semibold tabular-nums">{value}</div>
      {note ? (
        <div className="line-clamp-2 break-words text-xs leading-4 text-muted-foreground">
          {note}
        </div>
      ) : null}
      {detail ? (
        <div className="line-clamp-2 break-words text-[11px] italic leading-4 text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export type LegendItem = {
  label: string;
  color: string;
  shape?: "circle" | "square" | undefined;
  /** Fill opacity of the marks this item labels (e.g. 0.35 for translucent reference marks). */
  opacity?: number | undefined;
  /** Optional explanation shown on hover. */
  title?: string | undefined;
};

/**
 * Chart legend drawn outside the chart so its text stays readable even when the marks are
 * translucent (reference points, search-only bars). A translucent item's swatch uses the marks'
 * own opacity inside a border outline, so it looks like the marks it labels and stays visible.
 */
export function SwatchLegend({
  items,
  className,
}: {
  items: LegendItem[];
  className?: string | undefined;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-2 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {items.map((i) => {
        const translucent = i.opacity != null && i.opacity < 1;
        return (
          <li key={i.label} className="inline-flex items-center gap-1.5" title={i.title}>
            <span
              aria-hidden
              className={cn(
                "relative size-2.5 shrink-0 overflow-hidden",
                i.shape === "square" ? "rounded-sm" : "rounded-full",
                translucent && "ring-1 ring-border",
              )}
            >
              <span
                className="absolute inset-0"
                style={{ background: i.color, opacity: translucent ? i.opacity : undefined }}
              />
            </span>
            <span className="text-foreground">{i.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Notice({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-6 text-sm",
        tone === "error"
          ? "border-destructive/40 text-destructive"
          : "border-border text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function LoadingBlocks({ label, tiles = 6 }: { label: string; tiles?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: tiles }, (_, i) => (
          <div
            key={i}
            className="h-[70px] animate-pulse rounded-md border border-border bg-muted/50"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-md border border-border bg-muted/50" />
      <div className="h-96 animate-pulse rounded-md border border-border bg-muted/50" />
    </div>
  );
}

const TIER_STYLE: Record<Tier, string> = {
  A: "border-primary/30 bg-primary/10 text-primary",
  B: "border-border bg-muted text-foreground",
  C: "border-warning/40 bg-warning/15 text-warning-foreground",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      title={TIER_LABEL[tier]}
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[11px] font-medium",
        TIER_STYLE[tier],
      )}
    >
      {tier} · {TIER_SHORT[tier]}
    </span>
  );
}

export function RoleText({ role }: { role: Role }) {
  return (
    <span
      title={`${ROLE_LABEL[role]}. Deterministic phrase reading of the evidence excerpt; requires review.`}
      className={cn(
        "text-[11px]",
        role === "defendant" ? "text-foreground" : "text-muted-foreground",
        (role === "not_named" || role === "plaintiff") && "italic",
      )}
    >
      {ROLE_SHORT[role]}
    </span>
  );
}

export function FlagBadge({
  label,
  rule,
}: {
  flag: FlagKey;
  label: string;
  rule?: string | undefined;
}) {
  return (
    <span
      title={rule}
      className="inline-flex shrink-0 items-center rounded border border-destructive/30 bg-destructive/10 px-1.5 py-px text-[11px] font-medium text-destructive"
    >
      {label}
    </span>
  );
}

/** Tiny inline SVG trend line (no axes). Points must be in time order. */
export function Spark({
  values,
  color = "var(--primary)",
  width = 64,
  height = 18,
  label,
}: {
  values: number[];
  color?: string | undefined;
  width?: number;
  height?: number;
  label?: string | undefined;
}) {
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * (height - 2) - 1).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SourceLine({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-5 text-muted-foreground">{children}</p>;
}
