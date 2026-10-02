import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/corpus/BarList";
import { summarizeCases, type ResearchData } from "@/lib/corpus/research";
import type { CatalogMatter } from "@/lib/atlas/catalogMatters";

export type ResearchView = "states" | "judges" | "cases" | "citations" | "sources";
export type ResearchSearch = {
  view?: ResearchView | undefined;
  state?: string | undefined;
  judge?: string | undefined;
  docket?: number | undefined;
  mdl?: string | undefined;
  q?: string | undefined;
};
export type WorkbenchProps = {
  data: ResearchData;
  cases: CatalogMatter[];
  masters: Record<string, string>;
  state: string;
  search: ResearchSearch;
  update: (value: Partial<ResearchSearch>) => void;
};
export const control =
  "h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[12px]";
export const tableClass =
  "w-full text-left text-[12px] [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_td]:px-3 [&_td]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-border";
export const fmt = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "Not recorded"
    : value.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
export const pct = (value: number | null | undefined) =>
  value == null ? "Not recorded" : `${fmt(value, 1)}%`;
export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-card">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {note && (
        <p className="mb-3 mt-1 text-[12px] leading-relaxed text-muted-foreground">{note}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  );
}
export function Pagination({
  page,
  count,
  size = 20,
  returned,
  hasNext,
  onPage,
}: {
  page: number;
  count: number | null;
  size?: number;
  returned?: number;
  hasNext?: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span>
        {count === null
          ? returned
            ? `${fmt(page * size + 1)}–${fmt(page * size + returned)} · total not recorded`
            : "No matching records"
          : count
            ? `${fmt(page * size + 1)}–${fmt(Math.min(count, (page + 1) * size))} of ${fmt(count)}`
            : "No matching records"}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={count === null ? !hasNext : (page + 1) * size >= count}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function CaseStats({ rows }: { rows: CatalogMatter[] }) {
  const summary = summarizeCases(rows);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="Cases in this selection"
          value={summary.total}
          note={`${summary.other} other / unrecorded status`}
        />
        <Stat
          label="Active / terminated"
          value={`${fmt(summary.active)} / ${fmt(summary.terminated)}`}
        />
        <Stat
          label="Median filed → terminated"
          value={summary.medianDays == null ? "Not recorded" : `${fmt(summary.medianDays)} days`}
          note={`${fmt(summary.datedTerminations)} valid, recorded durations`}
        />
        <Stat
          label="Middle 50% of durations"
          value={
            summary.p25 == null ? "Not recorded" : `${fmt(summary.p25)}–${fmt(summary.p75)} days`
          }
          note={`${fmt(summary.excludedTerminations)} terminations lack usable dates`}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Saved catalog only. Active cases are excluded from completed durations; termination does not
        establish a verdict, settlement, or party success.
      </p>
    </div>
  );
}
