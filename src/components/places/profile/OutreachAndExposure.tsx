/**
 * Two sections under a state's analysis views: the claimant-outreach profile (who lives in the state and its federal
 * districts) and the occupational-exposure screen (county sector employment beside OSHA inspection rates). Both use
 * published Census and OSHA figures only; shares describe residents, never claimants.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChartFrame, ScatterCorrelation, metricFormatter, type ChartStatus } from "@/components/charts";
import { AiSummary, AskAiButton, KpiCard, KpiGrid, Section, buildSectionContext, type FigureInput } from "@/components/kit";
import type { CountyRow } from "@/lib/external/countyAnalysis.functions";
import type { DistrictSummary } from "@/lib/external/placeAnalysisParse";
import { CBP_YEAR, getStatePeople } from "./stateProfile.functions";
import {
  EXPOSURE_SECTORS,
  OUTREACH_MEASURES,
  districtOutreach,
  exposureScreen,
  type SectorCode,
} from "./stateProfileModel";

const ACS_SOURCE = { label: "Census ACS 5-year estimates", url: "https://www.census.gov/programs-surveys/acs" };
const CBP_SOURCE = {
  label: `Census County Business Patterns ${CBP_YEAR}`,
  url: "https://www.census.gov/programs-surveys/cbp.html",
};
const OSHA_SOURCE = { label: "OSHA inspection data, FY2021-FY2025", url: "https://enforcedata.dol.gov/views/data_summary.php" };
const pct1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "Not recorded" : `${v.toFixed(1)}%`);
const int = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "Not recorded" : Math.round(v).toLocaleString("en-US");

export function OutreachAndExposure({
  usps,
  stateName,
  counties,
  districts,
}: {
  usps: string;
  stateName: string;
  /** Counties of the state with their district and OSHA metrics (getStateCountyAnalysis). */
  counties: CountyRow[] | null;
  districts: DistrictSummary[];
}) {
  const fn = useServerFn(getStatePeople);
  const q = useQuery({
    queryKey: ["state-people", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <>
      <Outreach stateName={stateName} q={q} counties={counties} districts={districts} />
      <Exposure usps={usps} stateName={stateName} q={q} counties={counties} />
    </>
  );
}

type PeopleQuery = ReturnType<typeof useQuery<Awaited<ReturnType<typeof getStatePeople>>>>;

function Outreach({
  stateName,
  q,
  counties,
  districts,
}: {
  stateName: string;
  q: PeopleQuery;
  counties: CountyRow[] | null;
  districts: DistrictSummary[];
}) {
  const st = q.data?.state ?? null;
  const courtByFips = useMemo(
    () => new Map((counties ?? []).flatMap((c) => (c.courtId ? [[c.id, c.courtId] as const] : []))),
    [counties],
  );
  const rolled = useMemo(
    () => (q.data ? districtOutreach(q.data.counties, courtByFips) : []),
    [q.data, courtByFips],
  );
  const name = new Map(districts.map((d) => [d.courtId, d.name]));
  const year = st?.year ?? null;
  const period = year ? `ACS ${year - 4}-${year}` : undefined;
  const figures: FigureInput[] = [
    ...OUTREACH_MEASURES.map((m) => ({
      label: `${stateName}: ${m.label} (share of ${m.universe})`,
      value: pct1(st?.shares[m.key]?.v),
      note: st?.shares[m.key]?.moe != null ? `MOE ±${st.shares[m.key]!.moe!.toFixed(1)} points` : undefined,
    })),
    ...rolled.flatMap((d) =>
      OUTREACH_MEASURES.map((m) => ({
        label: `${name.get(d.courtId) ?? d.courtId}: ${m.label}`,
        value: pct1(d.shares[m.key]?.v),
        note: d.shares[m.key]?.exact ? "population-weighted county shares" : "approximate: population-weighted",
      })),
    ),
  ];
  const context = st
    ? buildSectionContext({
        id: "outreach-profile",
        title: `Outreach profile of ${stateName}`,
        scope: `${stateName} and its federal districts`,
        period: period ?? null,
        source: ACS_SOURCE.label,
        figures,
        maxFigures: 30,
      })
    : null;
  const status: ChartStatus = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !st
        ? { kind: "empty", reason: "Not recorded for this state." }
        : { kind: "ready" };
  return (
    <Section
      id="outreach"
      title="Outreach profile"
      description="Who lives here, for notice and outreach planning. Shares of residents, not claimant counts."
      actions={<AskAiButton sectionId="outreach-profile" title="Outreach profile" context={context} size="icon" />}
    >
      <KpiGrid columns={5} label={`${stateName} outreach figures`}>
        {OUTREACH_MEASURES.map((m) => {
          const s = st?.shares[m.key];
          const derived = s && st?.pop != null && m.totalPopUniverse ? (s.v / 100) * st.pop : null;
          return (
            <KpiCard
              as="li"
              key={m.key}
              size="sm"
              label={m.label}
              value={s ? pct1(s.v) : null}
              meta={`${s?.moe != null ? `±${s.moe.toFixed(1)} pts · ` : ""}of ${m.universe}${period ? ` · ${period}` : ""}`}
              {...(derived != null ? { footnote: `≈ ${int(derived)} residents (derived: share × population)` } : {})}
              state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
            />
          );
        })}
      </KpiGrid>
      <ChartFrame
        title={`${stateName}'s federal districts`}
        unit="% of residents (population-weighted county shares)"
        period={period}
        sources={[ACS_SOURCE, { label: "Districts: 28 U.S.C. ch. 5 (county assignments)", url: "https://www.govinfo.gov/content/pkg/USCODE-2024-title28/html/USCODE-2024-title28-partI-chap5.htm" }]}
        status={status}
        headingLevel="h3"
        notes={[
          "District shares weight each county's published share by its total population. That is exact for residents 65 and over; for the other measures, whose ACS universes differ (civilian, 18+, 5+, households), it is approximate.",
          "Margins of error are published for the state and each county; a district roll-up has no published margin (Not recorded).",
          "Counties with no recorded district are left out of the district figures.",
        ]}
        table={{
          caption: "Outreach measures by federal district",
          columns: [
            { label: "District" },
            { label: "Counties", align: "right" },
            { label: "Residents", align: "right" },
            ...OUTREACH_MEASURES.map((m) => ({ label: m.label, align: "right" as const })),
          ],
          rows: rolled.map((d) => ({
            key: d.courtId,
            cells: [
              <Link key="l" to="/courts/$id" params={{ id: d.courtId }} className="text-primary hover:underline">
                {name.get(d.courtId) ?? d.courtId}
              </Link>,
              String(d.counties),
              int(d.pop),
              ...OUTREACH_MEASURES.map(
                (m) => `${pct1(d.shares[m.key]?.v)}${d.shares[m.key] && !d.shares[m.key]!.exact ? " (approx.)" : ""}`,
              ),
            ],
          })),
        }}
      >
        <table className="w-full min-w-[36rem] text-[12px]">
          <thead className="text-[10.5px] text-muted-foreground">
            <tr className="border-b border-border text-left">
              <th className="px-2 py-1 font-medium">Area</th>
              {OUTREACH_MEASURES.map((m) => (
                <th key={m.key} className="px-2 py-1 text-right font-medium">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            <tr>
              <th scope="row" className="px-2 py-1 text-left font-medium">
                {stateName} (published)
              </th>
              {OUTREACH_MEASURES.map((m) => (
                <td key={m.key} className="px-2 py-1 text-right font-mono tabular-nums">
                  {pct1(st?.shares[m.key]?.v)}
                </td>
              ))}
            </tr>
            {rolled.slice(0, 8).map((d) => (
              <tr key={d.courtId}>
                <th scope="row" className="px-2 py-1 text-left font-normal">
                  {name.get(d.courtId) ?? d.courtId}
                </th>
                {OUTREACH_MEASURES.map((m) => (
                  <td key={m.key} className="px-2 py-1 text-right font-mono tabular-nums">
                    {pct1(d.shares[m.key]?.v)}
                    {d.shares[m.key] && !d.shares[m.key]!.exact ? <span className="text-muted-foreground">*</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 px-2 text-[11px] text-muted-foreground">* approximate (population-weighted)</p>
      </ChartFrame>
      <AiSummary context={context} />
    </Section>
  );
}

const pctFmt = metricFormatter("percent");
const rateFmt = metricFormatter("rate_per_100k");

function Exposure({
  usps,
  stateName,
  q,
  counties,
}: {
  usps: string;
  stateName: string;
  q: PeopleQuery;
  counties: CountyRow[] | null;
}) {
  const [sector, setSector] = useState<SectorCode>("31-33");
  const sectorLabel = EXPOSURE_SECTORS.find((s) => s.code === sector)!.label;
  const osha = useMemo(
    () =>
      new Map(
        (counties ?? []).map((c) => [c.id, { rate: c.metrics["osha_rate"] ?? null, base: c.metrics["osha_5y"] ?? null }] as const),
      ),
    [counties],
  );
  const screen = useMemo(
    () => (q.data ? exposureScreen(q.data.cbp, osha, sector) : null),
    [q.data, osha, sector],
  );
  const status: ChartStatus =
    q.isPending || !counties
      ? { kind: "loading" }
      : q.isError
        ? { kind: "error", onRetry: () => void q.refetch() }
        : !screen || screen.points.length < 3
          ? { kind: "empty", reason: "Not recorded: too few counties have both figures." }
          : { kind: "ready" };
  const context = screen
    ? buildSectionContext({
        id: "exposure-screen",
        title: `${sectorLabel} employment and OSHA inspections in ${stateName}'s counties`,
        period: `CBP ${CBP_YEAR}; OSHA FY2021-FY2025`,
        source: `${CBP_SOURCE.label}; ${OSHA_SOURCE.label}`,
        figures: [
          { label: "Counties with both figures", value: screen.points.length },
          { label: "Counties left out (suppressed or not recorded)", value: screen.leftOut },
          { label: `Median county ${sectorLabel.toLowerCase()} share of employees`, value: pct1(screen.medianShare) },
          { label: "Median county OSHA inspections per 100,000 a year", value: screen.medianOsha, decimals: 1 },
          { label: "Counties above both medians", value: screen.above.length },
          ...screen.above.slice(0, 8).map((p) => ({
            label: `${p.name}`,
            value: `${pct1(p.share)} share, ${p.oshaRate.toFixed(1)} inspections per 100,000`,
            note: `${int(p.employees)} sector employees`,
          })),
        ],
      })
    : null;
  return (
    <Section
      id="exposure"
      title="Occupational-exposure screen"
      description="Counties with heavy sector employment and high OSHA inspection activity. A screen for outreach geography, not exposure evidence."
      actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Sector
            <select
              className="h-8 rounded-md border border-input bg-surface px-2 text-xs"
              value={sector}
              onChange={(e) => setSector(e.target.value as SectorCode)}
            >
              {EXPOSURE_SECTORS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label} (NAICS {s.code})
                </option>
              ))}
            </select>
          </label>
          <AskAiButton sectionId="exposure-screen" title="Exposure screen" context={context} size="icon" />
        </div>
      }
    >
      <ChartFrame
        title={`${sectorLabel} share of employees against OSHA inspections, by county`}
        subtitle={`Each dot a county · x: % of CBP ${CBP_YEAR} employees · y: inspections per 100,000 residents a year`}
        sources={[CBP_SOURCE, OSHA_SOURCE]}
        status={status}
        headingLevel="h3"
        kpis={
          screen
            ? [
                { label: "Counties with both figures", value: int(screen.points.length), detail: `${int(screen.leftOut)} left out` },
                { label: "Median sector share", value: pct1(screen.medianShare) },
                { label: "Median OSHA rate", value: screen.medianOsha == null ? "Not recorded" : screen.medianOsha.toFixed(1), detail: "per 100,000 a year" },
                { label: "Above both medians", value: int(screen.above.length) },
              ]
            : undefined
        }
        notes={[
          "Joined on the exact 5-digit county FIPS. CBP suppresses some sector cells to protect employers; those counties are left out, never read as zero.",
          "OSHA sites are placed in counties by ZIP (Census ZCTA file). Inspections reflect OSHA's targeting as well as hazards.",
          "A pattern across counties: it says nothing about any worker's exposure or injury.",
        ]}
        table={
          screen
            ? {
                caption: `Counties above both state medians (${sectorLabel})`,
                columns: [
                  { label: "County" },
                  { label: "Sector share", align: "right" },
                  { label: "Sector employees", align: "right" },
                  { label: "OSHA per 100,000 a year", align: "right" },
                  { label: "OSHA inspections, 5 years", align: "right" },
                ],
                rows: screen.above.map((p) => ({
                  key: p.fips,
                  cells: [
                    <Link
                      key="l"
                      to="/places/$state/$county"
                      params={{ state: usps, county: p.fips }}
                      search={{ tab: "counties" }}
                      className="text-primary hover:underline"
                    >
                      {p.name}
                    </Link>,
                    pct1(p.share),
                    int(p.employees),
                    p.oshaRate.toFixed(1),
                    int(p.oshaBase),
                  ],
                })),
              }
            : undefined
        }
      >
        {screen && screen.points.length >= 3 ? (
          <ScatterCorrelation
            points={screen.points.map((p) => ({ id: p.fips, label: p.name, x: p.share, y: p.oshaRate }))}
            xFormatter={pctFmt}
            yFormatter={rateFmt}
            xLabel={`${sectorLabel} share of employees`}
            yLabel="OSHA inspections per 100,000 a year"
            ariaLabel={`${sectorLabel} share against OSHA inspection rate, ${stateName} counties`}
            showFit={false}
            height={300}
          />
        ) : null}
      </ChartFrame>
      <AiSummary context={context} />
    </Section>
  );
}
