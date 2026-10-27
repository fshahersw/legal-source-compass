/**
 * MDL transferee-venue scorecard: where pending MDL actions sit (JPML report), how congested each transferee bench is
 * (FCMS weighted filings per judgeship) and the citizen voting-age population of the district's counties (ACS
 * 2020-2024, B29001), a proxy for the jury-eligible population. Never a verdict propensity.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/recharts";
import { VerdictStack } from "@/components/charts/editorial";
import { DivergingDots } from "@/components/charts/d3/charts";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { median } from "@/lib/courts/fcmsHistory";
import { ageShares } from "@/lib/courts/venueScorecard";
import type { ScorecardRow } from "@/lib/external/courtVenue.functions";
import {
  SOURCES,
  fmtDate,
  fmtInt,
  fmtOne,
  shortDistrict,
  venueScorecardQuery,
} from "./venueQueries";

const TITLE = "MDL transferee venues";
const PICK = 10;
const MIN_ACTIONS = 100;
const AGE_TAGS = [
  { key: "age18to29", label: "18–29" },
  { key: "age30to44", label: "30–44" },
  { key: "age45to64", label: "45–64" },
  { key: "age65plus", label: "65 and over" },
] as const;

export function VenueScorecardSection() {
  const q = useQuery(venueScorecardQuery);
  const d = q.data;
  const rows = d?.rows ?? [];
  const sized = rows.filter((r) => r.pendingActions >= MIN_ACTIONS);
  const picks = sized.slice(0, PICK);
  const baseline = median(sized.map((r) => r.weightedFilings));
  const top = rows[0];
  // Chosen among the plotted districts, so the headline never names a district the chart does not draw.
  const busiest = [...picks]
    .filter((r) => r.weightedFilings !== null)
    .sort((a, b) => b.weightedFilings! - a.weightedFilings!)[0];
  const fcms = d?.fcmsPeriod ? `12 months to ${fmtDate(d.fcmsPeriod)}` : "latest FCMS period";
  const jpml = d?.jpmlAsOf ? fmtDate(d.jpmlAsOf) : "the latest JPML report";
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : !picks.length
        ? ({ kind: "empty", reason: "Pending MDL actions by district are not recorded." } as const)
        : ({ kind: "ready" } as const);
  const ageRows = picks.filter((r) => r.cvap && ageShares(r.cvap));
  const context =
    d && top
      ? buildSectionContext({
          id: "venue-scorecard",
          title: TITLE,
          scope: `Federal districts holding at least ${MIN_ACTIONS} pending MDL actions`,
          period: `JPML ${jpml}; FCMS ${fcms}; ACS 2020-2024`,
          source: `${SOURCES.jpml.label}; ${SOURCES.fcms.label}; ${SOURCES.cvap.label}`,
          figures: [
            { label: "Districts with pending MDL actions", value: rows.length, period: jpml },
            {
              label: "Median MDL district, weighted filings per judgeship",
              value: baseline,
              period: fcms,
            },
            ...picks.flatMap((r) => [
              { label: `${r.name}, pending MDL actions`, value: r.pendingActions, period: jpml },
              {
                label: `${r.name}, weighted filings per judgeship`,
                value: r.weightedFilings,
                period: fcms,
              },
              {
                label: `${r.name}, citizen voting-age population`,
                value: r.cvap?.cvap ?? null,
                period: "ACS 2020-2024",
              },
            ]),
          ],
          maxFigures: 24,
        })
      : null;

  return (
    <Section
      id="venue-scorecard"
      title="MDL venues and their jury pools"
      description="Pending MDL load, bench congestion and the citizen voting-age population of each transferee district."
    >
      <KpiGrid columns={4} label="MDL venue figures">
        <KpiCard
          as="li"
          label="Districts with pending MDL actions"
          value={d ? String(rows.length) : null}
          meta={`JPML report, ${jpml}`}
          state={q.isPending ? "loading" : undefined}
          source={{ source: { label: SOURCES.jpml.label, href: SOURCES.jpml.url } }}
        />
        <KpiCard
          as="li"
          label="Largest MDL district"
          value={top ? fmtInt(top.pendingActions) : null}
          unit="actions"
          meta={top ? `${top.name}, ${top.pendingMdls ?? "Not recorded"} MDLs` : undefined}
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Its citizen voting-age population"
          value={top?.cvap ? fmtInt(top.cvap.cvap) : null}
          meta={
            top?.cvap
              ? `${top.cvap.counties} counties · ACS 2020-2024${top.cvap.cvapMoe != null ? ` · ±${fmtInt(top.cvap.cvapMoe)}` : ""}`
              : undefined
          }
          state={q.isPending ? "loading" : undefined}
          source={{ source: { label: "U.S. Census Bureau, ACS B29001", href: SOURCES.cvap.url } }}
        />
        <KpiCard
          as="li"
          label="Busiest MDL bench"
          value={busiest?.weightedFilings != null ? fmtInt(busiest.weightedFilings) : null}
          unit="weighted filings per judgeship"
          meta={busiest ? `${busiest.name}, ${fcms} · among the ${picks.length} largest MDL districts` : undefined}
          state={q.isPending ? "loading" : undefined}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            busiest?.weightedFilings != null && baseline !== null
              ? `${busiest.name} carries ${fmtInt(busiest.weightedFilings)} weighted filings per judgeship; the median MDL district carries ${fmtInt(baseline)}`
              : "Weighted filings per judgeship in MDL districts"
          }
          subtitle={`Weighted filings per authorized judgeship · the ${PICK} districts with the most pending MDL actions · ${fcms}`}
          status={status}
          sources={[SOURCES.fcms, SOURCES.jpml]}
          period={fcms}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Weighted filings adjust raw filings for the judge time each kind of case usually
                takes (FCMS definition).
              </li>
              <li>
                The line is the median of the {sized.length} districts holding at least{" "}
                {MIN_ACTIONS} pending MDL actions.
              </li>
              <li>
                Pending MDL actions come from the JPML report of {jpml}; FCMS figures cover the{" "}
                {fcms}. The dates differ and are shown on each figure.
              </li>
            </ul>
          }
          actions={
            <AskAiButton sectionId="venue-scorecard" title={TITLE} context={context} size="icon" />
          }
          table={{
            caption: "MDL districts: load and congestion",
            columns: [
              { label: "District" },
              { label: `Pending MDL actions (${jpml})`, align: "right" },
              { label: "Weighted filings per judgeship", align: "right" },
              { label: "Civil cases over 3 years (%)", align: "right" },
            ],
            rows: picks.map((r) => ({
              key: r.courtId,
              cells: [
                r.name,
                fmtInt(r.pendingActions),
                nr(r.weightedFilings, fmtInt),
                nr(r.over3yPct, fmtOne),
              ],
            })),
          }}
          minHeight={320}
        >
          {baseline !== null ? (
            <DivergingDots
              items={picks.map((r) => ({ label: shortDistrict(r.name), value: r.weightedFilings }))}
              baseline={baseline}
              baselineLabel="Median MDL district"
              format={fmtInt}
              labelWidth={150}
            />
          ) : null}
        </ChartCard>
        <ChartCard
          variant="editorial"
          title="Age mix of the citizen voting-age population in MDL districts"
          subtitle="Share of citizens aged 18 and over, by age group · counties of each district · ACS 5-year 2020-2024"
          status={
            status.kind !== "ready"
              ? status
              : ageRows.length
                ? status
                : ({
                    kind: "empty",
                    reason: "Age groups are not recorded for these districts.",
                  } as const)
          }
          sources={[SOURCES.cvap, SOURCES.districts]}
          period="2020-2024"
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Citizen voting-age population is a proxy for the jury-eligible population; jury
                rules also exclude people for other reasons.
              </li>
              <li>
                Counties are added to a district only through the district the county profile
                records from 28 U.S.C. chapter 5
                {d
                  ? `; ${d.countiesWithoutDistrict} of ${d.counties} counties have none${d.countiesWithoutDistrictIds.length ? ` (county FIPS ${d.countiesWithoutDistrictIds.join(", ")})` : ""} and are left out`
                  : ""}
                .
              </li>
              <li>
                Many districts draw jurors by division; the data table lists the divisions recorded
                for each district.
              </li>
              <li>
                Estimates carry margins of error; district totals combine county margins by root sum
                of squares. A district missing any county estimate shows no age split.
              </li>
            </ul>
          }
          table={{
            caption: "Citizen voting-age population by district (ACS 2020-2024)",
            columns: [
              { label: "District" },
              { label: "CVAP", align: "right" },
              { label: "Margin of error (±)", align: "right" },
              ...AGE_TAGS.map((t) => ({ label: `${t.label} (%)`, align: "right" as const })),
            ],
            rows: picks.map((r) => {
              const s = r.cvap ? ageShares(r.cvap) : null;
              return {
                key: r.courtId,
                cells: [
                  r.name,
                  nr(r.cvap?.cvap ?? null, fmtInt),
                  nr(r.cvap?.cvapMoe ?? null, fmtInt),
                  ...AGE_TAGS.map((t) => nr(s ? s[t.key] : null, fmtOne)),
                ],
              };
            }),
          }}
          minHeight={320}
        >
          <VerdictStack
            subjects={ageRows.map((r) => ({
              id: r.courtId,
              label: shortDistrict(r.name),
              counts: {
                age18to29: r.cvap!.ages!.age18to29,
                age30to44: r.cvap!.ages!.age30to44,
                age45to64: r.cvap!.ages!.age45to64,
                age65plus: r.cvap!.ages!.age65plus,
              },
              n: r.cvap!.cvap,
            }))}
            taxonomy={[
              { group: "Age", tags: AGE_TAGS.map((t) => ({ key: t.key, label: t.label })) },
            ]}
            ariaLabel="Age mix of the citizen voting-age population in MDL districts"
            labelWidth={150}
          />
        </ChartCard>
      </div>
      <div className="mt-3 flex justify-end">
        <DataDrawer
          title="MDL transferee venues"
          description="Load, congestion and jury-eligible population for every district holding pending MDL actions."
          rows={rows}
          rowKey={(r) => r.courtId}
          searchable
          triggerLabel={`View all ${rows.length} districts`}
          columns={[
            {
              key: "court",
              label: "District",
              value: (r: ScorecardRow) => r.name,
              render: (r: ScorecardRow) => (
                <Link
                  to="/courts/$id"
                  params={{ id: r.courtId }}
                  className="text-primary hover:underline"
                >
                  {r.name}
                </Link>
              ),
            },
            {
              key: "pending",
              label: `Pending MDL actions (${jpml})`,
              align: "right",
              value: (r) => r.pendingActions,
            },
            { key: "mdls", label: "Pending MDLs", align: "right", value: (r) => r.pendingMdls },
            {
              key: "wf",
              label: "Weighted filings per judgeship",
              align: "right",
              value: (r) => r.weightedFilings,
            },
            {
              key: "o3",
              label: "Civil over 3 years (%)",
              align: "right",
              value: (r) => r.over3yPct,
            },
            {
              key: "trial",
              label: "Months to civil trial",
              align: "right",
              value: (r) => r.monthsToTrial,
            },
            {
              key: "vac",
              label: "Vacant judgeship months",
              align: "right",
              value: (r) => r.vacantMonths,
            },
            {
              key: "cvap",
              label: "CVAP (ACS 2020-2024)",
              align: "right",
              value: (r) => r.cvap?.cvap ?? null,
            },
            {
              key: "moe",
              label: "CVAP ± (approx.)",
              align: "right",
              value: (r) => r.cvap?.cvapMoe ?? null,
            },
            {
              key: "div",
              label: "Divisions recorded",
              value: (r) =>
                r.cvap?.divisions.length
                  ? r.cvap.divisions.map((x) => `${x.name} ${fmtInt(x.cvap)}`).join("; ")
                  : null,
            },
          ]}
          source={{
            source: [
              { label: SOURCES.jpml.label, href: SOURCES.jpml.url },
              { label: SOURCES.fcms.label, href: SOURCES.fcms.url },
              { label: SOURCES.cvap.label, href: SOURCES.cvap.url },
            ],
          }}
        />
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}

const nr = (v: number | null | undefined, f: (v: number) => string) =>
  v == null ? "Not recorded" : f(v);
