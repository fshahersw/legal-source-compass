import { useQuery } from "@tanstack/react-query";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import { ChartFrame, CollapsibleSection, ShareBars } from "@/components/courts/clb/ClbParts";
import { YearBarLine } from "@/components/courts/clb/ClbRestCharts";
import {
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
} from "@/components/courts/clb/ClbRestParts";
import {
  getCriminalCaseload,
  type CriminalProfile,
  type CriminalYear,
} from "@/lib/external/judiciary.functions";
import { fmtN, fmtP, fyLabel, NR, rankText } from "./judiciaryFormat";

const SOURCE =
  "https://www.fjc.gov/research/idb/criminal-defendants-filed-terminated-and-pending-fy-1996-present";
const LATEST = 2025;
const DISTRICT = /^[a-z]{2,6}d$/;

const MEASURES = [
  {
    term: "Defendants",
    means:
      "Counts are of defendants, not cases; a case with three defendants counts three. Filed and terminated include transfers (AO Table D).",
  },
  {
    term: "Convicted",
    means:
      "Convicted by plea, bench trial or jury trial ÷ defendants disposed (terminated other than by transfer).",
  },
  { term: "By plea", means: "Convicted by guilty or nolo contendere plea ÷ convicted." },
  {
    term: "Prison",
    means: "Sentenced to prison (including prison plus probation) ÷ convicted.",
    caveat:
      "AO Table D-5 also counts some sealed sentences as prison; FY2025 national prison count here is 69,487 against 69,705 in D-5.",
  },
  {
    term: "FY2026",
    means: "October 2025 to June 30, 2026 only.",
    caveat: "Not comparable with full fiscal years.",
  },
];

/** Criminal defendants in a district court from the FJC Integrated Database (dataset fjc_criminal_districts). */
export function CriminalCaseloadPanel({ courtId }: { courtId: string }) {
  const enabled = DISTRICT.test(courtId);
  const q = useQuery({
    queryKey: ["judiciary-criminal", courtId],
    queryFn: () => getCriminalCaseload({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading criminal caseload" />;
  if (q.isError)
    return (
      <PanelError text="Criminal caseload could not be loaded." onRetry={() => void q.refetch()} />
    );
  if (!q.data) return null;
  return <Body p={q.data} />;
}

function Body({ p }: { p: CriminalProfile }) {
  const latest = p.series.find((s) => s.fy === LATEST) ?? null;
  const first = p.series[0]!;
  const rows = p.series.map((s) => ({
    label: s.partialYear ? `${s.fy}*` : String(s.fy),
    bar: s.filed,
    line: s.medianPrisonMonths,
  }));
  const disposedWindow = p.offenses.reduce((a, o) => a + o.disposed, 0);
  return (
    <PanelShell
      title="Criminal caseload"
      subtitle={`Criminal defendants in the ${p.label ?? p.courtId} district, FY1996–June 2026 · FJC Integrated Database`}
      record={{ dataset: "fjc_criminal_districts", id: `district:${p.courtId}` }}
      aside={<SourceLink href={SOURCE}>FJC criminal data</SourceLink>}
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-6">
        <Kpi
          label="Defendants filed, FY2025"
          value={fmtN(latest?.filed)}
          note={p.ranks.filed != null ? `rank ${rankText(p.ranks.filed, p.ranks.of)}` : undefined}
        />
        <Kpi label="Terminated, FY2025" value={fmtN(latest?.terminated)} />
        <Kpi
          label="Convicted, FY2025"
          value={fmtP(latest?.convictionPct)}
          note={
            latest ? `${fmtN(latest.convicted)} of ${fmtN(latest.disposed)} disposed` : undefined
          }
        />
        <Kpi label="Convicted by plea, FY2025" value={fmtP(latest?.pleaPct)} />
        <Kpi label="Prison sentences, FY2025" value={fmtP(latest?.prisonPct)} note="of convicted" />
        <Kpi
          label="Median prison term, FY2025"
          value={latest?.medianPrisonMonths == null ? NR : `${latest.medianPrisonMonths} months`}
        />
      </div>
      <CollapsibleSection
        title="By fiscal year"
        summary={`FY${first.fy}–FY${p.series.at(-1)!.fy}`}
        defaultOpen
      >
        <ChartFrame
          caption="Defendants filed per fiscal year, with the median prison term"
          label={`Bar chart of criminal defendants filed per fiscal year in the ${p.label ?? p.courtId} district from FY${first.fy}, with a line for the median prison term in months.`}
          footnote="* FY2026 covers October 2025 to June 30, 2026 only."
        >
          <YearBarLine
            rows={rows}
            barName="Defendants filed"
            lineName="Median prison term"
            lineUnit="months"
          />
        </ChartFrame>
        <div className="mt-2">
          <MiniTable<CriminalYear>
            caption="Dispositions and sentences by fiscal year"
            rows={[...p.series].reverse()}
            rowKey={(r) => String(r.fy)}
            limit={6}
            noun="years"
            columns={[
              { key: "fy", label: "Year", render: (r) => fyLabel(r.fy, r.partialYear) },
              { key: "filed", label: "Filed", numeric: true, render: (r) => fmtN(r.filed) },
              { key: "disp", label: "Disposed", numeric: true, render: (r) => fmtN(r.disposed) },
              { key: "plea", label: "Plea", numeric: true, render: (r) => fmtN(r.plea) },
              {
                key: "trial",
                label: "Trial convictions",
                numeric: true,
                render: (r) => fmtN(r.convictedBench + r.convictedJury),
              },
              { key: "acq", label: "Acquitted", numeric: true, render: (r) => fmtN(r.acquitted) },
              { key: "dis", label: "Dismissed", numeric: true, render: (r) => fmtN(r.dismissed) },
              { key: "prison", label: "Prison", numeric: true, render: (r) => fmtP(r.prisonPct) },
              { key: "pend", label: "Pending", numeric: true, render: (r) => fmtN(r.pending) },
            ]}
          />
        </div>
      </CollapsibleSection>
      {p.offenses.length ? (
        <CollapsibleSection
          title="By offense category"
          summary={`FY2021–FY2025, ${fmtN(disposedWindow)} defendants disposed`}
        >
          <MiniTable
            caption="Defendants disposed by offense category, FY2021–FY2025"
            rows={p.offenses}
            rowKey={(r) => r.group}
            noun="categories"
            columns={[
              { key: "label", label: "Offense category", render: (r) => r.label },
              { key: "disp", label: "Disposed", numeric: true, render: (r) => fmtN(r.disposed) },
              {
                key: "conv",
                label: "Convicted",
                numeric: true,
                render: (r) => fmtN(r.convicted),
              },
              { key: "plea", label: "By plea", numeric: true, render: (r) => fmtP(r.pleaPct) },
              { key: "prison", label: "Prison", numeric: true, render: (r) => fmtP(r.prisonPct) },
              {
                key: "months",
                label: "Median months",
                numeric: true,
                render: (r) => (r.medianPrisonMonths == null ? NR : String(r.medianPrisonMonths)),
              },
            ]}
            note="Categories group the AO offense codes by their published descriptions (rules in the dataset summary); the most serious offense at termination decides the category."
          />
        </CollapsibleSection>
      ) : null}
      {p.counsel.length || p.topCodes.length ? (
        <CollapsibleSection title="Counsel and offense codes" summary="FY2021–FY2025">
          <div className="grid gap-4 md:grid-cols-2">
            <ShareBars
              heading="Type of counsel at termination"
              rows={p.counsel.map((c) => ({
                key: c.label,
                label: c.label,
                count: c.disposed,
                sharePct: c.sharePct,
              }))}
              note="Share of defendants disposed with the counsel type recorded."
            />
            <ShareBars
              heading="Most frequent offense codes"
              rows={p.topCodes.map((c) => ({
                key: c.code,
                label: `${c.code} ${c.label.toLowerCase()}`,
                count: c.disposed,
                sharePct: null,
              }))}
              note="Defendants disposed, by the AO code of the most serious offense at termination."
            />
          </div>
        </CollapsibleSection>
      ) : null}
      <div className="px-3 pb-3 pt-2">
        <HowToRead
          measures={MEASURES}
          notes="Decoded with the FJC criminal codebook (FY1996 forward). FY2025 filed, terminated and pending for all 94 districts match AO Judicial Business Table D exactly; national dispositions match Table D-4."
        />
      </div>
    </PanelShell>
  );
}
