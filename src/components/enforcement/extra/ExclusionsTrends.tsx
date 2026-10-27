/**
 * Exclusions tab, answer first: how many health-care providers and firms the HHS-OIG LEIE and SAM.gov list as excluded
 * by the year the exclusion took effect and why, and national medical-malpractice payment benchmarks (NPDB). The
 * current year is partial; SAM rows dated in the future (as published) are counted, never charted; NPDB 1990 is the
 * Data Bank's opening (partial) year.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import {
  ChartCard,
  periodTable,
  TrendColumns,
  TrendLines,
  trendTakeaway,
} from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  buildSectionContext,
  KpiCard,
  KpiGrid,
  Section,
} from "@/components/kit";
import { getExclusionsTrends } from "@/lib/external/enforcementExclusions.functions";
import { LEIE_GROUPS, SAM_GROUPS } from "@/lib/external/enforcementExclusions";

export const exclusionsTrendsQuery = {
  queryKey: ["enforcement", "exclusions-trends"],
  queryFn: () => getExclusionsTrends(),
  staleTime: 10 * 60 * 1000,
};

const LEIE = {
  label: "HHS-OIG List of Excluded Individuals/Entities (LEIE)",
  url: "https://oig.hhs.gov/exclusions/exclusions_list.asp",
};
const SAM = { label: "SAM.gov exclusions", url: "https://sam.gov/content/exclusions" };
const NPDB = {
  label: "National Practitioner Data Bank public use data (HRSA)",
  url: "https://www.npdb.hrsa.gov/resources/publicData.jsp",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const FROM = 2006;

export function ExclusionsTrendsSection() {
  const q = useQuery(exclusionsTrendsQuery);
  const d = q.data;
  const t = d?.trends ?? null;
  const leieRows = (t?.leie ?? []).filter((r) => Number(r.year) >= FROM);
  const samRows = (t?.sam ?? []).filter((r) => Number(r.year) >= FROM);
  const totals = (d?.leieTotals ?? []).filter((r) => Number(r.year) >= FROM);
  const lastComplete = [...(t?.leie ?? [])].reverse().find((r) => !r.partial) ?? null;
  const partialYear = (t?.leie ?? []).find((r) => r.partial) ?? null;
  // Until the breakdown RPC is applied, the yearly LEIE totals (insights layer) still answer KPIs 1 and 3.
  const totalLast =
    [...(d?.leieTotals ?? [])].reverse().find((r) => !r.partial && r.value !== null) ?? null;
  const totalPartial = (d?.leieTotals ?? []).find((r) => r.partial && r.value !== null) ?? null;
  const kpiLast = lastComplete
    ? { year: lastComplete.year, value: lastComplete.total }
    : totalLast?.value != null
      ? { year: totalLast.year, value: totalLast.value }
      : null;
  const kpiPartial = partialYear
    ? { year: partialYear.year, value: partialYear.total }
    : totalPartial?.value != null
      ? { year: totalPartial.year, value: totalPartial.value }
      : null;
  const samLast = [...(t?.sam ?? [])].reverse().find((r) => !r.partial) ?? null;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : ({ kind: "ready" } as const);
  const partialNote = partialYear
    ? `${partialYear.year} is partial: exclusions through ${t?.asOf}.`
    : kpiPartial
      ? `${kpiPartial.year} is partial: the year is in progress.`
      : undefined;
  const context = useMemo(
    () =>
      d
        ? buildSectionContext({
            title: "Health-care exclusions",
            scope: "Exclusions still listed, by the year they took effect",
            period: `${FROM}–${t?.asOf.slice(0, 4) ?? ""}`,
            source: `${LEIE.label}; ${SAM.label}`,
            figures: [
              ...totals.map((r) => ({
                label: "LEIE exclusions",
                value: r.value,
                period: r.year,
                ...(r.partial ? { note: "partial year" } : {}),
              })),
              ...(lastComplete
                ? LEIE_GROUPS.map((g) => ({
                    label: `LEIE: ${g.label}`,
                    value: lastComplete[g.id],
                    period: lastComplete.year,
                  }))
                : []),
              ...(samLast
                ? SAM_GROUPS.map((g) => ({
                    label: `SAM: ${g.label}`,
                    value: samLast[g.id],
                    period: samLast.year,
                  }))
                : []),
              { label: "SAM rows with a future date (not charted)", value: t?.samFuture ?? null },
            ],
            maxFigures: 60,
          })
        : null,
    [d, t, totals, lastComplete, samLast],
  );
  return (
    <Section
      id="exclusion-trends"
      title="Who is being excluded, and why?"
      description="Exclusions still in force, by the year they took effect. Individuals are named only in the search below, as published."
      actions={<AskAiButton sectionId="exclusion-trends" context={context} />}
    >
      <KpiGrid columns={4} label="Exclusion figures">
        <KpiCard
          as="li"
          label="LEIE exclusions taking effect"
          value={kpiLast ? fmt(kpiLast.value) : null}
          meta={kpiLast ? `${kpiLast.year}, still listed` : undefined}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "HHS-OIG LEIE", href: LEIE.url } }}
        />
        <KpiCard
          as="li"
          label="Health-care fraud and controlled-substance felonies"
          value={lastComplete ? fmt(lastComplete["1128a3"] + lastComplete["1128a4"]) : null}
          meta={
            lastComplete
              ? `${lastComplete.year}, 1128(a)(3) and (a)(4)`
              : "Not recorded until the exclusions RPC is applied"
          }
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "HHS-OIG LEIE", href: LEIE.url } }}
        />
        <KpiCard
          as="li"
          label={
            kpiPartial ? `LEIE exclusions, ${kpiPartial.year} so far` : "LEIE exclusions, this year"
          }
          value={kpiPartial ? fmt(kpiPartial.value) : null}
          meta={t ? `through ${t.asOf}` : kpiPartial ? "year in progress" : undefined}
          partial={partialNote}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "HHS-OIG LEIE", href: LEIE.url } }}
        />
        <KpiCard
          as="li"
          label="SAM firms excluded"
          value={samLast ? fmt(samLast.Firm) : null}
          meta={
            samLast
              ? `${samLast.year}, still listed`
              : "Not recorded until the exclusions RPC is applied"
          }
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "SAM.gov", href: SAM.url } }}
        />
      </KpiGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            t
              ? "Why providers are excluded, by year"
              : (trendTakeaway(
                  "LEIE exclusions",
                  totals.map((r) => ({ label: r.year, value: r.value, partial: r.partial })),
                  fmt,
                ) ?? "LEIE exclusions per year")
          }
          subtitle={`LEIE exclusions still listed, by year they took effect and authority · exclusions · ${FROM}–${t?.asOf.slice(0, 4) ?? "latest"}`}
          status={
            status.kind === "ready" && !leieRows.length && !totals.length
              ? { kind: "empty", reason: "Not recorded: the LEIE trend could not be read." }
              : status
          }
          sources={[LEIE]}
          partial={partialNote}
          asOf={t?.asOf}
          notice={
            d?.basis === "fallback" ? (
              <p className="text-xs">
                Showing yearly totals only: the breakdown by authority appears once the exclusions
                summary is installed.
              </p>
            ) : undefined
          }
          about={
            <>
              <p>
                The LEIE lists exclusions in force today; reinstated providers are removed. A
                year&rsquo;s bar is the exclusions still listed that took effect that year, so older
                years read lower than the actions taken then.
              </p>
              <p className="mt-2">
                Authorities are the Social Security Act section the OIG cites. All codes other than
                the five shown are grouped as &ldquo;Other authorities&rdquo;.
              </p>
            </>
          }
          table={
            t
              ? periodTable(
                  t.leie,
                  "year",
                  [
                    ...LEIE_GROUPS.map((g) => ({ key: g.id, label: g.label })),
                    { key: "total", label: "Total" },
                  ],
                  fmt,
                  {
                    caption: "LEIE exclusions by year and authority",
                    xLabel: "Year",
                    partialKey: "partial",
                  },
                )
              : periodTable(totals, "year", [{ key: "value", label: "LEIE exclusions" }], fmt, {
                  caption: "LEIE exclusions by year",
                  xLabel: "Year",
                  partialKey: "partial",
                })
          }
        >
          {t ? (
            <StackedBarsOverTime
              rows={leieRows.map((r) => ({
                period: r.year,
                partial: r.partial,
                values: Object.fromEntries(LEIE_GROUPS.map((g) => [g.id, r[g.id]])),
              }))}
              keys={LEIE_GROUPS.map((g) => g.id)}
              labels={Object.fromEntries(LEIE_GROUPS.map((g) => [g.id, g.label]))}
              format={fmt}
            />
          ) : (
            <TrendColumns
              rows={totals}
              xKey="year"
              series={[{ key: "value", label: "LEIE exclusions" }]}
              format={fmt}
              partialKey="partial"
              ariaLabel="LEIE exclusions per year"
            />
          )}
        </ChartCard>

        <ChartCard
          variant="editorial"
          title="Federal exclusions on SAM.gov, by year they took effect"
          subtitle={`SAM exclusions still listed, by classification · exclusions · ${FROM}–${t?.asOf.slice(0, 4) ?? "latest"}`}
          status={
            status.kind === "ready" && !samRows.length
              ? {
                  kind: "empty",
                  reason:
                    "Not recorded: the SAM breakdown appears once the exclusions summary is installed.",
                }
              : status
          }
          sources={[SAM]}
          partial={partialNote}
          asOf={t?.asOf}
          about={
            <p>
              SAM.gov lists exclusions in force across federal agencies, including OFAC special
              entity designations and vessels. Bars count exclusions still listed by the year they
              became active.
              {t
                ? ` ${fmt(t.samUndated ?? 0)} rows carry no active date and ${fmt(t.samFuture ?? 0)} carry a date in the future as published; neither is charted.`
                : ""}
            </p>
          }
          table={
            t
              ? periodTable(
                  t.sam,
                  "year",
                  [
                    ...SAM_GROUPS.map((g) => ({ key: g.id, label: g.label })),
                    { key: "total", label: "Total" },
                  ],
                  fmt,
                  {
                    caption: "SAM exclusions by year and classification",
                    xLabel: "Year",
                    partialKey: "partial",
                  },
                )
              : undefined
          }
        >
          <StackedBarsOverTime
            rows={samRows.map((r) => ({
              period: r.year,
              partial: r.partial,
              values: Object.fromEntries(SAM_GROUPS.map((g) => [g.id, r[g.id]])),
            }))}
            keys={SAM_GROUPS.map((g) => g.id)}
            labels={Object.fromEntries(SAM_GROUPS.map((g) => [g.id, g.label]))}
            format={fmt}
          />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}

export function MalpracticeBenchmarksSection() {
  const q = useQuery(exclusionsTrendsQuery);
  const n = q.data?.npdb;
  const years = useMemo(() => n?.years ?? [], [n]);
  const complete = years.filter((y) => !y.partial);
  const last = complete.at(-1) ?? null;
  const first = years[0]?.year ?? "";
  const lastYear = years.at(-1)?.year ?? "";
  const period = first ? `${first}–${lastYear}` : "";
  const partialYears = years.filter((y) => y.partial).map((y) => y.year);
  const partialNote = partialYears.length
    ? `${partialYears.join(" and ")} ${partialYears.length === 1 ? "is" : "are"} partial (${partialYears.includes("1990") ? "the Data Bank opened in September 1990" : "year in progress"}${partialYears.length > 1 ? "; the latest year is in progress" : ""}).`
    : undefined;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : years.length < 2
        ? ({ kind: "empty", reason: "Not recorded: no NPDB national series was read." } as const)
        : ({ kind: "ready" } as const);
  const sources = [{ label: NPDB.label, url: n?.sourceUrl ?? NPDB.url }];
  const medianPoints = years.map((y) => ({
    label: y.year,
    value: y.median2025,
    partial: y.partial,
  }));
  const context = useMemo(
    () =>
      n
        ? buildSectionContext({
            title: "Medical malpractice payment benchmarks",
            scope: "NPDB malpractice payment reports, United States",
            period,
            source: NPDB.label,
            figures: [
              ...years.flatMap((y) => [
                {
                  label: "Payment reports",
                  value: y.reports,
                  period: y.year,
                  ...(y.partial ? { note: "partial year" } : {}),
                },
                {
                  label: "Median payment (2025 dollars)",
                  value: y.median2025 === null ? null : usd(y.median2025),
                  period: y.year,
                },
              ]),
              ...n.allegations.map((a) => ({
                label: `Median payment, ${a.label}`,
                value: a.median === null ? null : usd(a.median),
                period: "all years",
              })),
            ],
            maxFigures: 90,
          })
        : null,
    [n, years, period],
  );
  return (
    <Section
      id="malpractice"
      title="What do medical-injury payments look like?"
      description="National malpractice payment reports to the National Practitioner Data Bank. Reports are payments, not unique practitioners."
      actions={<AskAiButton sectionId="malpractice" context={context} />}
    >
      <KpiGrid columns={4} label="Malpractice payment figures">
        <KpiCard
          as="li"
          label="Payment reports"
          value={last?.reports != null ? fmt(last.reports) : null}
          meta={last ? last.year : undefined}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "NPDB", href: NPDB.url } }}
        />
        <KpiCard
          as="li"
          label="Median payment"
          value={last?.median != null ? usd(last.median) : null}
          meta={last ? `${last.year}, current dollars` : undefined}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "NPDB", href: NPDB.url } }}
        />
        <KpiCard
          as="li"
          label="Median years from incident to payment"
          value={last?.delayYears != null ? fmt(last.delayYears) : null}
          meta={last ? last.year : undefined}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "NPDB", href: NPDB.url } }}
        />
        <KpiCard
          as="li"
          label="Paid by court judgment"
          value={last?.judgmentShare != null ? `${(last.judgmentShare * 100).toFixed(1)}%` : null}
          meta={last ? `${last.year}, share of payment reports` : undefined}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "NPDB", href: NPDB.url } }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            trendTakeaway("The median payment in 2025 dollars", medianPoints, usd) ??
            "Median malpractice payment"
          }
          subtitle={`Median payment per report, adjusted to 2025 dollars · USD · ${period}`}
          status={status}
          sources={sources}
          period={period}
          partial={partialNote}
          about={
            <p>
              The NPDB publishes the median of each year&rsquo;s payment reports and its value in
              2025 dollars. A year still in progress has no adjusted median; 1990 holds only the
              reports from the Data Bank&rsquo;s opening months.
            </p>
          }
          table={periodTable(
            years,
            "year",
            [
              { key: "reports", label: "Payment reports" },
              { key: "median", label: "Median payment (USD)" },
              { key: "median2025", label: "Median payment (2025 USD)" },
              { key: "delayYears", label: "Median years to payment" },
            ],
            fmt,
            {
              caption: "NPDB malpractice payment reports by year",
              xLabel: "Year",
              partialKey: "partial",
            },
          )}
        >
          <TrendLines
            rows={years}
            xKey="year"
            series={[{ key: "median2025", label: "Median payment (2025 dollars)" }]}
            format={usd}
            partialKey="partial"
            ariaLabel="Median malpractice payment in 2025 dollars, by year"
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title="Median payment by allegation group, all years (unadjusted)"
          subtitle="Nominal USD of each payment year · most-reported groups first; groups span different years, so they are not ranked"
          status={
            status.kind === "ready" && !(n?.allegations.length ?? 0)
              ? { kind: "empty", reason: "Not recorded: no allegation groups were read." }
              : status
          }
          sources={sources}
          period={period}
          about={
            <p>
              Allegation groups as the NPDB codes them, over every year in the file. Medians are in
              the dollars of each payment year, not adjusted.
            </p>
          }
          table={{
            caption: "NPDB payments by allegation group, all years",
            columns: [
              { label: "Allegation group" },
              { label: "Payment reports", align: "right" },
              { label: "Median payment (USD)", align: "right" },
            ],
            rows: (n?.allegations ?? []).map((a) => ({
              key: a.id,
              cells: [
                a.label,
                a.reports != null ? fmt(a.reports) : "Not recorded",
                a.median != null ? usd(a.median) : "Not recorded",
              ],
            })),
          }}
        >
          <BarList
            ariaLabel="Median malpractice payment by allegation group"
            items={[...(n?.allegations ?? [])]
              .filter((a) => a.median !== null)
              // most-reported groups first: nominal medians over different years are not ranked
              .sort((a, b) => (b.reports ?? 0) - (a.reports ?? 0))
              .map((a) => ({
                id: a.id,
                label: a.label,
                value: a.median,
                display: usd(a.median!),
                note: a.reports != null ? `${fmt(a.reports)} reports` : undefined,
              }))}
          />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}
