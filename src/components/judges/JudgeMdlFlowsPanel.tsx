import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getJudgeMdlFlows,
  type FlowEdge,
  type JudgeMdlFlows,
} from "@/lib/external/mdlNetwork.functions";

const n = (v: number | null | undefined) =>
  v === null || v === undefined ? "Not recorded" : v.toLocaleString("en-US");

/**
 * Cases this judge sent into MDLs and received as an MDL transferee judge (dataset judge_flows), shown only when the page's
 * CourtListener crosswalk links an exact person and that person appears in a flow.
 */
export function JudgeMdlFlowsPanel({ judgeId }: { judgeId: string }) {
  const q = useQuery({
    queryKey: ["judge-mdl-flows", judgeId],
    queryFn: () => getJudgeMdlFlows({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isPending)
    return (
      <div
        className="mb-5 h-20 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading MDL transfers"
      />
    );
  if (q.isError)
    return (
      <p role="alert" className="mb-5 text-xs text-muted-foreground">
        MDL transfers could not be loaded.{" "}
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  return q.data ? <Panel f={q.data} /> : null;
}

function EdgeList({ title, edges, empty }: { title: string; edges: FlowEdge[]; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? edges : edges.slice(0, 8);
  const total = edges.reduce((sum, e) => sum + e.dockets, 0);
  return (
    <div className="min-w-0">
      <p className="m-0 mb-1 text-[11px] text-muted-foreground">
        {title}
        {edges.length ? ` · ${n(edges.length)} judges, ${n(total)} dockets` : ""}
      </p>
      {edges.length ? (
        <>
          <table className="w-full text-[11.5px]">
            <thead className="sr-only">
              <tr>
                <th>Judge</th>
                <th>MDLs</th>
                <th>Dockets</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.other.personId} className="border-b border-border/50 last:border-0">
                  <td className="py-1 pr-2">
                    {e.other.link ? (
                      <Link
                        to="/records/$dataset/$id"
                        params={{ dataset: "clb_judge_dockets", id: String(e.other.personId) }}
                        className="text-primary hover:underline"
                      >
                        {e.other.name}
                      </Link>
                    ) : (
                      e.other.name
                    )}
                  </td>
                  <td className="py-1 pr-2 text-muted-foreground">
                    {e.mdls.map((m, i) => (
                      <span key={m}>
                        {i ? ", " : ""}
                        <Link
                          to="/matters/lens/$mdl"
                          params={{ mdl: String(m) }}
                          className="hover:text-foreground hover:underline"
                        >
                          MDL {m}
                        </Link>
                      </span>
                    ))}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">{n(e.dockets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {edges.length > 8 ? (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="mt-1 text-[11px] text-primary hover:underline"
              aria-expanded={all}
            >
              {all ? "Show fewer" : `Show all ${edges.length}`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-[11.5px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function Panel({ f }: { f: JudgeMdlFlows }) {
  const received = f.received.length > 0 || !!f.transferee;
  return (
    <section className="mb-5 rounded-xl border border-border bg-card shadow-xs" aria-label="MDL transfers">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="text-heading font-semibold text-foreground">
          MDL transfers{" "}
          <span className="font-normal text-muted-foreground">
            · judge to judge, by exact person
          </span>
        </h2>
        {f.transferee ? (
          <p className="m-0 text-xs text-muted-foreground">
            Transferee judge in{" "}
            {f.transferee.mdls.map((m, i) => (
              <span key={m}>
                {i ? ", " : ""}
                <Link
                  to="/matters/lens/$mdl"
                  params={{ mdl: String(m) }}
                  className="text-primary hover:underline"
                >
                  MDL {m}
                </Link>
              </span>
            ))}
            {f.transferee.actions !== null ? ` · ${n(f.transferee.actions)} member actions` : ""}
          </p>
        ) : null}
      </header>
      <div className={`grid gap-4 px-4 py-3 ${received && f.sent.length ? "md:grid-cols-2" : ""}`}>
        {received ? (
          <EdgeList
            title="Judges whose cases were transferred to this judge"
            edges={f.received}
            empty="No originating judge is recorded for the cases transferred in; most member cases are filed directly in the MDL court."
          />
        ) : null}
        {f.sent.length ? (
          <EdgeList
            title="MDL judges this judge's cases were transferred to"
            edges={f.sent}
            empty=""
          />
        ) : null}
      </div>
      <footer className="border-t border-border/70 px-4 py-2 text-[11px] leading-4 text-muted-foreground">
        A docket counts when the matter registry ties it to an MDL as an originating docket (JPML
 schedules, conditional transfer orders or federal records); judges are the CourtListener
 assignments on the originating and master dockets. Counts cover the MDLs the registry holds,
 not every transfer.
      </footer>
    </section>
  );
}
