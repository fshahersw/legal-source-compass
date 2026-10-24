/**
 * ChartCard: the card every chart sits in.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Title = the takeaway, in plain words     [Chart|Table] … │
 *   │ Subtitle = measure · unit · geography · period           │
 *   ├──────────────┬──────────────┬────────────────────────────┤
 *   │ KPI strip (optional): 2–4 key figures with change pills  │
 *   ├──────────────┴──────────────┴────────────────────────────┤
 *   │ chart (or its data table)                                │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ Source · period · as of                  (i) About data  │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Method text, caveats and partial-period notes live in the "About this data" popover; numbers and the source stay
 * visible. States: loading (skeleton sized like the chart), error (with retry), empty (the reason), ready.
 * Layout adapted from the chart card pattern of the ReUI registry (github.com/keenthemes/reui, MIT).
 */
import { useId, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Download,
  ExternalLink,
  Info,
  LineChart,
  RefreshCw,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { chartTokens } from "./palette";
import { csvFileName, tableCsv } from "./tableCsv";

export type ChartSource = { label: string; url: string };

export type ChartStatus =
  | { kind: "loading" }
  | { kind: "error"; message?: string | undefined; onRetry?: (() => void) | undefined }
  | { kind: "empty"; reason: string }
  | { kind: "ready" };

export type TableColumn = { label: string; align?: "left" | "right" | undefined };
export type TableSpec = {
  caption: string;
  columns: TableColumn[];
  rows: { key: string; cells: ReactNode[]; muted?: boolean | undefined }[];
};

export type KpiItem = {
  label: string;
  value: ReactNode;
  /** Short qualifier under the value ("FY2025", "vs national 15.1%"). */
  detail?: ReactNode;
  /** Change pill; direction only (no good/bad colour: a rise is not good or bad by itself). */
  delta?: { text: string; direction: "up" | "down" | "flat" } | undefined;
};

export type ChartCardProps = {
  /** The takeaway in plain words, computed from the plotted values; a neutral description when none is reliable. */
  title: string;
  /** Measure, unit, geography and period ("Product liability filings · cases · FY2014–FY2025"). */
  subtitle?: ReactNode;
  kpis?: readonly KpiItem[] | undefined;
  status?: ChartStatus | undefined;
  /** Data table behind the chart: enables the Chart / Table toggle. */
  table?: TableSpec | undefined;
  sources?: readonly ChartSource[] | undefined;
  /** Period shown in the footer ("FY2014–FY2025"). */
  period?: string | undefined;
  /** Data date the source states. */
  asOf?: string | undefined;
  /** Replaces the default source line in the footer. */
  footer?: ReactNode;
  /** "About this data" popover: method, caveats, partial-period notes. */
  about?: ReactNode;
  /** Heading of the popover (default "About this data"). */
  aboutTitle?: string | undefined;
  /** Marks the chart as holding a partial period; the note goes into the popover. */
  partial?: string | undefined;
  /** Shown above the chart when part of the data could not be read. */
  notice?: ReactNode;
  /** Small print under the chart (asterisk notes that must stay visible). */
  footnotes?: readonly ReactNode[] | undefined;
  /** Controls in the header (a select, a segmented toggle). */
  actions?: ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
  id?: string | undefined;
  className?: string | undefined;
  /** Padding around the chart body (default true). */
  padded?: boolean | undefined;
  /** Height reserved while loading. */
  minHeight?: number | undefined;
  children?: ReactNode;
};

export function DataTableView({
  table,
  id,
  className,
}: {
  table: TableSpec;
  id?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      id={id}
      role="region"
      aria-label={`Data table: ${table.caption}`}
      tabIndex={0}
      className={cn(
        "max-h-80 overflow-auto rounded-md border border-border/70 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{table.caption}</caption>
        <thead className="sticky top-0 z-10 bg-muted">
          <tr className="border-b border-border text-muted-foreground">
            {table.columns.map((c, i) => (
              <th
                key={`${c.label}-${i}`}
                scope="col"
                className={cn(
                  "px-3 py-1.5 font-medium",
                  c.align === "right" || (i > 0 && c.align !== "left") ? "text-right" : "text-left",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.key} className="border-b border-border/50 last:border-0">
              {r.cells.map((cell, i) =>
                i === 0 ? (
                  <th
                    key={i}
                    scope="row"
                    className={cn(
                      "px-3 py-1 text-left font-normal",
                      r.muted && "text-muted-foreground",
                    )}
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    key={i}
                    className={cn(
                      "px-3 py-1 tabular-nums",
                      table.columns[i]?.align === "left" ? "text-left" : "text-right",
                      (cell === "Not recorded" || r.muted) && "text-muted-foreground",
                    )}
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourceLinks({ sources }: { sources: readonly ChartSource[] }) {
  if (!sources.length) return <span>Source: Not recorded</span>;
  return (
    <span>
      {sources.length === 1 ? "Source: " : "Sources: "}
      {sources.map((s, i) => (
        <span key={`${s.url}-${i}`}>
          {i > 0 ? "; " : ""}
          <a
            href={s.url}
            target={s.url.startsWith("/") ? undefined : "_blank"}
            rel={s.url.startsWith("/") ? undefined : "noreferrer"}
            className="rounded text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
            {s.url.startsWith("/") ? null : (
              <ExternalLink className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />
            )}
          </a>
        </span>
      ))}
    </span>
  );
}

/** Change pill: arrow + text on a neutral tint. Direction only; colour never implies good or bad. */
export function DeltaPill({
  text,
  direction,
  className,
}: {
  text: string;
  direction: "up" | "down" | "flat";
  className?: string | undefined;
}) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : ArrowRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-muted px-1.5 py-px text-[11px] font-medium leading-4 text-foreground tabular-nums",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {text}
    </span>
  );
}

/** Row of key figures inside a chart card. */
export function KpiStrip({ items, className }: { items: readonly KpiItem[]; className?: string }) {
  if (!items.length) return null;
  const cols =
    items.length >= 4
      ? "grid-cols-2 lg:grid-cols-4"
      : items.length === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : items.length === 2
          ? "grid-cols-2"
          : "grid-cols-1";
  return (
    <dl
      className={cn(
        "grid border-y border-border/70 [&>div+div]:border-l [&>div]:border-border/70",
        cols,
        className,
      )}
    >
      {items.map((k) => (
        <div key={k.label} className="min-w-0 px-4 py-2.5">
          <dt className="truncate text-xs leading-4 text-muted-foreground" title={k.label}>
            {k.label}
          </dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xl font-semibold leading-7 text-foreground">{k.value}</span>
            {k.delta ? <DeltaPill text={k.delta.text} direction={k.delta.direction} /> : null}
          </dd>
          {k.detail ? (
            <dd className="text-xs leading-4 text-muted-foreground">{k.detail}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/** Info button with the "About this data" popover. Keyboard reachable; the content is plain text and links. */
export function AboutData({
  title = "About this data",
  children,
  label,
}: {
  title?: string | undefined;
  children: ReactNode;
  /** Visible trigger text (default "About this data"). */
  label?: string | undefined;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Info className="size-3.5" aria-hidden />
          {label ?? "About this data"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3 text-xs leading-5">
        <p className="mb-1 text-sm font-semibold text-foreground">{title}</p>
        <div className="space-y-1.5 text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-4">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ViewToggle({
  view,
  onChange,
  controls,
}: {
  view: "chart" | "table";
  onChange: (v: "chart" | "table") => void;
  controls: string;
}) {
  const btn = (v: "chart" | "table", label: string, Icon: typeof Table2) => (
    <button
      type="button"
      aria-pressed={view === v}
      aria-controls={controls}
      aria-label={`${label} view`}
      title={`${label} view`}
      onClick={() => onChange(v)}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-xs focus-visible:outline-2 focus-visible:outline-ring",
        view === v
          ? "bg-surface text-foreground shadow-xs ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {btn("chart", "Chart", LineChart)}
      {btn("table", "Table", Table2)}
    </div>
  );
}

function downloadCsv(table: TableSpec) {
  const blob = new Blob([tableCsv(table)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFileName(table.caption);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChartCard({
  title,
  subtitle,
  kpis,
  status = { kind: "ready" },
  table,
  sources,
  period,
  asOf,
  footer,
  about,
  aboutTitle,
  partial,
  notice,
  footnotes,
  actions,
  headingLevel = "h3",
  id,
  className,
  padded = true,
  minHeight = 200,
  children,
}: ChartCardProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const autoId = useId();
  const cardId = id ?? `chart-${autoId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const bodyId = `${cardId}-body`;
  const Heading = headingLevel;
  const ready = status.kind === "ready";
  const sourceLine =
    footer ??
    (sources ? (
      <p className="min-w-0">
        <SourceLinks sources={sources} />
        {period ? <span> · {period}</span> : null}
        {asOf ? <span> · data through {asOf}</span> : null}
      </p>
    ) : period || asOf ? (
      <p>
        {period ?? ""}
        {period && asOf ? " · " : ""}
        {asOf ? `data through ${asOf}` : ""}
      </p>
    ) : null);
  const aboutBody =
    about || partial ? (
      <>
        {partial ? <p>{partial}</p> : null}
        {about}
      </>
    ) : null;
  return (
    <section
      id={cardId}
      aria-labelledby={`${cardId}-title`}
      {...(status.kind === "loading" ? { "aria-busy": true } : {})}
      className={cn(
        "flex min-w-0 scroll-mt-4 flex-col rounded-xl border border-border bg-surface",
        className,
      )}
      style={chartTokens}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1 basis-60">
          <Heading
            id={`${cardId}-title`}
            className="text-sm font-semibold leading-5 tracking-normal text-foreground"
          >
            {title}
          </Heading>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions || partial || (table && ready) ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {partial ? (
              <span className="rounded-full bg-muted px-2 py-px text-[11px] font-medium leading-4 text-muted-foreground">
                Partial period
              </span>
            ) : null}
            {actions}
            {table && ready ? (
              <ViewToggle view={view} onChange={setView} controls={bodyId} />
            ) : null}
          </div>
        ) : null}
      </header>
      {kpis?.length && ready ? <KpiStrip items={kpis} /> : null}
      {status.kind === "loading" ? (
        <div className="space-y-2 px-4 pb-4 pt-2" role="status" aria-label={`Loading ${title}`}>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="w-full" style={{ height: minHeight }} />
        </div>
      ) : status.kind === "error" ? (
        <div role="alert" className="space-y-2 px-4 pb-4 pt-2 text-xs">
          <p className="text-destructive">
            {status.message ??
              "This chart could not be read just now. Other charts are unaffected."}
          </p>
          {status.onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={status.onRetry}>
              <RefreshCw className="size-3" aria-hidden />
              Retry
            </Button>
          ) : null}
        </div>
      ) : status.kind === "empty" ? (
        <p role="status" className="px-4 pb-4 pt-2 text-xs leading-5 text-muted-foreground">
          {status.reason}
        </p>
      ) : (
        <>
          {notice ? (
            <div
              role="note"
              className="mx-4 mt-1 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs leading-4 text-foreground ring-1 ring-warning/40"
            >
              {notice}
            </div>
          ) : null}
          <div id={bodyId} className={cn("min-w-0", padded ? "px-4 pb-3 pt-2" : "")}>
            {table && view === "table" ? (
              <div className="space-y-1.5">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => downloadCsv(table)}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Download className="size-3.5" aria-hidden />
                    Download CSV
                  </button>
                </div>
                <DataTableView table={table} />
              </div>
            ) : (
              children
            )}
          </div>
          {footnotes?.length ? (
            <div className="space-y-0.5 px-4 pb-2 text-[11px] leading-4 text-muted-foreground">
              {footnotes.map((f, i) => (
                <p key={i}>{f}</p>
              ))}
            </div>
          ) : null}
        </>
      )}
      {sourceLine || aboutBody ? (
        <footer className="mt-auto flex items-start justify-between gap-3 border-t border-border/70 px-4 py-2 text-xs leading-5 text-muted-foreground">
          <div className="min-w-0">{sourceLine}</div>
          {aboutBody ? <AboutData title={aboutTitle}>{aboutBody}</AboutData> : null}
        </footer>
      ) : null}
    </section>
  );
}
