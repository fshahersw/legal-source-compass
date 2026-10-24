import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RotateCw } from "lucide-react";
import { Segmented, StateNote } from "@/components/enforcement/parts";
import { HowToRead } from "@/components/analysis/HowToRead";
import {
  courtScope,
  getCourtStatsTrends,
  type CourtTrends,
  type UstTable,
} from "@/lib/external/uscourtsTables.functions";
import { TrendChart } from "./TrendChart";
import { buildCharts, CIRCUIT_NAMES } from "./trendsCharts";
import { availableModes, periodIndexes, type PeriodMode } from "./trendsModel";

const MODE_LABEL: Record<PeriodMode, string> = {
  rolling: "Every published 12-month period",
  fy: "Fiscal years (to September 30)",
};

function allTables(t: CourtTrends): UstTable[] {
  return [...t.tables, ...t.bankruptcy];
}

/** Modes with data and the default: every published period when it adds periods beyond the fiscal years, else fiscal years. */
function modesFor(trends: CourtTrends): { modes: PeriodMode[]; initial: PeriodMode } {
  const periods = allTables(trends).flatMap((t) => t.periods);
  const modes = availableModes(periods);
  const fy = new Set(periodIndexes(periods, "fy").map((i) => periods[i]!.end)).size;
  const rolling = new Set(periodIndexes(periods, "rolling").map((i) => periods[i]!.end)).size;
  const initial: PeriodMode =
    modes.includes("rolling") && rolling > fy ? "rolling" : (modes[0] ?? "fy");
  return { modes, initial };
}

function courtNameFor(trends: CourtTrends): string {
  const t = allTables(trends)[0];
  if (trends.kind === "circuit")
    return t?.courtLabel
      ? `${CIRCUIT_NAMES[trends.courtId] ?? trends.courtId}`
      : (CIRCUIT_NAMES[trends.courtId] ?? trends.courtId);
  return t?.courtLabel ? `This court (${t.courtLabel})` : "This court";
}

function Skeleton() {
  return (
    <div
      className="mb-5 rounded-xl border border-border bg-card shadow-xs p-3"
      aria-busy="true"
      aria-label="Loading court statistics"
    >
      <div className="mb-3 h-5 w-56 animate-pulse rounded bg-muted/60" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-60 animate-pulse rounded-md border border-border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}

/**
 * Published U.S. Courts statistics over time for a federal district, circuit or bankruptcy court (datasets
 * uscourts_tables_district, _circuit, _bankruptcy). Renders nothing for any other court.
 */
export function CourtStatsTrendsPanel({ courtId }: { courtId: string }) {
  const scope = courtScope(courtId);
  const q = useQuery({
    queryKey: ["uscourts-trends", courtId],
    queryFn: () => getCourtStatsTrends({ data: { courtId } }),
    staleTime: 10 * 60 * 1000,
    enabled: scope != null,
  });
  if (!scope) return null;
  if (q.isLoading) return <Skeleton />;
  if (q.isError)
    return (
      <div className="mb-5">
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <RotateCw className="size-3" aria-hidden />
              Retry
            </button>
          }
        >
          Court statistics could not be loaded.
        </StateNote>
      </div>
    );
  if (!q.data)
    return (
      <div className="mb-5">
        <StateNote>
          No published U.S. Courts statistical tables are held for this court yet. Not recorded is
          not zero.
        </StateNote>
      </div>
    );
  return <Loaded trends={q.data} />;
}

function Loaded({ trends }: { trends: CourtTrends }) {
  const { modes, initial } = useMemo(() => modesFor(trends), [trends]);
  const [picked, setPicked] = useState<PeriodMode | null>(null);
  const mode = picked && modes.includes(picked) ? picked : initial;
  const charts = useMemo(
    () => buildCharts({ trends, mode, courtName: courtNameFor(trends) }),
    [trends, mode],
  );
  const tables = allTables(trends);
  const firstEnd = tables.map((t) => t.periods[0]!.end).sort()[0];
  const lastEnd = tables
    .map((t) => t.periods.at(-1)!.end)
    .sort()
    .at(-1);
  const subject = tables[0]?.courtLabel ?? trends.courtId;
  const reported = trends.bankruptcy.find((t) => t.reportedWith)?.reportedWith ?? null;
  return (
    <section
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
      aria-labelledby="court-stats-trends-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <h2 id="court-stats-trends-title" className="text-sm font-semibold">
            Court statistics over time
          </h2>
          <p className="text-xs text-muted-foreground">
            U.S. Courts statistical tables · {tables.length}{" "}
            {tables.length === 1 ? "table" : "tables"}
            {firstEnd && lastEnd ? ` · periods ending ${firstEnd} to ${lastEnd}` : ""}
          </p>
        </div>
        {modes.length > 1 ? (
          <Segmented
            label="Periods shown"
            value={mode}
            onChange={(m) => setPicked(m)}
            options={modes.map((m) => ({ id: m, label: MODE_LABEL[m] }))}
          />
        ) : null}
      </div>
      {reported ? (
        <div className="px-3 pt-3">
          <StateNote
            action={
              <Link
                to="/courts/caseload"
                search={{ tab: "bankruptcy", court: reported.court }}
                className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                Arkansas, E.D. and W.D. (one row)
              </Link>
            }
          >
            {`Bankruptcy filings: from the period ending ${reported.from} the U.S. Courts tables print the Eastern and Western districts of Arkansas in one row${reported.lastOwn ? `; this court\u2019s own row ends with the period ending ${reported.lastOwn}` : ""}. Later periods are shown for the combined row only, never split between the districts.`}
          </StateNote>
        </div>
      ) : null}
      {charts.length ? (
        <div className="grid gap-3 p-3 md:grid-cols-2">
          {charts.map((c) => (
            <TrendChart
              key={c.id}
              title={c.title}
              unitText={c.unitText}
              subject={subject}
              unit={c.unit}
              decimals={c.decimals}
              series={c.series}
              mode={mode}
              months={c.months}
              sources={c.sources}
              howToRead={c.howToRead}
              breaks={c.breaks}
              footnotes={c.footnotes}
              tableNotes={c.tableNotes}
              periodSources={c.periodSources}
            />
          ))}
        </div>
      ) : (
        <div className="p-3">
          <StateNote>
            Not recorded: the stored tables hold no value for the measures charted here.
          </StateNote>
        </div>
      )}
      <div className="border-t border-border/70 p-3">
        <HowToRead
          measures={[
            {
              term: "12-month period",
              means:
                "Each point covers the twelve months ending on the date shown, as the publisher defines it: Judicial Business ends September 30, the Statistical Tables end June 30 and December 31, the Caseload Statistics end March 31.",
              caveat:
                "Points from different months overlap by nine months; they are never added together.",
            },
            {
              term: "Not recorded",
              means:
                "A gap in a line means the table does not print a value for that court and period, or the publisher printed a dash. It is never plotted as zero.",
            },
            {
              term: "National line",
              means:
                "The publisher's own national total or rate for the same table and period, not computed here.",
            },
          ]}
          notes={
            <>
              Source: U.S. Courts,{" "}
              <a
                href="https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Caseload Statistics Data Tables
              </a>
              . Figures are the cells of the published tables; each period's file is listed under
              the chart's source link.
            </>
          }
        />
      </div>
    </section>
  );
}
