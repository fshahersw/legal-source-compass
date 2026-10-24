/**
 * Law & government's lead charts: Federal Register final and proposed rules by year (stacked, disjoint document
 * types), and bills introduced in each Congress split into those that became law and the rest. Titles are computed
 * from the latest complete period; unfinished periods are drawn faded and never used for a title.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import { blockStackRows, subsetStackRows } from "@/components/charts/d3/trendAlign";
import { formatCount, ordinal, type TrendBlockData } from "@/lib/analytics/trend";

function useBlock(id: string) {
  const q = useQuery(analyticsBlockQuery(id));
  const block: TrendBlockData | null = q.data?.status === "ok" ? q.data.data : null;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({
          kind: "error",
          message: "This chart could not be loaded.",
          onRetry: () => void q.refetch(),
        } as const)
      : !block
        ? ({ kind: "empty", reason: "This series has not been published yet." } as const)
        : ({ kind: "ready" } as const);
  return { block, status };
}

const congressLabel = (x: string) => (/^\d+$/.test(x) ? ordinal(Number(x)) : x);

export function LawHeadline() {
  const fr = useBlock("federal-register");
  const bills = useBlock("congress-bills");

  const frRows = fr.block ? blockStackRows(fr.block) : [];
  const frLast = [...frRows]
    .reverse()
    .find((r) => !r.partial && r.values["rules"] != null && r.values["proposed"] != null);
  const billRows = bills.block
    ? subsetStackRows(bills.block, "introduced", "law", congressLabel)
    : [];
  const billLast = [...billRows].reverse().find((r) => !r.partial && r.values["part"] != null);
  const billShare =
    billLast && billLast.values["part"] != null && billLast.values["rest"] != null
      ? billLast.values["part"] / (billLast.values["part"] + billLast.values["rest"])
      : null;

  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="law-headline">
      <ChartCard
        variant="editorial"
        title={
          frLast
            ? `${frLast.period}: ${formatCount(frLast.values["rules"])} final rules and ${formatCount(frLast.values["proposed"])} proposed rules`
            : "Federal Register rules published each year"
        }
        subtitle="Documents published in the Federal Register, by year and type"
        status={fr.status}
        sources={fr.block ? [fr.block.source] : []}
        period={fr.block?.period}
        about={fr.block ? <AboutNotes notes={fr.block.notes} /> : undefined}
        table={
          fr.block
            ? {
                caption: "Federal Register final and proposed rules by year",
                columns: [{ label: "Year" }, { label: "Final rules" }, { label: "Proposed rules" }],
                rows: frRows.map((r) => ({
                  key: r.period,
                  cells: [
                    `${r.period}${r.partial ? " (unfinished)" : ""}`,
                    r.values["rules"] ?? "Not recorded",
                    r.values["proposed"] ?? "Not recorded",
                  ],
                })),
              }
            : undefined
        }
        minHeight={320}
      >
        {frRows.length ? (
          <StackedBarsOverTime
            rows={frRows}
            keys={["rules", "proposed"]}
            labels={{ rules: "Final rules", proposed: "Proposed rules" }}
          />
        ) : null}
      </ChartCard>
      <ChartCard
        variant="editorial"
        title={
          billLast && billShare != null
            ? `${billLast.period} Congress: ${formatCount(billLast.values["part"])} of ${formatCount(
                billLast.values["part"]! + billLast.values["rest"]!,
              )} bills became law (${(billShare * 100).toFixed(1)}%)`
            : "Bills introduced in each Congress, and how many became law"
        }
        subtitle="Bills and joint resolutions introduced, by Congress"
        status={bills.status}
        sources={bills.block ? [bills.block.source] : []}
        period={bills.block?.period}
        about={bills.block ? <AboutNotes notes={bills.block.notes} /> : undefined}
        table={
          bills.block
            ? {
                caption: "Bills and joint resolutions introduced, by Congress",
                columns: [
                  { label: "Congress" },
                  { label: "Became law" },
                  { label: "Did not" },
                  { label: "Introduced" },
                ],
                rows: billRows.map((r) => ({
                  key: r.period,
                  cells: [
                    `${r.period}${r.partial ? " (still sitting)" : ""}`,
                    r.values["part"] ?? "Not recorded",
                    r.values["rest"] ?? "Not recorded",
                    r.values["part"] != null && r.values["rest"] != null
                      ? r.values["part"] + r.values["rest"]
                      : "Not recorded",
                  ],
                })),
              }
            : undefined
        }
        minHeight={320}
      >
        {billRows.length ? (
          <StackedBarsOverTime
            rows={billRows}
            keys={["part", "rest"]}
            labels={{ part: "Became law", rest: "Did not become law" }}
          />
        ) : null}
      </ChartCard>
    </div>
  );
}

function AboutNotes({ notes }: { notes: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
