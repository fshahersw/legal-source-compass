/**
 * Company dossier panels fed by the self-updating investor-relations sources:
 *   MarketValue  the public float and shares outstanding the registrant states on its 10-K cover page (SEC dei facts)
 *   IrFigures    segment, product, region, operating and guidance figures printed in the documents on the company's
 *                own IR site, each with the line it was read from and whether that number is in the document text
 * Every figure is shown as the company printed it; nothing is converted or added up.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ChartFrame, RankedBars, type ChartSource, type TableSpec } from "@/components/charts";
import { cn } from "@/lib/utils";
import { queryStatus } from "@/components/console/ConsoleGrid";
import { companyCoverFactsQuery, companyIrFiguresQuery } from "./companyQueries";
import { money, NOT_RECORDED } from "./companyData";
import {
  chartSlice,
  GROUP_LABEL,
  groupsPresent,
  irFigureRows,
  printed,
  type IrFigure,
  type IrFigureRow,
} from "./companyIr";

const SEC_DEI: ChartSource = {
  label: "SEC XBRL company concepts (dei)",
  url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
};

const monthYear = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const yearsBefore = (date: string, now = new Date()) =>
  (now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / (365.25 * 24 * 3600 * 1000);

export function MarketValue({ cik }: { cik: string }) {
  const q = useQuery(companyCoverFactsQuery(cik));
  const facts = q.data ?? null;
  const float = facts?.publicFloat ?? [];
  const shares = facts?.sharesOutstanding ?? [];
  const latest = float[0] ?? null;
  const latestShares = shares[0] ?? null;
  const stale = latest ? yearsBefore(latest.end) > 2 : false;
  const status = queryStatus(
    q,
    !!facts && (float.length > 0 || shares.length > 0),
    "The company's 10-K cover-page facts are not loaded yet; they are read on a rotating daily schedule.",
  );
  const table: TableSpec = {
    caption: "Public float and shares outstanding as stated on the SEC cover page",
    columns: [
      { label: "Fact", align: "left" },
      { label: "As of", align: "left" },
      { label: "Form", align: "left" },
      { label: "Value" },
    ],
    rows: [
      ...float.map((f) => ({
        key: `pf-${f.end}`,
        cells: ["Public float", f.end, f.form || NOT_RECORDED, money(f.value, "USD")],
      })),
      ...shares.map((f) => ({
        key: `so-${f.end}`,
        cells: [
          "Shares outstanding",
          f.end,
          f.form || NOT_RECORDED,
          f.value.toLocaleString("en-US"),
        ],
      })),
    ],
  };
  return (
    <ChartFrame
      title="Market value on the 10-K cover"
      subtitle="Public float: market value of shares held by non-affiliates, on the date the company states"
      sources={[SEC_DEI]}
      status={status}
      table={table}
      notes={[
        "Public float is what the filer reports on its annual report cover. It is not a market capitalisation and is not updated between annual reports.",
        "Shares outstanding is the count on the cover page date, which is usually a few weeks after the fiscal year ends.",
      ]}
      minHeight={180}
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Figure
            label="Public float"
            value={latest ? money(latest.value, "USD") : null}
            meta={latest ? `${monthYear(latest.end)} · ${latest.form || "10-K"}` : undefined}
          />
          <Figure
            label="Shares outstanding"
            value={latestShares ? compactCount(latestShares.value) : null}
            meta={latestShares ? monthYear(latestShares.end) : undefined}
          />
        </div>
        {stale && latest ? (
          <p className="m-0 rounded-md border border-border bg-muted/50 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
            The latest public float filed is from {monthYear(latest.end)}. The registrant may have
            stopped filing annual reports (merger or delisting).
          </p>
        ) : null}
        {float.length > 1 ? (
          <ol className="m-0 grid list-none gap-1 p-0" aria-label="Public float by cover-page date">
            {float.slice(0, 5).map((f) => (
              <li key={f.end} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2">
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {monthYear(f.end)}
                </span>
                <span aria-hidden className="block h-1.5 rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-brand"
                    style={{
                      width: `${Math.max(2, (f.value / Math.max(...float.map((x) => x.value))) * 100)}%`,
                    }}
                  />
                </span>
                <span className="text-[12px] font-medium tabular-nums text-foreground">
                  {money(f.value, "USD")}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </ChartFrame>
  );
}

function compactCount(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString("en-US");
}

function Figure({
  label,
  value,
  meta,
}: {
  label: string;
  value: string | null;
  meta?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <p className="m-0 text-meta text-muted-foreground">{label}</p>
      <p className="m-0 text-kpi-sm tabular-nums text-foreground">
        {value ?? (
          <span className="text-[13px] font-medium text-muted-foreground">{NOT_RECORDED}</span>
        )}
      </p>
      {meta ? <p className="m-0 text-[11.5px] text-muted-foreground">{meta}</p> : null}
    </div>
  );
}

function CheckBadge({ check }: { check: IrFigure["check"] }) {
  return (
    <span
      title={
        check === "text"
          ? "The number appears in the document text"
          : "The number was read from the page image (a table or chart); it does not appear in the text layer"
      }
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]",
        check === "text"
          ? "bg-[color-mix(in_oklab,var(--color-success,#1baf7a)_14%,transparent)] text-foreground"
          : "bg-muted text-muted-foreground",
      )}
    >
      {check === "text" ? "In text" : "Page image"}
    </span>
  );
}

export function IrFigures({ cik, company }: { cik: string; company: string }) {
  const q = useQuery(companyIrFiguresQuery(cik));
  const docs = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => irFigureRows(docs), [docs]);
  const groups = useMemo(() => groupsPresent(rows), [rows]);
  const [picked, setPicked] = useState<IrFigure["group"] | null>(null);
  const group = picked && groups.includes(picked) ? picked : (groups[0] ?? null);
  const inGroup = group ? rows.filter((r) => r.group === group) : [];
  const slice = group ? chartSlice(rows, group) : null;
  const waiting = docs.filter((d) => d.status === "pending" || d.status === "submitted").length;
  const docById = new Map(docs.map((d) => [d.id, d]));
  const sources: ChartSource[] = [...new Map(inGroup.map((r) => [r.url, r])).values()]
    .slice(0, 3)
    .map((r) => ({
      label: docById.get(r.documentId)?.title.slice(0, 80) ?? "Company document",
      url: r.url,
    }));
  const status = queryStatus(
    q,
    rows.length > 0,
    docs.length
      ? `${docs.length} investor document${docs.length === 1 ? "" : "s"} found on the company's site; ${waiting} waiting for the figure pass.`
      : "No investor-relations documents have been read for this company yet. The company's own IR site is read on a rotating schedule.",
  );
  const table: TableSpec = {
    caption: `${group ? GROUP_LABEL[group] : "Figures"} printed in ${company}'s investor documents`,
    columns: [
      { label: "Name", align: "left" },
      { label: "Metric", align: "left" },
      { label: "Period", align: "left" },
      { label: "Value" },
      { label: "Check", align: "left" },
      { label: "Printed line", align: "left" },
      { label: "Document", align: "left" },
    ],
    rows: inGroup.map((r, i) => ({
      key: `${r.documentId}-${i}`,
      cells: [
        r.name,
        r.metric,
        r.period || NOT_RECORDED,
        printed(r.value, r.unit),
        r.check === "text" ? "In document text" : "Read from page image",
        r.quote,
        r.url,
      ],
    })),
  };
  return (
    <ChartFrame
      title="Segments and KPIs from the company's investor documents"
      subtitle={
        slice
          ? `${slice.metric} · ${slice.period || "period as printed"} · ${slice.unit || "unit as printed"}`
          : "Figures as printed in results presentations and supplements"
      }
      sources={
        sources.length
          ? sources
          : [
              {
                label: "Company investor-relations site",
                url:
                  docs[0]?.url ??
                  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
              },
            ]
      }
      status={status}
      table={rows.length ? table : undefined}
      notes={[
        "Read from documents on the investor-relations site the company names in its SEC filings. Each figure keeps the line it was printed in; a figure whose line does not show its number is dropped.",
        '"Page image" means the number was read from a table or chart image and is not in the document\'s text layer; open the document to confirm it.',
        "Bars compare one metric for one period from one document only.",
      ]}
      minHeight={rows.length ? 260 : 150}
    >
      <div className="grid gap-3">
        {groups.length > 1 ? (
          <div role="tablist" aria-label="Figure group" className="flex flex-wrap gap-1">
            {groups.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={g === group}
                onClick={() => setPicked(g)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  g === group
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
        ) : null}
        {slice ? (
          <RankedBars
            items={slice.rows.map((r) => ({ id: `${r.name}`, label: r.name, value: r.value }))}
            formatter={{
              full: (v) => (v == null ? NOT_RECORDED : printed(v, slice.unit)),
              tick: (v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 }),
              delta: (d) => printed(d, slice.unit),
            }}
            ariaLabel={`${slice.metric} by ${group ? GROUP_LABEL[group].toLowerCase() : "name"}, ${slice.period}`}
            limit={10}
          />
        ) : null}
        <FigureList rows={inGroup.slice(0, slice ? 6 : 10)} />
      </div>
    </ChartFrame>
  );
}

function FigureList({ rows }: { rows: IrFigureRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {rows.map((r, i) => (
        <li
          key={`${r.documentId}-${r.name}-${i}`}
          className="grid gap-0.5 rounded-md border border-border/70 px-3 py-2"
        >
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 text-[12.5px] font-medium text-foreground">
              {r.name}{" "}
              <span className="font-normal text-muted-foreground">
                · {r.metric}
                {r.period ? ` · ${r.period}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-[12.5px] font-semibold tabular-nums text-foreground">
                {printed(r.value, r.unit)}
              </span>
              <CheckBadge check={r.check} />
            </span>
          </div>
          <p className="m-0 flex min-w-0 items-start gap-1.5 text-[11.5px] leading-5 text-muted-foreground">
            <span className="min-w-0 break-words">
              “{r.quote}”{r.page != null ? ` (p. ${r.page})` : ""}
            </span>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
              aria-label={`Open ${r.documentTitle}`}
            >
              <ExternalLink className="size-3" aria-hidden />
              Source
            </a>
          </p>
        </li>
      ))}
    </ul>
  );
}
