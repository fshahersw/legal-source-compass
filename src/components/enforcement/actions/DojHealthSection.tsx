/**
 * DOJ health-care enforcement, answer first: how many releases the Justice Department tags False Claims Act, health-care
 * fraud, opioids and prescription drugs each year, how large the FCA resolutions are by their own headline figure, and
 * the largest health-care resolutions. Topic tags start in 2015, so the charts start there; the current year is partial.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import { ChartCard, periodTable, TrendLines, trendTakeaway } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  buildSectionContext,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
} from "@/components/kit";
import { getDojHealthDashboard } from "@/lib/external/enforcementHealth.functions";
import {
  HEALTH_TOPICS,
  lastChange,
  SIZE_BUCKETS,
  TOPIC_FROM_YEAR,
} from "@/lib/external/enforcementHealth";
import { fmtInt, fmtUsd, headlineText } from "./format";
import { SourceLink } from "../parts";

export const dojHealthQuery = {
  queryKey: ["enforcement-actions", "doj-health", "v2"],
  queryFn: () => getDojHealthDashboard(),
  staleTime: 10 * 60 * 1000,
};

const SOURCE = {
  label: "DOJ News API (justice.gov), press releases",
  url: "https://www.justice.gov/news",
};
const KPI_SOURCE = { source: { label: "DOJ press releases", href: SOURCE.url } };

export function DojHealthSection() {
  const q = useQuery(dojHealthQuery);
  const d = q.data ?? null;
  const years = d?.years ?? [];
  const first = years[0]?.year ?? String(TOPIC_FROM_YEAR);
  const last = years.at(-1)?.year ?? "";
  const period = last ? `${first}–${last}` : "";
  const partialNote = years.some((y) => y.partial)
    ? `${years.find((y) => y.partial)!.year} is partial: releases through ${d?.asOf ?? "the latest harvest"}.`
    : undefined;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : !d || years.length < 2
        ? ({ kind: "empty", reason: "Not recorded: no tagged releases were read." } as const)
        : ({ kind: "ready" } as const);

  const fca = d ? lastChange(d.years, "fca") : null;
  const hcf = d ? lastChange(d.years, "hcf") : null;
  const opioids = d ? lastChange(d.years, "opioids") : null;
  const complete = d?.latestComplete ?? null;
  const sizeRow = d?.fcaSizes.find((s) => s.year === complete) ?? null;
  const stated = sizeRow ? sizeRow.m1 + sizeRow.m10 + sizeRow.m100 : null;
  const med = d?.fcaMedian.find((m) => m.year === complete) ?? null;

  const fcaPoints = years.map((y) => ({ label: y.year, value: y.fca, partial: y.partial }));
  const sizeRows = (d?.fcaSizes ?? []).map((s) => ({
    period: s.year,
    partial: s.partial,
    values: { none: s.none, m1: s.m1, m10: s.m10, m100: s.m100 },
  }));

  const context = useMemo(
    () =>
      d
        ? buildSectionContext({
            title: "DOJ health-care enforcement",
            scope: "DOJ press releases tagged by topic",
            period,
            source: SOURCE.label,
            figures: [
              ...d.years.flatMap((y) =>
                HEALTH_TOPICS.map((t) => ({
                  label: `${t.label} releases`,
                  value: y[t.id],
                  period: y.year,
                  ...(y.partial ? { note: "partial year" } : {}),
                })),
              ),
              {
                label: "FCA releases stating $1M or more",
                value: stated,
                period: complete ?? undefined,
              },
              {
                label: "Median FCA headline figure ($1M or more)",
                value: med?.median != null ? fmtUsd(med.median) : null,
                period: complete ?? undefined,
              },
              ...d.top.slice(0, 10).map((e) => ({
                label: `Resolution: ${e.release.title.slice(0, 80)}`,
                value: e.release.headline ? headlineText(e.release.headline) : fmtUsd(e.valueUsd),
                period: e.release.date ?? undefined,
              })),
            ],
            maxFigures: 70,
          })
        : null,
    [d, period, stated, med, complete],
  );

  const delta = (c: typeof fca) =>
    c && c.pct != null
      ? {
          value: c.pct,
          kind: "percent" as const,
          detail: `${c.delta! >= 0 ? "+" : ""}${fmtInt(c.delta!)} vs ${Number(c.year) - 1}`,
        }
      : null;

  return (
    <Section
      id="doj-health"
      title="Health-care enforcement"
      description="False Claims Act, health-care fraud, opioid and prescription-drug releases from the Justice Department."
      actions={<AskAiButton sectionId="doj-health" context={context} />}
    >
      <KpiGrid columns={5} label="Health-care enforcement figures">
        <KpiCard
          as="li"
          label="False Claims Act releases"
          value={fca ? fmtInt(fca.value) : null}
          meta={fca ? `${fca.year}, all DOJ components` : undefined}
          delta={delta(fca)}
          source={KPI_SOURCE}
          state={q.isPending ? "loading" : "ready"}
        />
        <KpiCard
          as="li"
          label="Health-care fraud releases"
          value={hcf ? fmtInt(hcf.value) : null}
          meta={hcf ? hcf.year : undefined}
          delta={delta(hcf)}
          source={KPI_SOURCE}
          state={q.isPending ? "loading" : "ready"}
        />
        <KpiCard
          as="li"
          label="Opioid releases"
          value={opioids ? fmtInt(opioids.value) : null}
          meta={opioids ? opioids.year : undefined}
          delta={delta(opioids)}
          source={KPI_SOURCE}
          state={q.isPending ? "loading" : "ready"}
        />
        <KpiCard
          as="li"
          label="FCA releases stating $1M or more"
          value={stated != null ? fmtInt(stated) : null}
          meta={complete ? `${complete}, by the release's own headline figure` : undefined}
          source={KPI_SOURCE}
          state={q.isPending ? "loading" : "ready"}
        />
        <KpiCard
          as="li"
          label="Median FCA headline figure"
          value={med?.median != null ? fmtUsd(med.median) : null}
          meta={med ? `${complete}, ${fmtInt(med.n)} releases stating $1M or more` : undefined}
          source={KPI_SOURCE}
          state={q.isPending ? "loading" : "ready"}
        />
      </KpiGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            trendTakeaway("False Claims Act releases", fcaPoints, fmtInt) ??
            "Health-care enforcement releases per year"
          }
          subtitle={`Releases per year by topic tag · releases · ${period}`}
          status={status}
          sources={[SOURCE]}
          period={period}
          partial={partialNote}
          about={
            <>
              <p>
                Counts are press releases dated in each year that DOJ tagged with the topic. A
                release can carry several topics, so the lines are never added together.
              </p>
              <p className="mt-2">
                DOJ applies topic tags consistently only from 2015, so earlier years are left out.
              </p>
            </>
          }
          table={periodTable(
            years,
            "year",
            HEALTH_TOPICS.map((t) => ({ key: t.id, label: t.label })),
            fmtInt,
            {
              caption: "DOJ health-care releases per year, by topic",
              xLabel: "Year",
              partialKey: "partial",
            },
          )}
        >
          <TrendLines
            rows={years}
            xKey="year"
            series={HEALTH_TOPICS.map((t) => ({ key: t.id, label: t.label }))}
            format={fmtInt}
            partialKey="partial"
            ariaLabel="DOJ health-care releases per year, by topic"
          />
        </ChartCard>

        <ChartCard
          variant="editorial"
          title="How large are False Claims Act resolutions?"
          subtitle={`FCA releases by the size of their own headline figure · releases · ${period}`}
          status={status}
          sources={[SOURCE]}
          period={period}
          partial={partialNote}
          about={
            <p>
              Each FCA release falls in exactly one band by its headline figure: the title&rsquo;s
              amount, else the first resolution sentence. Releases stating no figure, or under $1M,
              form the first band. Figures are as stated, not verified payments.
            </p>
          }
          table={periodTable(
            d?.fcaSizes ?? [],
            "year",
            SIZE_BUCKETS.map((b) => ({ key: b.id, label: b.label })),
            fmtInt,
            {
              caption: "FCA releases by headline-figure size",
              xLabel: "Year",
              partialKey: "partial",
              total: true,
            },
          )}
        >
          <StackedBarsOverTime
            rows={sizeRows}
            keys={SIZE_BUCKETS.map((b) => b.id)}
            labels={Object.fromEntries(SIZE_BUCKETS.map((b) => [b.id, b.label]))}
            format={fmtInt}
          />
        </ChartCard>
      </div>

      <div className="mt-4">
        <ChartCard
          title="Largest health-care resolutions"
          subtitle={`Ranked by the amount each release title states · USD · ${period}`}
          status={
            status.kind === "ready" && !(d?.top.length ?? 0)
              ? { kind: "empty", reason: "No health-care release states $100 million or more." }
              : status
          }
          sources={[SOURCE]}
          period={period}
          about={
            <p>
              Releases tagged False Claims Act, health-care fraud, opioids or prescription drugs
              whose title states $100 million or more. Figures found only in the release text are
              not ranked{d ? ` (${fmtInt(d.topTextOnly)})` : ""}. Speeches, totals, takedowns and
              other charges, distributions and filings are held back
              {d ? ` (${fmtInt(d.topHeld)} of ${fmtInt(d.topCandidates)})` : ""}. Only exact repeats
              of one release are merged. Never summed.
            </p>
          }
          actions={
            d?.top.length ? (
              <DataDrawer
                title="Largest health-care resolutions"
                rows={d.top}
                rowKey={(e) => e.release.id}
                triggerLabel={`View all ${fmtInt(d.top.length)}`}
                columns={[
                  {
                    key: "figure",
                    label: "Headline figure (USD)",
                    align: "right",
                    value: (e) => e.valueUsd,
                    render: (e) =>
                      e.release.headline ? headlineText(e.release.headline) : fmtUsd(e.valueUsd),
                  },
                  { key: "date", label: "Date", value: (e) => e.release.date },
                  {
                    key: "title",
                    label: "Release",
                    value: (e) => e.release.title,
                    render: (e) =>
                      e.release.url ? (
                        <SourceLink href={e.release.url}>{e.release.title}</SourceLink>
                      ) : (
                        e.release.title
                      ),
                  },
                  { key: "topics", label: "Topics", value: (e) => e.release.topics.join("; ") },
                  { key: "related", label: "Related releases", value: (e) => e.related.length },
                ]}
                source={{ source: { label: SOURCE.label, href: SOURCE.url }, period }}
              />
            ) : null
          }
        >
          <BarList
            ariaLabel="Largest health-care resolutions by headline figure"
            items={(d?.top ?? []).slice(0, 10).map((e) => ({
              id: e.release.id,
              label: e.release.title,
              value: e.valueUsd,
              display: e.release.headline ? headlineText(e.release.headline) : fmtUsd(e.valueUsd),
              note: e.release.date ?? "date not recorded",
            }))}
          />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}
