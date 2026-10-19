import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { Panel, StateNote } from "@/components/enforcement/parts";
import { RetryNote, TableScroll } from "@/components/courts/caseload/CaseloadParts";
import { longDate } from "@/components/courts/caseload/caseloadFormat";
import { useJumpWhenShown } from "@/components/courts/caseload/useJumpWhenShown";
import type { ClbNote } from "@/lib/external/clbCollection.functions";
import { cn } from "@/lib/utils";
import { int, NOT_RECORDED, pct } from "./collectionFormat";
import { patchSearch, type CollectionSearch } from "./collectionSearch";

export type TabProps = {
  search: CollectionSearch;
  onSearch: (patch: Partial<CollectionSearch>) => void;
};

/** A quiet strip for the statement that goes with every figure (what is counted, and what is not). */
export function Callout({
  children,
  tone = "muted",
  id,
}: {
  children: ReactNode;
  tone?: "muted" | "warning";
  id?: string | undefined;
}) {
  return (
    <div
      id={id}
      role="note"
      className={cn(
        "scroll-mt-4 rounded-md border px-3 py-2 text-xs leading-5 focus:outline-none",
        tone === "warning"
          ? "border-warning/40 bg-warning/10 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** A number, or Not recorded. */
export function NumText({ v }: { v: number | null | undefined }) {
  return v == null ? (
    <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
  ) : (
    <>{int(v)}</>
  );
}

/** A percentage, or Not recorded. */
export function PctText({ v, digits = 1 }: { v: number | null | undefined; digits?: number }) {
  return v == null ? (
    <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
  ) : (
    <>{pct(v, digits)}</>
  );
}

/** Text, or Not recorded. */
export function MaybeText({ v }: { v: string | null | undefined }) {
  return v ? <>{v}</> : <span className="text-muted-foreground">{NOT_RECORDED}</span>;
}

/** A court name, linked to its page only when the record's own link names exactly this court. */
export function CourtLink({
  courtId,
  href,
  children,
  className,
}: {
  courtId: string;
  href: string | null;
  children: ReactNode;
  className?: string | undefined;
}) {
  if (href !== `/courts/${courtId}`) return <span className={className}>{children}</span>;
  return (
    <Link
      to="/courts/$id"
      params={{ id: courtId }}
      className={cn("text-primary hover:underline", className)}
    >
      {children}
    </Link>
  );
}

/** A share bar inside a table cell: the number stays the primary reading, the bar is only a scale. */
export function CellBar({
  value,
  max,
  label,
}: {
  value: number | null;
  max: number;
  label: ReactNode;
}) {
  const w =
    value == null || !(max > 0) || value <= 0 ? 0 : Math.max(1, Math.min(100, (100 * value) / max));
  return (
    <div className="min-w-16">
      <div className="text-right font-mono">{label}</div>
      <span className="mt-0.5 block h-1 rounded-sm bg-muted" aria-hidden>
        <span className="block h-1 rounded-sm bg-primary/60" style={{ width: `${w}%` }} />
      </span>
    </div>
  );
}

export type Col<T> = {
  key: string;
  label: ReactNode;
  /** Tooltip naming the denominator or the definition. */
  title?: string;
  align?: "left" | "right";
  /** Set when the column sorts; clicking the header calls onSort with this key. */
  sortKey?: string;
  render: (row: T) => ReactNode;
  /** Hide below this breakpoint to keep the table inside a narrow panel. */
  hideBelow?: "lg" | "xl";
};

const HIDE = { lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" } as const;

/**
 * A sortable table inside a keyboard-scrollable region. Rows are shown a page at a time; the selected or expanded row
 * is always shown. Sorting is done by the caller, so the order here is the order given.
 */
export function DataTable<T>({
  label,
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  selectedKey,
  expanded,
  minWidth = "min-w-[44rem]",
  pageSize = 100,
  resetKey = "",
  maxHeight,
  noun = "rows",
}: {
  label: string;
  caption: string;
  columns: readonly Col<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  sort?: { key: string; desc: boolean } | undefined;
  onSort?: ((key: string) => void) | undefined;
  selectedKey?: string | undefined;
  /** Renders a detail row directly under the row with this key. */
  expanded?: { key: string | undefined; render: (row: T) => ReactNode } | undefined;
  minWidth?: string;
  pageSize?: number;
  /** Changes when the filters change, so a long list starts from its first page again. */
  resetKey?: string;
  maxHeight?: string | undefined;
  noun?: string;
}) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [resetKey, pageSize]);
  const keyAt = selectedKey ?? expanded?.key;
  const at = keyAt ? rows.findIndex((r) => rowKey(r) === keyAt) : -1;
  const shown = Math.min(rows.length, Math.max(limit, at + 1));
  const visible = rows.slice(0, shown);
  return (
    <div>
      <TableScroll label={label} maxHeight={maxHeight ?? "max-h-[26rem]"}>
        <table className={cn("w-full text-xs", minWidth)}>
          <caption className="sr-only">{caption}</caption>
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              {columns.map((c) => {
                const hide = c.hideBelow ? HIDE[c.hideBelow] : undefined;
                return (
                  <HeadCell
                    key={c.key}
                    col={c}
                    hide={hide}
                    sort={c.sortKey && onSort && sort ? sort : undefined}
                    onSort={c.sortKey && onSort ? () => onSort(c.sortKey!) : undefined}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {visible.map((row) => {
              const k = rowKey(row);
              const selected = k === selectedKey || k === expanded?.key;
              return (
                <RowGroup
                  key={k}
                  row={row}
                  columns={columns}
                  selected={selected}
                  detail={expanded && k === expanded.key ? expanded.render(row) : null}
                />
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      {rows.length > shown ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span role="status">
            Showing {int(shown)} of {int(rows.length)} {noun}
          </span>
          <button
            type="button"
            onClick={() => setLimit((n) => n + pageSize)}
            className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Show {int(Math.min(pageSize, rows.length - shown))} more
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A column header; sortable when the column has a sort key, with the direction announced to assistive technology. */
function HeadCell<T>({
  col,
  hide,
  sort,
  onSort,
}: {
  col: Col<T>;
  hide: string | undefined;
  sort: { key: string; desc: boolean } | undefined;
  onSort: (() => void) | undefined;
}) {
  const active = Boolean(sort && col.sortKey === sort.key);
  return (
    <th
      scope="col"
      title={col.title}
      aria-sort={
        sort && col.sortKey
          ? active
            ? sort.desc
              ? "descending"
              : "ascending"
            : "none"
          : undefined
      }
      className={cn(
        "sticky top-0 z-10 bg-surface px-1.5 py-1.5 font-medium shadow-[inset_0_-1px_0_var(--border)]",
        col.align === "right" ? "text-right" : "text-left",
        hide,
      )}
    >
      {onSort && sort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "inline-flex items-center gap-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            active && "text-foreground",
          )}
        >
          {col.label}
          {active ? (
            sort.desc ? (
              <ArrowDown className="size-3" aria-hidden />
            ) : (
              <ArrowUp className="size-3" aria-hidden />
            )
          ) : null}
        </button>
      ) : (
        col.label
      )}
    </th>
  );
}

function RowGroup<T>({
  row,
  columns,
  selected,
  detail,
}: {
  row: T;
  columns: readonly Col<T>[];
  selected: boolean;
  detail: ReactNode;
}) {
  return (
    <>
      <tr className={selected ? "bg-muted/60" : undefined}>
        {columns.map((c) => (
          <td
            key={c.key}
            className={cn(
              "px-1.5 py-1 align-top",
              c.align === "right" && "text-right font-mono",
              c.hideBelow ? HIDE[c.hideBelow] : undefined,
            )}
          >
            {c.render(row)}
          </td>
        ))}
      </tr>
      {detail ? (
        <tr>
          <td colSpan={columns.length} className="bg-muted/20 p-0">
            {detail}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function PanelSkeleton({ label, height = "h-40" }: { label: string; height?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md border border-border bg-muted/50", height)}
      aria-busy="true"
      aria-label={label}
    />
  );
}

/**
 * Loading, error (with retry) and empty states around one query, so a failure in one panel never blanks its neighbours.
 */
export function QueryPanel<T>({
  query,
  label,
  errorText,
  emptyText,
  isEmpty,
  skeleton,
  children,
}: {
  query: UseQueryResult<T>;
  label: string;
  errorText: string;
  emptyText: string;
  isEmpty?: (data: NonNullable<T>) => boolean;
  skeleton?: ReactNode;
  children: (data: NonNullable<T>) => ReactNode;
}) {
  if (query.isLoading) return <>{skeleton ?? <PanelSkeleton label={label} />}</>;
  if (query.isError) return <RetryNote onRetry={() => void query.refetch()}>{errorText}</RetryNote>;
  const data = query.data;
  if (data == null || (isEmpty && isEmpty(data as NonNullable<T>)))
    return <StateNote>{emptyText}</StateNote>;
  return <>{children(data as NonNullable<T>)}</>;
}

/** The dataset's own definitions and caveats, with its snapshot and source, as a collapsed reference. */
export function NoteReference({
  note,
  title,
  measures = [],
}: {
  note: ClbNote | null | undefined;
  title: string;
  /** Page-specific definitions placed ahead of the dataset's own. */
  measures?: readonly Measure[];
}) {
  const own: Measure[] = (note?.definitions ?? []).map((d) => ({ term: d.term, means: d.text }));
  const snapshot = longDate(note?.snapshot);
  return (
    <HowToRead
      title={title}
      measures={[...measures, ...own]}
      notes={
        note ? (
          <div className="space-y-1">
            {note.caveats.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {note.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
            <p>
              {note.source ? `Source: ${note.source}. ` : ""}
              {snapshot ? `Snapshot of the bulk files: ${snapshot}. ` : ""}
              {note.terms ?? ""}
            </p>
          </div>
        ) : null
      }
    />
  );
}

/**
 * The drill-down under a table: a hint until a row is selected, then the row's detail with a clear button. Opening a
 * row scrolls to the panel and moves focus there once its content has loaded.
 */
export function DrillPanel({
  id,
  title,
  hint,
  selected,
  ready = true,
  subtitle,
  onClear,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  selected: string | undefined;
  ready?: boolean;
  subtitle?: ReactNode;
  onClear: () => void;
  children: ReactNode;
}) {
  useJumpWhenShown(selected, ready, id);
  if (!selected)
    return (
      <Panel id={id} title={title}>
        <StateNote>{hint}</StateNote>
      </Panel>
    );
  return (
    <Panel
      id={id}
      title={title}
      subtitle={subtitle}
      actions={
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-3" aria-hidden />
          Close
        </button>
      }
    >
      {children}
    </Panel>
  );
}

/** The KPI grid; `cols` is the number of columns from the large breakpoint. */
export function KpiGrid({
  id,
  label,
  cols = 5,
  children,
}: {
  id: string;
  label: string;
  cols?: 4 | 5;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={cn(
        "grid scroll-mt-4 grid-cols-2 gap-2 focus:outline-none sm:grid-cols-3",
        cols === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
      )}
    >
      {children}
    </section>
  );
}

export function KpiSkeleton({ n = 5 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-muted/50" />
      ))}
    </div>
  );
}

/** A table row's select link: it keeps the rest of the address and sets the selected row. */
export function SelectLink({
  search,
  patch,
  selected,
  children,
  title,
}: {
  search: CollectionSearch;
  patch: Partial<CollectionSearch>;
  selected: boolean;
  children: ReactNode;
  title?: string | undefined;
}) {
  return (
    <Link
      to="/courts/collection"
      search={patchSearch(search, patch)}
      resetScroll={false}
      title={title}
      aria-current={selected ? "true" : undefined}
      className={cn("hover:underline", selected ? "font-semibold text-foreground" : "text-primary")}
    >
      {children}
    </Link>
  );
}
