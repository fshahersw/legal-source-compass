/**
 * Corporate transactions on a company page: the FTC's HSR early termination notices naming the company as acquirer or
 * acquired party, by exact name key only. Useful for successor and spun-off entities; a gap is not evidence of no deal.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendColumns } from "@/components/charts/recharts";
import { DataDrawer, KpiCard, KpiGrid } from "@/components/kit";
import { getCompanyTransactions } from "@/lib/external/companyTransactions.functions";
import { dealsByYear } from "@/lib/external/companyTransactions";

const SOURCE = {
  label: "FTC HSR early termination notices",
  url: "https://www.ftc.gov/legal-library/browse/early-termination-notices",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const ROLE = { acquirer: "Acquirer", target: "Acquired party", both: "Both" } as const;

export const companyTransactionsQuery = (cik: string) => ({
  queryKey: ["company-transactions", cik],
  queryFn: () => getCompanyTransactions({ data: { cik } }),
  staleTime: 10 * 60 * 1000,
});

function span(years: number[]) {
  if (!years.length) return null;
  return years.length === 1 ? String(years[0]) : `${years[0]}–${years.at(-1)}`;
}

export function CorporateTransactions({ cik, name }: { cik: string; name: string }) {
  const q = useQuery(companyTransactionsQuery(cik));
  const d = q.data;
  const rows = d?.rows ?? [];
  const years = dealsByYear(rows);
  const suspended = span(d?.suspended ?? []);
  const asAcquirer = rows.filter((r) => r.role !== "target").length;
  const asTarget = rows.filter((r) => r.role !== "acquirer").length;
  const last = rows.find((r) => r.date)?.date ?? null;
  const gapCounts = (d?.suspended ?? [])
    .map((y) => `${y}: ${fmt(d?.calendar.find((c) => c.year === y)?.count ?? 0)}`)
    .join(", ");
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : d?.status === "shared_key"
        ? ({
            kind: "empty",
            reason: `Another profiled company has the same normalised name as ${name}, so notices are not matched to either.`,
          } as const)
        : !rows.length
          ? ({
              kind: "empty",
              reason: `No early termination notice names ${name} exactly (as acquirer or acquired party). Notices cover only filings granted early termination.`,
            } as const)
          : ({ kind: "ready" } as const);
  return (
    <section aria-label="Corporate transactions" className="space-y-3">
      <h3 className="text-label font-semibold text-foreground">Corporate transactions</h3>
      {rows.length ? (
        <KpiGrid columns={3} label="Corporate transaction figures">
          <KpiCard
            as="li"
            label="Notices as acquirer"
            value={fmt(asAcquirer)}
            meta="HSR early terminations, exact name"
            source={{ source: { label: SOURCE.label, href: SOURCE.url } }}
          />
          <KpiCard
            as="li"
            label="Notices as acquired party"
            value={fmt(asTarget)}
            meta="can be the seller's parent"
            source={{ source: { label: SOURCE.label, href: SOURCE.url } }}
          />
          <KpiCard
            as="li"
            label="Latest notice"
            value={last ?? "Not recorded"}
            source={{ source: { label: SOURCE.label, href: SOURCE.url } }}
          />
        </KpiGrid>
      ) : null}
      <ChartCard
        title={rows.length ? `${name} appears in ${fmt(rows.length)} early termination notices` : "Early termination notices"}
        subtitle="Notices per year by role · notices · exact normalised name match"
        status={status}
        sources={[SOURCE]}
        period={d?.firstDate && d.lastDate ? `${d.firstDate} to ${d.lastDate}` : undefined}
        notice={
          suspended ? (
            <p className="text-xs">
              Early termination grants were suspended in {suspended} ({gapCounts} notices across all
              filers), so few or no notices in those years reflect FTC policy, not a lack of deals.
            </p>
          ) : undefined
        }
        about={
          <>
            <p>
              A notice is the FTC&rsquo;s publication that early termination of the HSR waiting period
              was granted. It covers only filings granted early termination, so a year without
              notices is not evidence that no deal happened.
            </p>
            <p className="mt-2">
              Parties are matched to this company only when the party&rsquo;s name, normalised
              (case, punctuation and legal-form words such as Inc. removed), equals the
              company&rsquo;s and no other profiled company shares that key. Subsidiaries that file
              under their own names are not included. The acquired party can be the seller&rsquo;s
              parent.
            </p>
          </>
        }
        table={{
          caption: "Early termination notices per year",
          columns: [
            { label: "Year" },
            { label: "As acquirer", align: "right" },
            { label: "As acquired party", align: "right" },
          ],
          rows: [...years].reverse().map((y) => ({
            key: y.year,
            cells: [
              `${y.year}${d?.suspended.includes(Number(y.year)) ? " (grants suspended)" : ""}`,
              fmt(y.acquirer),
              fmt(y.target),
            ],
          })),
        }}
        actions={
          rows.length ? (
            <DataDrawer
              title={`Early termination notices naming ${name}`}
              rows={rows}
              rowKey={(r) => `${r.transaction}-${r.acquiring}-${r.acquired}`}
              triggerLabel={`View ${fmt(rows.length)} notices`}
              searchable
              columns={[
                { key: "date", label: "Date", value: (r) => r.date },
                { key: "role", label: "Role", value: (r) => ROLE[r.role] },
                { key: "acq", label: "Acquiring party (as published)", value: (r) => r.acquiring },
                { key: "tgt", label: "Acquired party (as published)", value: (r) => r.acquired },
                {
                  key: "tx",
                  label: "Transaction",
                  value: (r) => r.transaction,
                  render: (r) =>
                    r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {r.transaction}
                      </a>
                    ) : (
                      r.transaction
                    ),
                },
              ]}
              source={{ source: { label: SOURCE.label, href: SOURCE.url } }}
            />
          ) : null
        }
      >
        <TrendColumns
          rows={years}
          xKey="year"
          series={[
            { key: "acquirer", label: "As acquirer" },
            { key: "target", label: "As acquired party" },
          ]}
          format={fmt}
          stacked
          ariaLabel={`Early termination notices naming ${name}, per year`}
        />
      </ChartCard>
    </section>
  );
}
