/**
 * DataDrawer: where lists, long tables and per-record values live, off the primary surface. A "View data" button opens
 * a side sheet (or, with mode="inline", a panel below) holding the table, an optional search, the source line and a
 * CSV download of every row. Missing values print as "Not recorded" and stay empty in the CSV.
 *
 *   <DataDrawer title="Federal civil filings per 100,000, by state" rows={rows} rowKey={(r) => r.id}
 *     columns={[
 *       { key: "state", label: "State", value: (r) => r.name, render: (r) => <Link …>{r.name}</Link> },
 *       { key: "value", label: "Per 100,000", align: "right", value: (r) => r.value },
 *     ]}
 *     source={{ source: { label: "FJC Integrated Database", href }, period: "FY2025" }} searchable />
 *
 *   <DataDrawer … trigger={<Button variant="outline" size="sm">See all 51</Button>} />   // custom trigger
 */
import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Download, Search, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SourceFooter, type SourceFooterProps } from "./Card";
import { csvFileName, toCsv, type CsvValue } from "./csv";

export type DataColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right" | undefined;
  /** Raw value for the CSV and the search; numbers stay numbers, null is a gap. */
  value: (row: T) => CsvValue;
  /** Cell content; defaults to the value ("Not recorded" when missing). */
  render?: ((row: T) => ReactNode) | undefined;
};

export type DataDrawerProps<T> = {
  title: string;
  description?: ReactNode | undefined;
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  source?: SourceFooterProps | undefined;
  /** CSV file name; defaults to the title. */
  filename?: string | undefined;
  mode?: "sheet" | "inline" | undefined;
  triggerLabel?: string | undefined;
  /** A custom trigger element (sheet mode), e.g. "See all 51". */
  trigger?: ReactNode | undefined;
  searchable?: boolean | undefined;
  searchLabel?: string | undefined;
  emptyText?: ReactNode | undefined;
  className?: string | undefined;
};

function cellText(v: CsvValue): ReactNode {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)))
    return <span className="text-muted-foreground">Not recorded</span>;
  return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

function downloadCsv(name: string, text: string) {
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DataTable<T>({
  title,
  columns,
  rows,
  rowKey,
  searchable,
  searchLabel,
  emptyText,
  scrollClassName,
}: Pick<DataDrawerProps<T>, "title" | "columns" | "rows" | "rowKey" | "emptyText"> & {
  searchable: boolean;
  searchLabel: string;
  scrollClassName: string;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      columns.some((c) => {
        const v = c.value(r);
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, query]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {searchable ? (
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={searchLabel}
              placeholder="Filter rows"
              className="h-8 pl-8 text-[13px] md:h-8"
            />
          </div>
        ) : null}
        <p className="m-0 text-meta tabular-nums text-muted-foreground" role="status">
          {query.trim()
            ? `${shown.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows match`
            : `${rows.length.toLocaleString("en-US")} rows`}
        </p>
      </div>
      <div className={cn("min-h-0 overflow-auto rounded-lg border border-border", scrollClassName)}>
        <table className="w-full text-[13px]">
          <caption className="sr-only">{title}</caption>
          <thead className="sticky top-0 z-[1] bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "h-9 px-3 font-medium whitespace-nowrap",
                    c.align === "right" && "text-right",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-t border-border/70 hover:bg-muted/40">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn("px-3 py-1.5", c.align === "right" && "text-right tabular-nums")}
                  >
                    {c.render ? c.render(r) : cellText(c.value(r))}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  {rows.length ? "No row matches the filter." : (emptyText ?? "Not recorded")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DataDrawer<T>({
  title,
  description,
  columns,
  rows,
  rowKey,
  source,
  filename,
  mode = "sheet",
  triggerLabel = "View data",
  trigger,
  searchable = false,
  searchLabel = "Filter rows",
  emptyText,
  className,
}: DataDrawerProps<T>) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const download = () =>
    downloadCsv(
      csvFileName(filename ?? title),
      toCsv(
        columns.map((c) => c.label),
        rows.map((r) => columns.map((c) => c.value(r))),
      ),
    );
  const footer = (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
      {source ? (
        <SourceFooter {...source} className="min-w-0 flex-1" />
      ) : (
        <span className="flex-1" />
      )}
      <Button variant="outline" size="sm" onClick={download} disabled={!rows.length}>
        <Download />
        Download CSV
      </Button>
    </div>
  );
  const table = (scroll: string) => (
    <DataTable
      title={title}
      columns={columns}
      rows={rows}
      rowKey={rowKey}
      searchable={searchable}
      searchLabel={searchLabel}
      emptyText={emptyText}
      scrollClassName={scroll}
    />
  );
  if (mode === "inline")
    return (
      <div className={cn("min-w-0", className)}>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="-ml-2 text-muted-foreground hover:text-foreground"
        >
          <Table2 />
          {open ? "Hide data" : triggerLabel}
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
        <div id={panelId} hidden={!open} className="mt-2 space-y-3">
          {open ? (
            <>
              {table("max-h-96")}
              {footer}
            </>
          ) : null}
        </div>
      </div>
    );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className={className}>
            <Table2 />
            {triggerLabel}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 p-5 sm:max-w-[min(44rem,100vw)]"
      >
        <div className="pr-8">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className={cn("mt-1 text-[13px]", !description && "sr-only")}>
            {description ?? "The values behind this view, with their source and a download."}
          </SheetDescription>
        </div>
        {open ? table("flex-1") : null}
        {footer}
      </SheetContent>
    </Sheet>
  );
}
