import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { getStateCodeCoverage, listStateCodes } from "@/lib/law/stateCode.functions";
import { showRecorded } from "@/lib/law/stateCodeContract";

const STATUS_ORDER = { captured: 0, "landed-private": 1, "not yet captured": 2 } as const;

/** Per-state full-code status from corpus_publisher_code_coverage_v2. */
export function StateCodeCoverage() {
  const coverageFn = useServerFn(getStateCodeCoverage);
  const listFn = useServerFn(listStateCodes);
  const coverage = useQuery({
    queryKey: ["state-code-coverage"],
    queryFn: () => coverageFn(),
    staleTime: 0,
  });
  const codes = useQuery({
    queryKey: ["full-state-codes"],
    queryFn: () => listFn(),
    staleTime: 0,
  });
  const readable = new Set((codes.data ?? []).map((row) => row.state));
  const rows = [...(coverage.data ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );
  const counts = {
    captured: rows.filter((row) => row.status === "captured").length,
    private: rows.filter((row) => row.status === "landed-private").length,
    missing: rows.filter((row) => row.status === "not yet captured").length,
  };

  return (
    <section className="space-y-3" aria-label="Full state code coverage">
      <h2 className="eyebrow">Full state codes</h2>
      <p className="max-w-3xl text-[13px] text-muted-foreground">
        Status comes from the state-code coverage record. Captured means the state's review flag
        allows the public code browser. Landed-private means the text is in the private intake and
        is not shown. Not yet captured means that record has no row for the state.
      </p>
      {coverage.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Loading state-code coverage…</p>
      ) : null}
      {coverage.error ? <ExternalError error={coverage.error} /> : null}
      {coverage.data ? (
        <>
          <p className="text-[12px] text-muted-foreground">
            {counts.captured.toLocaleString()} captured · {counts.private.toLocaleString()}{" "}
            landed-private · {counts.missing.toLocaleString()} not yet captured
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">Sections</th>
                  <th className="px-3 py-2">Publisher</th>
                  <th className="px-3 py-2">Edition</th>
                  <th className="px-3 py-2">Currency</th>
                  <th className="px-3 py-2">Browser</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.state} className="border-t border-border">
                    <td className="px-3 py-1.5">{row.name}</td>
                    <td className="px-3 py-1.5">{row.status}</td>
                    <td className="px-3 py-1.5">{showRecorded(row.reviewStatus)}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">
                      {row.sections == null ? "Not recorded" : row.sections.toLocaleString()}
                    </td>
                    <td
                      className="max-w-[16rem] truncate px-3 py-1.5"
                      title={row.publisher ?? undefined}
                    >
                      {showRecorded(row.publisher)}
                    </td>
                    <td
                      className="max-w-[16rem] truncate px-3 py-1.5"
                      title={row.edition ?? undefined}
                    >
                      {showRecorded(row.edition)}
                    </td>
                    <td className="px-3 py-1.5">{showRecorded(row.currency)}</td>
                    <td className="px-3 py-1.5">
                      {readable.has(row.state) ? (
                        <Link
                          to="/law/codes/$state"
                          params={{ state: row.state }}
                          search={{ q: "" }}
                          className="text-primary underline"
                        >
                          Open
                        </Link>
                      ) : (
                        "Not in the browser"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
