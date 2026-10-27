import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import { ChartFrame, CollapsibleSection } from "@/components/courts/clb/ClbParts";
import { YearBarLine } from "@/components/courts/clb/ClbRestCharts";
import {
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
  type Column,
} from "@/components/courts/clb/ClbRestParts";
import {
  getAppealsOutcomes,
  type AppealsCell,
  type AppealsNature,
  type AppealsNos,
  type AppealsOrigin,
  type AppealsProfile,
} from "@/lib/external/judiciary.functions";
import { fmtN, fmtP, fyLabel, NR, rankText } from "./judiciaryFormat";

const SOURCE =
  "https://www.fjc.gov/research/idb/appellate-cases-filed-terminated-and-pending-fy-2008-present";
const LATEST = 2025;

const MEASURES = [
  {
    term: "Terminated",
    means: "Appeals and original proceedings closed in the fiscal year (October–September).",
  },
  {
    term: "Percent reversed",
    means:
      "Reversed ÷ appeals terminated on the merits, original proceedings excluded (AO Table B-5 rule).",
    caveat: "Shown only when at least 10 merits terminations are in the base.",
  },
  {
    term: "Affirmed",
    means: "Affirmed plus affirmed in part ÷ the same merits base, as Table B-5 counts them.",
  },
  {
    term: "Median days",
    means: "Median days from docketing to judgment over merits terminations.",
  },
  {
    term: "FY2026",
    means: "October 2025 to June 30, 2026 only (the latest public file).",
    caveat: "Not comparable with full fiscal years.",
  },
];

/** Court of appeals outcomes from the FJC Integrated Database: a circuit's appeals by origin, or how a district's appeals fared. */
export function AppealsOutcomesPanel({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["judiciary-appeals", courtId],
    queryFn: () => getAppealsOutcomes({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading) return <PanelLoading label="Loading appeal outcomes" />;
  if (q.isError)
    return (
      <PanelError text="Appeal outcomes could not be loaded." onRetry={() => void q.refetch()} />
    );
  if (!q.data || !q.data.series.length) return null;
  return <Body p={q.data} />;
}

const pctCol = <T extends AppealsCell>(label = "Reversed"): Column<T> => ({
  key: "rev",
  label,
  numeric: true,
  render: (r) => fmtP(r.reversedPct),
});
const cellCols = <T extends AppealsCell>(): Column<T>[] => [
  { key: "term", label: "Terminated", numeric: true, render: (r) => fmtN(r.terminated) },
  { key: "merits", label: "On the merits", numeric: true, render: (r) => fmtN(r.meritsAppeals) },
  pctCol<T>(),
  { key: "aff", label: "Affirmed", numeric: true, render: (r) => fmtP(r.affirmedPct) },
  {
    key: "days",
    label: "Median days",
    numeric: true,
    render: (r) => (r.medianDays == null ? NR : fmtN(r.medianDays)),
  },
];

function Body({ p }: { p: AppealsProfile }) {
  const latest = p.series.find((s) => s.fy === LATEST) ?? null;
  const rows = p.series.map((s) => ({
    label: s.partialYear ? `${s.fy}*` : String(s.fy),
    bar: s.terminated,
    line: s.medianDays,
  }));
  const circuit = p.kind === "circuit";
  const name = p.label ?? p.courtId;
  const originCols: Column<AppealsOrigin>[] = [
    {
      key: "origin",
      label: "Origin",
      render: (r) =>
        r.courtId ? (
          <Link
            to="/courts/$id"
            params={{ id: r.courtId }}
            className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {r.label}
          </Link>
        ) : (
          r.label
        ),
    },
    ...cellCols<AppealsOrigin>(),
  ];
  const natureCols: Column<AppealsNature>[] = [
    { key: "nature", label: "Nature of proceeding", render: (r) => r.label },
    ...cellCols<AppealsNature>(),
  ];
  const nosCols: Column<AppealsNos>[] = [
    { key: "nos", label: "Nature of suit", render: (r) => `${r.nos} ${r.label.toLowerCase()}` },
    ...cellCols<AppealsNos>(),
  ];
  return (
    <PanelShell
      title={circuit ? "Appeal outcomes" : "How this district's appeals fared"}
      subtitle={
        circuit
          ? `${name}: appeals terminated FY2008–June 2026, by origin and nature of proceeding · FJC Integrated Database`
          : `Appeals from the ${name} district decided by the court of appeals, FY2008–June 2026 · FJC Integrated Database`
      }
      record={{
        dataset: "fjc_appeals_outcomes",
        id: `${circuit ? "circuit" : "district"}:${p.courtId}`,
      }}
      aside={<SourceLink href={SOURCE}>Federal appeals data</SourceLink>}
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-5">
        <Kpi label="Terminated, FY2025" value={fmtN(latest?.terminated)} />
        <Kpi
          label="Percent reversed, FY2025"
          value={fmtP(latest?.reversedPct)}
          note={latest ? `of ${fmtN(latest.meritsAppeals)} merits terminations` : undefined}
        />
        <Kpi label="Affirmed, FY2025" value={fmtP(latest?.affirmedPct)} note="incl. in part" />
        <Kpi
          label="Median days to judgment, FY2025"
          value={latest?.medianDays == null ? NR : fmtN(latest.medianDays)}
        />
        {circuit ? (
          <Kpi label="Pending June 30, 2026" value={fmtN(p.pending)} />
        ) : (
          <Kpi
            label="Reversal rank in the circuit"
            value={rankText(p.reversalRank, p.rankedDistricts)}
            note="FY2021–FY2025, 1 = highest rate"
          />
        )}
      </div>
      {!circuit && p.window && p.circuitBase ? (
        <p className="px-3 pb-2 text-[11px] leading-4 text-muted-foreground">
          FY2021–FY2025: {fmtP(p.window.reversedPct)} of {fmtN(p.window.meritsAppeals)} merits
          terminations reversed, against {fmtP(p.circuitBase.reversedPct)} for all district-court
          appeals in the{" "}
          {p.circuitId ? (
            <Link
              to="/courts/$id"
              params={{ id: p.circuitId }}
              className="text-primary hover:underline"
            >
              circuit
            </Link>
          ) : (
            "circuit"
          )}
          . Rates differ with case mix (criminal, prisoner and civil appeals reverse at different
          rates).
        </p>
      ) : null}
      <CollapsibleSection
        title="By fiscal year"
        summary={`${p.series.length} years, FY${p.series[0]!.fy}–FY${p.series.at(-1)!.fy}`}
        defaultOpen
      >
        <ChartFrame
          caption="Appeals terminated per fiscal year, with the median days to judgment"
          label={`Bar chart of appeals terminated per fiscal year for ${name} from FY${p.series[0]!.fy}, with a line for median days from docketing to judgment.`}
          footnote="* FY2026 covers October 2025 to June 30, 2026 only."
        >
          <YearBarLine
            rows={rows}
            barName="Appeals terminated"
            lineName="Median days to judgment"
            lineUnit="days"
          />
        </ChartFrame>
        <div className="mt-2">
          <MiniTable
            caption="Outcomes by fiscal year"
            rowKey={(r) => String(r.fy)}
            rows={[...p.series].reverse()}
            limit={6}
            noun="years"
            columns={[
              { key: "fy", label: "Year", render: (r) => fyLabel(r.fy, r.partialYear) },
              ...cellCols<(typeof p.series)[number]>(),
            ]}
          />
        </div>
      </CollapsibleSection>
      {circuit && p.byOrigin.length ? (
        <CollapsibleSection
          title="By origin"
          summary={`${p.byOrigin.length} district courts, agencies and other origins, FY2021–FY2025`}
          defaultOpen
        >
          <MiniTable
            caption="Appeals by the court or agency appealed from, FY2021–FY2025"
            rows={p.byOrigin}
            rowKey={(r) => r.origin}
            columns={originCols}
            limit={12}
            noun="origins"
            note="Original proceedings (mandamus and similar petitions) are counted in terminated but not in the merits base."
          />
        </CollapsibleSection>
      ) : null}
      {p.byNature.length ? (
        <CollapsibleSection
          title="By nature of proceeding"
          summary={p.byNature
            .slice(0, 3)
            .map((n) => `${n.label} ${fmtN(n.terminated)}`)
            .join(" · ")}
        >
          <MiniTable
            caption="Appeals by nature of proceeding (AO Table B-5 groups), FY2021–FY2025"
            rows={p.byNature}
            rowKey={(r) => r.nature}
            columns={natureCols}
            noun="groups"
          />
        </CollapsibleSection>
      ) : null}
      {p.topNos.length ? (
        <CollapsibleSection title="Most frequent civil natures of suit" summary="FY2021–FY2025">
          <MiniTable
            caption="Civil and prisoner appeals by nature of suit, FY2021–FY2025"
            rows={p.topNos}
            rowKey={(r) => String(r.nos)}
            columns={nosCols}
            limit={8}
            noun="natures of suit"
          />
          <p className="mt-2 text-meta text-muted-foreground">
            Only the most frequent natures of suit are kept for each court, so a nature of suit
            missing here (for example product liability, 365 and 367) is not recorded, not zero.
            Product-liability reversal rates are not compared across circuits.
          </p>
        </CollapsibleSection>
      ) : null}
      <div className="px-3 pb-3 pt-2">
        <HowToRead
          measures={MEASURES}
          notes="Counts are of court of appeals docket records in the FJC Integrated Database appeals file (ap08on), decoded with the FJC appeals codebook. FY2025 totals for every circuit and nature of proceeding were checked against AO Judicial Business Table B-5 (terminated, merits and reversed match exactly). Federal Circuit appeals are not in this file."
        />
      </div>
    </PanelShell>
  );
}
