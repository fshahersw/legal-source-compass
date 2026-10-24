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
} from "@/components/courts/clb/ClbRestParts";
import {
  getBankruptcyFilings,
  type BankruptcyFilings,
  type BankruptcyPeriod,
} from "@/lib/external/judiciary.functions";
import { fmtDay, fmtN, fmtP, rankText } from "./judiciaryFormat";

const SOURCE =
  "https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present";
/** District courts and bankruptcy courts; the record is found by the court filter, so other ids simply show nothing. */
const ELIGIBLE = /^[a-z]{2,10}[db]$/;

const MEASURES = [
  {
    term: "Filed",
    means:
      "Cases filed in the fiscal year (October–September), by the chapter at filing (AO Table F-2 basis).",
  },
  {
    term: "Business",
    means:
      "Cases whose nature of debt is recorded as business; the rest are consumer (nonbusiness) or not recorded.",
    caveat:
      "FY2008 counts may differ slightly from the published FY2008 tables (FJC codebook note).",
  },
  {
    term: "Subch. V",
    means: "Chapter 11 small-business cases under Subchapter V.",
    caveat:
      "The IDB records the election only from the December 31, 2022 snapshot; earlier years show Not recorded.",
  },
  {
    term: "Pending",
    means: "Cases open at the end of the period.",
  },
  {
    term: "Jun 2026",
    means: "The 12 months ending June 30, 2026 (the latest snapshot), not a fiscal year.",
  },
];

/** Bankruptcy cases filed, closed and pending in a district (FJC Integrated Database, dataset fjc_bankruptcy_districts). */
export function BankruptcyFilingsPanel({ courtId }: { courtId: string }) {
  const enabled = ELIGIBLE.test(courtId);
  const q = useQuery({
    queryKey: ["judiciary-bankruptcy", courtId],
    queryFn: () => getBankruptcyFilings({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading bankruptcy filings" />;
  if (q.isError)
    return (
      <PanelError text="Bankruptcy filings could not be loaded." onRetry={() => void q.refetch()} />
    );
  if (!q.data) return null;
  return <Body p={q.data} courtId={courtId} />;
}

function Body({ p, courtId }: { p: BankruptcyFilings; courtId: string }) {
  const fiscal = p.series.filter((s) => /^\d{4}$/.test(s.period));
  const latest = fiscal.find((s) => s.period === "2025") ?? fiscal.at(-1) ?? null;
  const snapshot = p.series.find((s) => !/^\d{4}$/.test(s.period)) ?? null;
  const rows = fiscal.map((s) => ({ label: s.period, bar: s.filed, line: null }));
  const other =
    courtId === p.districtId
      ? p.bankruptcyCourtId
        ? { id: p.bankruptcyCourtId, text: "Bankruptcy court profile" }
        : null
      : { id: p.districtId, text: "District court profile" };
  return (
    <PanelShell
      title="Bankruptcy filings"
      subtitle={`Bankruptcy cases in the ${p.districtLabel ?? p.districtId} district, FY2008–June 2026`}
      record={{ dataset: "fjc_bankruptcy_districts", id: `district:${p.districtId}` }}
      aside={
        <>
          {other ? (
            <Link
              to="/courts/$id"
              params={{ id: other.id }}
              className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {other.text}
            </Link>
          ) : null}
          <SourceLink href={SOURCE}>Federal bankruptcy data</SourceLink>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-6">
        <Kpi
          label={`Cases filed, ${latest?.label ?? "FY2025"}`}
          value={fmtN(latest?.filed)}
          note={p.ranks.filed != null ? `rank ${rankText(p.ranks.filed, p.ranks.of)}` : undefined}
        />
        <Kpi label="Chapter 7" value={fmtN(latest?.ch7)} />
        <Kpi label="Chapter 13" value={fmtN(latest?.ch13)} />
        <Kpi
          label="Chapter 11"
          value={fmtN(latest?.ch11)}
          note={latest ? `${fmtN(latest.businessCh11)} business` : undefined}
        />
        <Kpi label="Business share" value={fmtP(latest?.businessSharePct)} />
        <Kpi
          label="Cases pending"
          value={fmtN((snapshot ?? latest)?.pendingEnd)}
          note={snapshot ? `on ${fmtDay(snapshot.period)}` : "at the end of the fiscal year"}
        />
      </div>
      <CollapsibleSection
        title="By fiscal year"
        summary={`FY${fiscal[0]?.period ?? ""}–FY${fiscal.at(-1)?.period ?? ""}`}
        defaultOpen
      >
        {rows.length ? (
          <ChartFrame
            caption="Bankruptcy cases filed per fiscal year"
            label={`Bar chart of bankruptcy cases filed per fiscal year in the ${p.districtLabel ?? p.districtId} district from FY${rows[0]!.label} to FY${rows.at(-1)!.label}.`}
          >
            <YearBarLine rows={rows} barName="Cases filed" />
          </ChartFrame>
        ) : null}
        <div className="mt-2">
          <MiniTable<BankruptcyPeriod>
            caption="Filings by chapter and type of debtor"
            rows={[...p.series].reverse()}
            rowKey={(r) => r.period}
            limit={6}
            noun="periods"
            columns={[
              { key: "p", label: "Period", render: (r) => r.label },
              { key: "f", label: "Filed", numeric: true, render: (r) => fmtN(r.filed) },
              { key: "c7", label: "Ch. 7", numeric: true, render: (r) => fmtN(r.ch7) },
              { key: "c11", label: "Ch. 11", numeric: true, render: (r) => fmtN(r.ch11) },
              { key: "c13", label: "Ch. 13", numeric: true, render: (r) => fmtN(r.ch13) },
              { key: "sv", label: "Subch. V", numeric: true, render: (r) => fmtN(r.subchapterV) },
              { key: "b", label: "Business", numeric: true, render: (r) => fmtN(r.business) },
              { key: "cl", label: "Closed", numeric: true, render: (r) => fmtN(r.closed) },
              { key: "pe", label: "Pending", numeric: true, render: (r) => fmtN(r.pendingEnd) },
            ]}
          />
        </div>
      </CollapsibleSection>
      <div className="px-3 pb-3 pt-2">
        <HowToRead
          measures={MEASURES}
          notes="Decoded with the FJC bankruptcy codebook; chapter codes follow the code set in force on the filing date (codes changed on October 17, 2005). FY2009–FY2025 total filings match AO Judicial Business Table F-2 for every bankruptcy court (Arkansas compared as one court, as F-2 reports it)."
        />
      </div>
    </PanelShell>
  );
}
