import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Search } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { BarTrend } from "@/components/charts/BarTrend";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { metricFormatter } from "@/components/charts/format";
import { COURT_LEVEL_LABEL, TIER_PLURAL } from "@/lib/external/caselaw";
import { courtCasesQuery, courtYearsQuery } from "./caseQueries";
import { fmtInt, NOT_RECORDED, stateLabel } from "./caseFormat";
import { HitTable, Pager, Problem, Skeleton } from "./CaseSearchPage";
import { yearSeries, type CourtCaseState } from "./courtCaseLaw";

export function CourtCaseLaw({
  courtId,
  s,
  nav,
}: {
  courtId: string;
  s: CourtCaseState;
  nav: (n: CourtCaseState) => void;
}) {
  const yq = useQuery(courtYearsQuery(courtId));
  const cq = useQuery(courtCasesQuery(courtId, s.year ?? null, s.sort ?? "newest", s.page ?? 1));
  const series = useMemo(() => (yq.data ? yearSeries(yq.data) : null), [yq.data]);
  if (yq.isLoading) return <Skeleton />;
  if (yq.isError)
    return (
      <Problem onRetry={() => void yq.refetch()}>
        This court's case law could not be loaded.
      </Problem>
    );
  const d = yq.data!;
  if (!d.court) return <Problem>No case law is held for a court with this id.</Problem>;
  const c = d.court;
  const total = d.years.reduce((s, y) => s + y.cases, 0) + d.undated;
  const first = d.years[0]?.year;
  const last = d.years[d.years.length - 1]?.year;
  const step = Math.max(1, Math.ceil((series?.keys.length ?? 1) / 12));
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-[12px] md:grid-cols-[9rem_1fr_9rem_1fr]">
          <dt className="text-muted-foreground">Court level</dt>
          <dd>
            {TIER_PLURAL[c.tier]}
            {c.level && COURT_LEVEL_LABEL[c.level] ? (
              <span className="text-muted-foreground">
                {" "}
                · CourtListener: {COURT_LEVEL_LABEL[c.level]}
              </span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">State</dt>
          <dd>{c.jurisdiction ? stateLabel(c.jurisdiction) : NOT_RECORDED}</dd>
          <dt className="text-muted-foreground">Cases held</dt>
          <dd>
            {fmtInt(c.cases)}
            {c.casesWithText != null ? (
              <span className="text-muted-foreground">
                {" "}
                · {fmtInt(c.casesWithText)} with opinion text
              </span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Decisions dated</dt>
          <dd>
            {first ? `${first}–${last}` : NOT_RECORDED}
            {d.undated ? (
              <span className="text-muted-foreground"> · {fmtInt(d.undated)} undated</span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Citation form</dt>
          <dd>{c.citationString ?? NOT_RECORDED}</dd>
          <dt className="text-muted-foreground">Court id</dt>
          <dd className="font-mono">{c.courtId}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/cases" search={{ court: c.courtId, tier: c.tier }}>
              <Search className="mr-1 size-3.5" />
              Search this court
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/courts/$id" params={{ id: c.courtId }}>
              Court profile
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a
              href={`https://www.courtlistener.com/?type=o&court=${encodeURIComponent(c.courtId)}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-1 size-3.5" />
              CourtListener
            </a>
          </Button>
        </div>
      </section>
      <ChartFrame
        title="Decisions held here, by year filed"
        unit="cases (opinion clusters)"
        period={first ? `${first}–${last}` : undefined}
        sources={[
          {
            label: "CourtListener bulk data (snapshot 2026-09-30)",
            url: "https://www.courtlistener.com/help/api/bulk-data/",
          },
        ]}
        status={
          !d.available
            ? {
                kind: "empty",
                reason:
                  "Year counts are not available until the case-law v2 contract is installed.",
              }
            : !series
              ? { kind: "empty", reason: "No dated decision of this court is held here." }
              : { kind: "ready" }
        }
        notes={[
          "A year is the year the decision was filed, as CourtListener records it.",
          "Coverage differs by court and era: a low year can mean incomplete collection, not few decisions.",
          "Choose a year in the list below to read that year's decisions.",
        ]}
        footnotes={[
          `${fmtInt(total)} cases in total${d.undated ? `, ${fmtInt(d.undated)} without a filing date (not in the chart)` : ""}.`,
        ]}
        table={
          series
            ? {
                caption: "Decisions by year",
                columns: [
                  { label: "Year" },
                  { label: "Cases", align: "right" },
                  { label: "With text", align: "right" },
                ],
                rows: d.years.map((y) => ({
                  key: String(y.year),
                  cells: [String(y.year), fmtInt(y.cases), fmtInt(y.withText)],
                })),
              }
            : undefined
        }
      >
        {series ? (
          <BarTrend
            series={[
              { id: "text", label: "With opinion text", points: series.withText },
              { id: "notext", label: "Without stored text", points: series.noText },
            ]}
            axis={{
              keys: series.keys,
              label: (k) => k,
              tick: (k) => k,
              showTick: (_k, i) => i % step === 0,
            }}
            formatter={metricFormatter("count")}
            unit="cases"
            ariaLabel={`Decisions of ${c.name} held here, by year filed`}
            stacked
            height={170}
          />
        ) : null}
      </ChartFrame>
      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            Year
            <select
              value={s.year ?? ""}
              onChange={(e) =>
                nav({
                  ...s,
                  year: e.target.value ? Number(e.target.value) : undefined,
                  page: undefined,
                })
              }
              className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
            >
              <option value="">Every year</option>
              {[...d.years].reverse().map((y) => (
                <option key={y.year} value={y.year}>
                  {y.year} ({fmtInt(y.cases)})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            Order
            <select
              value={s.sort ?? "newest"}
              onChange={(e) =>
                nav({
                  ...s,
                  sort:
                    e.target.value === "newest"
                      ? undefined
                      : (e.target.value as "oldest" | "cited"),
                  page: undefined,
                })
              }
              className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="cited">Most cited</option>
            </select>
          </label>
        </div>
        {cq.isLoading ? (
          <Skeleton />
        ) : cq.isError ? (
          <Problem onRetry={() => void cq.refetch()}>
            The list of decisions could not be loaded.
          </Problem>
        ) : cq.data!.rows.length ? (
          <>
            <HitTable rows={cq.data!.rows} />
            <Pager
              page={cq.data!.page}
              hasMore={cq.data!.hasMore}
              go={(p) => nav({ ...s, page: p > 1 ? p : undefined })}
            />
          </>
        ) : (
          <Problem>
            No decision of this court {s.year ? `filed in ${s.year} ` : ""}is held here.
          </Problem>
        )}
      </section>
    </div>
  );
}
