import { compact } from "@/components/analysis/analysisFormat";
import { TableScroll } from "@/components/courts/caseload/CaseloadParts";
import type { CitationMatrix } from "@/lib/external/clbCollection.functions";
import { cn } from "@/lib/utils";
import { heat, int, NOT_RECORDED, pct, rowShares, sharePct } from "./collectionFormat";

/**
 * A matrix of citation links as a table with a faint heat tint per cell. Row shares divide each cell by its own row's
 * links in this table; a row with a missing cell has no shares. The diagonal (a court citing itself) is outlined.
 */
export function HeatTable({
  matrix,
  measure,
  caption,
  corner,
  shortHeader,
  withCourtTotals,
}: {
  matrix: CitationMatrix;
  measure: "share" | "count";
  caption: string;
  corner: string;
  shortHeader: (key: string) => string;
  /** Add each court's links made to all courts, and how much of that this table holds. */
  withCourtTotals: boolean;
}) {
  const shares = matrix.cells.map(rowShares);
  const colIndex = new Map(matrix.columns.map((c, j) => [c.key, j]));
  // Scale the tint by the largest share off the diagonal, so the diagonal cannot flatten everything else.
  let max = 0;
  shares.forEach((row, i) => {
    row.forEach((v, j) => {
      if (v != null && j !== colIndex.get(matrix.rows[i]!.key) && v > max) max = v;
    });
  });
  const rowSum = matrix.cells.map((r) =>
    r.some((c) => c == null) ? null : (r as number[]).reduce((a, b) => a + b, 0),
  );
  return (
    <TableScroll label={caption} maxHeight="max-h-[30rem]">
      <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-[11px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th
              scope="col"
              className="sticky left-0 top-0 z-20 bg-surface px-2 py-1.5 text-left font-medium shadow-[inset_0_-1px_0_var(--border)]"
            >
              {corner}
            </th>
            {matrix.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                title={c.label}
                className="sticky top-0 z-10 max-w-[4.5rem] bg-surface px-1 py-1.5 text-right align-bottom text-[10px] font-medium leading-3 shadow-[inset_0_-1px_0_var(--border)]"
              >
                {shortHeader(c.key)}
              </th>
            ))}
            <th
              scope="col"
              title="Links from the row court to the columns shown"
              className="sticky top-0 z-10 bg-surface px-2 py-1.5 text-right align-bottom font-medium shadow-[inset_0_-1px_0_var(--border)]"
            >
              Links shown
            </th>
            {withCourtTotals ? (
              <>
                <th
                  scope="col"
                  title="All the citation links the row makes that resolve to a court, including links to columns not shown"
                  className="sticky top-0 z-10 bg-surface px-2 py-1.5 text-right align-bottom font-medium shadow-[inset_0_-1px_0_var(--border)]"
                >
                  All links made
                </th>
                <th
                  scope="col"
                  title="Share of all the row's links that land in the columns shown"
                  className="sticky top-0 z-10 bg-surface px-2 py-1.5 text-right align-bottom font-medium shadow-[inset_0_-1px_0_var(--border)]"
                >
                  Shown, %
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r, i) => (
            <tr key={r.key}>
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1 text-left font-medium shadow-[inset_-1px_0_0_var(--border)]"
              >
                {r.label}
              </th>
              {matrix.columns.map((c, j) => {
                const count = matrix.cells[i]?.[j] ?? null;
                const share = shares[i]?.[j] ?? null;
                const shown = measure === "share" ? share : count;
                const t = heat(share, max);
                const diagonal = colIndex.get(r.key) === j;
                return (
                  <td
                    key={c.key}
                    title={`${r.label} citing ${c.label}: ${count == null ? NOT_RECORDED : `${int(count)} links`}${share == null ? "" : `, ${pct(share)} of the row's links shown`}`}
                    className={cn(
                      "relative px-1 py-1 text-right font-mono tabular-nums",
                      diagonal && "font-semibold shadow-[inset_0_0_0_1px_var(--border-strong)]",
                    )}
                    style={
                      t.alpha
                        ? {
                            backgroundColor: `color-mix(in oklab, var(--primary) ${t.alpha}%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    <span className="sr-only">
                      {r.label} citing {c.label}:{" "}
                    </span>
                    {shown == null ? "–" : measure === "share" ? shown.toFixed(1) : compact(shown)}
                    {t.bar ? (
                      <span
                        aria-hidden
                        className="absolute bottom-px left-1 h-0.5 rounded-sm bg-primary/60"
                        style={{ width: `calc(${t.bar}% - 0.5rem)` }}
                      />
                    ) : null}
                  </td>
                );
              })}
              <td className="px-2 py-1 text-right font-mono tabular-nums">
                {rowSum[i] == null ? NOT_RECORDED : int(rowSum[i])}
              </td>
              {withCourtTotals ? (
                <>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {r.total == null ? NOT_RECORDED : int(r.total)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {r.total == null || rowSum[i] == null
                      ? NOT_RECORDED
                      : pct(sharePct(rowSum[i], r.total))}
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
