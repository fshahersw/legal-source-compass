import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineTrend } from "@/components/charts/LineTrend";
import { RankedBars } from "@/components/charts/RankedBars";
import type { ValueFormatter } from "@/components/charts/format";
import { HowToRead } from "@/components/analysis/HowToRead";
import { PanelError, PanelLoading, PanelShell } from "./ClbRestParts";
import { fmtInt, NOT_RECORDED } from "./clbFormat";
import { getClbSearchCounts, type CourtSearchCounts } from "./searchCounts.functions";
import { SEARCH_COUNT_COURTS, type TopicSeries } from "./searchCounts";

const HELP =
  "https://wiki.free.law/c/courtlistener/help/search/advanced-search-and-query-techniques";
/** Shares here are often under 1%: three decimals in full, two significant digits on an axis tick. */
const smallPct: ValueFormatter = {
  full: (v) =>
    typeof v === "number" && Number.isFinite(v)
      ? `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 3 })}%`
      : NOT_RECORDED,
  tick: (v) => `${Number(v.toPrecision(2)).toLocaleString("en-US", { maximumFractionDigits: 4 })}%`,
  delta: (d) =>
    `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toLocaleString("en-US", { maximumFractionDigits: 3 })} percentage points`,
};
const pct3 = (v: number | null) =>
  v == null
    ? NOT_RECORDED
    : `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 3 })}%`;
const day = (stamp: string) => stamp.slice(0, 10);

/**
 * How often this court's opinions mention selected doctrines, from CourtListener's search engine (dataset
 * clb_search_counts): the share of the court's opinions filed 2000–2025 whose text matches each exact query, its rank
 * among the Supreme Court and the 13 federal courts of appeals, and the national series by year for one doctrine.
 * Every figure links to the search that produced it. Renders nothing for other courts.
 */
export function CourtSearchTopicsPanel({ courtId }: { courtId: string }) {
  const enabled = (SEARCH_COUNT_COURTS as readonly string[]).includes(courtId);
  const q = useQuery({
    queryKey: ["clb-search-counts", courtId],
    queryFn: () => getClbSearchCounts({ data: { court: courtId } }),
    staleTime: 30 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading doctrine search counts" height="h-48" />;
  if (q.isError)
    return (
      <PanelError
        text="Doctrine search counts could not be loaded."
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data) return null;
  return <Body d={q.data} />;
}

function Body({ d }: { d: CourtSearchCounts }) {
  const c = d.court;
  const span = `${c.window[0].slice(0, 4)}–${c.window[1].slice(0, 4)}`;
  const stamps = [c.total.retrievedAt, ...c.topics.map((t) => t.retrievedAt)].sort();
  const retrieved =
    day(stamps[0]!) === day(stamps[stamps.length - 1]!)
      ? day(stamps[0]!)
      : `${day(stamps[0]!)} to ${day(stamps[stamps.length - 1]!)}`;
  return (
    <PanelShell
      title="Doctrines in this court's opinions"
      subtitle={
        <>
          Opinions filed {span} whose text matches each search · CourtListener search counts
          retrieved {retrieved}
        </>
      }
      record={{ dataset: "clb_search_counts", id: `court:${c.courtId}` }}
      aside={
        <a
          href={c.total.searchUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          All {fmtInt(c.total.count)} opinions on CourtListener
        </a>
      }
    >
      <div className="space-y-3 px-3 pb-3">
        <ChartFrame
          title={`Share of ${c.court} opinions mentioning each doctrine, ${span}`}
          unit="% of the court's opinions (published and unpublished)"
          period={span}
          headingLevel="h3"
          sources={[
            { label: "CourtListener search API, counts per query", url: c.total.searchUrl },
            { label: "Advanced search syntax", url: HELP },
          ]}
          status={
            c.topics.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No doctrine count is recorded for this court." }
          }
          notes={[
            "Each bar is the number of the court's opinions whose text matches the exact search, divided by all its opinions in the same years.",
            "A mention is any occurrence of the words; it does not say how the doctrine was applied.",
          ]}
          footnotes={[`All opinions ${span}: ${fmtInt(c.total.count)} (query ${c.total.q}).`]}
          table={{
            caption: `Doctrine searches, ${c.court}, ${span}`,
            columns: [
              { label: "Doctrine" },
              { label: "Search", align: "left" },
              { label: "Opinions", align: "right" },
              { label: "Share", align: "right" },
              { label: "All 14 courts pooled", align: "right" },
              { label: "Rank", align: "right" },
              { label: "Retrieved", align: "left" },
            ],
            rows: c.topics.map((t) => ({
              key: t.slug,
              cells: [
                t.label,
                <a
                  key="s"
                  href={t.searchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary hover:underline"
                >
                  {t.topicQuery}
                </a>,
                fmtInt(t.count),
                pct3(t.sharePct),
                pct3(t.pooledSharePct),
                <span key="r" className="whitespace-nowrap">
                  {t.rank && t.rankOf ? `${t.rank} of ${t.rankOf}` : NOT_RECORDED}
                </span>,
                <span key="d" className="whitespace-nowrap">
                  {day(t.retrievedAt)}
                </span>,
              ],
            })),
          }}
        >
          <RankedBars
            items={c.topics.map((t) => ({
              id: t.slug,
              label: t.label,
              value: t.sharePct,
              note: `${fmtInt(t.count)} opinions${t.rank && t.rankOf ? ` · rank ${t.rank} of ${t.rankOf} courts` : ""}${t.pooledSharePct != null ? ` · ${pct3(t.pooledSharePct)} across the 14 courts` : ""}`,
            }))}
            formatter={smallPct}
            unit="of opinions"
            ariaLabel={`Share of ${c.court} opinions mentioning each doctrine`}
          />
        </ChartFrame>
        {d.series.length ? <NationalTrend series={d.series} /> : null}
        <HowToRead
          measures={[
            {
              term: "Count",
              means:
                "the number of opinion clusters (cases) CourtListener's search engine returned for the exact query.",
              caveat:
                "Clusters are every decision CourtListener holds, which for some courts (the Supreme Court especially) includes orders and summary dispositions; the collection is fuller for some courts and years, and a count changes as opinions are added.",
            },
            {
              term: "Search",
              means:
                "phrases in quotes match exactly (no stemming); ~10 means the words within ten words of each other; OR inside parentheses matches either phrase.",
            },
            {
              term: "14 courts pooled",
              means:
                "all 14 courts' matching opinions added together, divided by all their opinions in the same years.",
            },
            {
              term: "Rank",
              means: "this court's position among the 14 by share; ties share a rank.",
            },
          ]}
        />
      </div>
    </PanelShell>
  );
}

function NationalTrend({ series }: { series: TopicSeries[] }) {
  const [slug, setSlug] = useState(
    series.find((s) => s.slug === "class_certification")?.slug ?? series[0]!.slug,
  );
  const selectId = useId();
  const s = series.find((x) => x.slug === slug) ?? series[0]!;
  const keys = useMemo(() => s.points.map((p) => String(p.year)), [s]);
  const partial = s.points.find((p) => p.partial);
  return (
    <ChartFrame
      title={`Opinions mentioning ${s.label.toLowerCase()}, all courts, by year filed`}
      unit="% of all opinions filed that year"
      period={`${s.points[0]!.year}–${s.points[s.points.length - 1]!.year}`}
      headingLevel="h3"
      sources={[
        {
          label: "CourtListener search API, one count per year",
          url: s.points[s.points.length - 1]!.searchUrl,
        },
        { label: "Advanced search syntax", url: HELP },
      ]}
      status={{ kind: "ready" }}
      actions={
        <label
          htmlFor={selectId}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          Doctrine
          <select
            id={selectId}
            value={s.slug}
            onChange={(e) => setSlug(e.target.value)}
            className="max-w-[14rem] rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {series.map((x) => (
              <option key={x.slug} value={x.slug}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      }
      notes={[
        "Each year: opinions of every court whose text matches the search, divided by all opinions filed that year (published and unpublished).",
        "A share avoids reading growth of the collection as growth of the doctrine; the counts are in the table.",
      ]}
      footnotes={
        partial
          ? [`${partial.year}* is partial: counted to ${day(partial.retrievedAt)}.`]
          : undefined
      }
      table={{
        caption: `Opinions mentioning ${s.label.toLowerCase()}, by year`,
        columns: [
          { label: "Year" },
          { label: "Opinions mentioning", align: "right" },
          { label: "All opinions", align: "right" },
          { label: "Share", align: "right" },
          { label: "Retrieved", align: "left" },
        ],
        rows: [...s.points].reverse().map((p) => ({
          key: String(p.year),
          cells: [
            p.partial ? `${p.year}*` : String(p.year),
            <a
              key="s"
              href={p.searchUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {fmtInt(p.count)}
            </a>,
            fmtInt(p.total),
            pct3(p.sharePct),
            <span key="d" className="whitespace-nowrap">
              {day(p.retrievedAt)}
            </span>,
          ],
        })),
      }}
    >
      <LineTrend
        series={[
          {
            id: s.slug,
            label: s.label,
            points: s.points.map((p) => ({
              key: String(p.year),
              value: p.sharePct,
              partial: p.partial,
              n: p.count,
            })),
          },
        ]}
        axis={{
          keys,
          label: (k) => k,
          tick: (k) => k,
          showTick: (_k, i) => i % 5 === 0 || i === keys.length - 1,
        }}
        formatter={smallPct}
        ariaLabel={`Share of all opinions mentioning ${s.label.toLowerCase()}, by year`}
        height={180}
      />
    </ChartFrame>
  );
}
