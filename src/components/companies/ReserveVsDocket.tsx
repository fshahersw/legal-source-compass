/**
 * Reserve vs docket for one company: its company-wide litigation accrual (XBRL, quarter-end balances) against the
 * pending actions of the MDLs its own filings name it a defendant in (MDL-wide), both rebased to a quarter the reader
 * chooses. Tier C MDLs are drawn as their own line, labelled "requires review", and never added to the counted docket.
 */
import { useMemo } from "react";
import { IndexChart } from "@/components/charts/d3/charts";
import { ChartCard } from "@/components/charts/recharts";
import { AiSummary, AskAiButton, buildSectionContext } from "@/components/kit";
import { money, type CompanyDetail } from "./companyData";
import { reserveDocketSeries, sumSeries } from "./exposure";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SOURCES = [
  { label: "SEC XBRL company facts", url: "https://www.sec.gov/edgar/sec-api-documentation" },
  { label: "JPML pending MDL reports", url: "https://www.jpml.uscourts.gov/pending-mdls-0" },
];

export function ReserveVsDocket({ d }: { d: CompanyDetail }) {
  const f = d.financials;
  const pending = d.links.filter((l) => l.status === "pending");
  const counted = sumSeries(pending.filter((l) => l.countsTowardExposure).map((l) => l.series));
  const tierC = sumSeries(
    pending
      .filter(
        (l) => !l.countsTowardExposure && l.tier === "C" && l.role === "defendant" && !l.dismissed,
      )
      .map((l) => l.series),
  );
  const built = reserveDocketSeries(f?.quarterly.litigation_accrual ?? [], counted, tierC);
  const accrual = built.series.find((s) => s.id === "accrual");
  const withAccrual = accrual?.points.filter((p) => p.value !== null) ?? [];
  const dates = accrual?.points.map((p) => p.date) ?? [];
  const firstBoth = dates.findIndex(
    (dt, i) => built.series.every((s) => (s.points[i]?.value ?? 0) > 0) && dt.length > 0,
  );
  const ready = built.series.length >= 2 && withAccrual.length >= 2;
  const period = dates.length ? `${dates[0]} to ${dates.at(-1)}` : undefined;
  const seriesKey = JSON.stringify(built.series);
  const context = useMemo(
    () =>
      ready
        ? buildSectionContext({
            title: `${d.summary.profile.name}: reserve vs docket`,
            scope: "Company-wide litigation accrual and MDL-wide pending actions at quarter ends",
            period: period ?? null,
            source: "SEC XBRL company facts; JPML pending MDL reports",
            figures: built.series.flatMap((s) =>
              s.points.map((p) => ({
                label: s.label,
                value:
                  p.value === null ? null : s.id === "accrual" ? money(p.value, "USD") : p.value,
                period: p.date,
              })),
            ),
            maxFigures: 60,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the series content, rebuilt each render
    [ready, seriesKey, d.summary.profile.name, period],
  );
  if (!f) return null;
  return (
    <section aria-label="Reserve vs docket" className="space-y-2">
      <ChartCard
        variant="editorial"
        id="reserve-docket"
        title="Is the reserve keeping pace with the docket?"
        subtitle={`Change since the chosen quarter · % · accrual ${built.concept ?? "concept not recorded"} (USD), pending actions MDL-wide`}
        sources={SOURCES}
        period={period}
        status={
          ready
            ? { kind: "ready" }
            : {
                kind: "empty",
                reason:
                  built.concept === null && (f.quarterly.litigation_accrual.length ?? 0) > 0
                    ? "The quarterly accrual uses more than one XBRL concept or unit, so it is not drawn as one series."
                    : !counted.length && !tierC.length
                      ? "No pending MDL with a monthly JPML series is linked to this company."
                      : "Fewer than two quarter-end accrual balances fall in the JPML series window (from October 2024).",
              }
        }
        actions={<AskAiButton sectionId="reserve-docket" context={context} size="icon" />}
        about={
          <>
            <p>
              Each line is rebased to the quarter chosen with the slider: 0% means unchanged since
              then. The accrual is the company&rsquo;s whole loss-contingency or litigation balance
              at each quarter end (one XBRL concept), not a reserve for these MDLs.
            </p>
            <p className="mt-2">
              Pending actions are the JPML report dated in the first week after each quarter end,
              summed over the MDLs whose tier A or B evidence reads the company as a defendant. They
              are the whole dockets, shared with every co-defendant. Tier C MDLs are a separate line
              and are never counted. A quarter with no balance filed is left as a gap.
            </p>
          </>
        }
        table={{
          caption: "Quarter-end accrual and pending actions",
          columns: [
            { label: "Quarter end" },
            ...built.series.map((s) => ({ label: s.label, align: "right" as const })),
          ],
          rows: dates.map((dt, i) => ({
            key: dt,
            cells: [
              dt,
              ...built.series.map((s) => {
                const v = s.points[i]?.value ?? null;
                return v === null
                  ? "Not recorded"
                  : s.id === "accrual"
                    ? money(v, "USD")
                    : v.toLocaleString("en-US");
              }),
            ],
          })),
        }}
      >
        {ready ? (
          <IndexChart
            series={built.series}
            initialIndex={Math.max(0, firstBoth)}
            formatDate={(dt) => {
              const [y, m] = dt.split("-");
              return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
            }}
          />
        ) : null}
      </ChartCard>
      <AiSummary context={context} />
    </section>
  );
}
