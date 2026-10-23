/**
 * The frame every chart sits in: a title that says what is counted, the unit and period, its states (loading, empty,
 * error, partial), a "Show data" table, "How to read this" notes and the source links. The chart inside never has to
 * repeat any of it.
 */
import { useId, useState, type ReactNode } from "react";
import { ExternalLink, RefreshCw, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { chartTokens } from "./palette";

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

export type ChartFrameProps = {
  /** What is counted, e.g. "Federal civil cases filed, by state". */
  title: string;
  /** Unit of the values ("cases", "deaths per 100,000 residents"). */
  unit?: string | undefined;
  /** Period shown ("2014–2024", "As of October 1, 2026"). */
  period?: string | undefined;
  sources: readonly ChartSource[];
  status: ChartStatus;
  /** Shown above the chart when part of the data could not be read or is incomplete. */
  partialNotice?: string | undefined;
  /** "How to read this": one short sentence each. */
  notes?: readonly string[] | undefined;
  /** Small print under the chart (partial periods, gaps, n). */
  footnotes?: readonly string[] | undefined;
  table?: TableSpec | undefined;
  /** Controls in the header (toggles, a select). */
  actions?: ReactNode;
  /** Data date the source states ("data through June 30, 2026"). */
  asOf?: string | undefined;
  headingLevel?: "h2" | "h3";
  id?: string | undefined;
  className?: string | undefined;
  /** Height reserved while loading, so the layout does not jump. */
  minHeight?: number | undefined;
  children?: ReactNode;
};

function DataTableView({ table, id }: { table: TableSpec; id: string }) {
  return (
    <div
      id={id}
      role="region"
      aria-label={`Data table: ${table.caption}`}
      tabIndex={0}
      className="max-h-72 overflow-auto border-t border-border/70 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <table className="w-full border-collapse text-[11px]">
        <caption className="sr-only">{table.caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border text-muted-foreground">
            {table.columns.map((c, i) => (
              <th
                key={`${c.label}-${i}`}
                scope="col"
                className={cn(
                  "px-3 py-1 font-medium",
                  c.align === "right" ? "text-right" : "text-left",
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
                      "px-3 py-0.5 text-left font-normal",
                      r.muted && "text-muted-foreground",
                    )}
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    key={i}
                    className={cn(
                      "px-3 py-0.5 tabular-nums",
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
            className="inline-flex items-center gap-0.5 rounded text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
            {s.url.startsWith("/") ? null : <ExternalLink className="size-3" aria-hidden />}
          </a>
        </span>
      ))}
    </span>
  );
}

export function ChartFrame({
  title,
  unit,
  period,
  sources,
  status,
  partialNotice,
  notes,
  footnotes,
  table,
  actions,
  asOf,
  headingLevel = "h3",
  id,
  className,
  minHeight = 200,
  children,
}: ChartFrameProps) {
  const [showData, setShowData] = useState(false);
  const autoId = useId();
  const frameId = id ?? `chart-${autoId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const tableId = `${frameId}-data`;
  const Heading = headingLevel;
  const meta = [unit ? capitalize(unit) : null, period].filter(Boolean).join(" · ");
  return (
    <section
      id={frameId}
      aria-labelledby={`${frameId}-title`}
      {...(status.kind === "loading" ? { "aria-busy": true } : {})}
      className={cn(
        "flex min-w-0 scroll-mt-4 flex-col rounded-md border border-border bg-surface",
        className,
      )}
      style={chartTokens}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <Heading id={`${frameId}-title`} className="text-sm font-semibold leading-5">
            {title}
          </Heading>
          {meta ? <p className="text-[11px] leading-4 text-muted-foreground">{meta}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {status.kind === "loading" ? (
        <div className="space-y-2 px-3 py-3" role="status" aria-label={`Loading ${title}`}>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="w-full" style={{ height: minHeight }} />
        </div>
      ) : status.kind === "error" ? (
        <div role="alert" className="space-y-2 px-3 py-4 text-xs">
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
        <p role="status" className="px-3 py-4 text-xs leading-5 text-muted-foreground">
          {status.reason}
        </p>
      ) : (
        <>
          {partialNotice ? (
            <p
              role="note"
              className="mx-3 mt-2 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] leading-4"
            >
              {partialNotice}
            </p>
          ) : null}
          <div className="min-w-0 px-3 pt-2">{children}</div>
          {footnotes?.length ? (
            <div className="space-y-0.5 px-3 pt-1 text-[11px] leading-4 text-muted-foreground">
              {footnotes.map((f) => (
                <p key={f}>{f}</p>
              ))}
            </div>
          ) : null}
          {table ? (
            <div className="px-3 pb-1 pt-1.5">
              <button
                type="button"
                aria-expanded={showData}
                aria-controls={tableId}
                onClick={() => setShowData((v) => !v)}
                className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Table2 className="size-3" aria-hidden />
                {showData ? "Hide data" : "Show data"}
              </button>
            </div>
          ) : null}
          {table && showData ? <DataTableView table={table} id={tableId} /> : null}
          {notes?.length ? (
            <details className="border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
              <summary className="cursor-pointer select-none text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                How to read this
              </summary>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <footer className="mt-auto border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        <p>
          <SourceLinks sources={sources} />
        </p>
        {period || asOf ? (
          <p>
            {period ? `Period: ${period}` : ""}
            {period && asOf ? " · " : ""}
            {asOf ? `data through ${asOf}` : ""}
          </p>
        ) : null}
      </footer>
    </section>
  );
}

/** Legend for two or more series: a short line (lines) or a swatch (bars, areas) beside each label. */
export function ChartLegend({
  items,
  mark = "line",
  className,
}: {
  items: readonly { id: string; label: string; color: string; dashed?: boolean | undefined }[];
  mark?: "line" | "swatch";
  className?: string | undefined;
}) {
  if (items.length < 2) return null;
  return (
    <ul
      aria-label="Legend"
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-0.5 pb-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-1.5">
          {mark === "line" ? (
            <svg width="14" height="6" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="14"
                y2="3"
                stroke={it.color}
                strokeWidth="2"
                strokeLinecap="round"
                {...(it.dashed ? { strokeDasharray: "3 2" } : {})}
              />
            </svg>
          ) : (
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 rounded-[2px]"
              style={{ background: it.color }}
            />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
