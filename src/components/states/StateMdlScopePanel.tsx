import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Network } from "lucide-react";
import {
  getStateMdlScope,
  type ScopeTest,
  type StateMdlScope,
} from "@/lib/external/mdlNetwork.functions";

const n = (v: number | null | undefined) =>
  v === null || v === undefined ? "Not recorded" : v.toLocaleString("en-US");
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;
/** Lower-cases a leading capital unless it starts an acronym (GDP, CFPB). */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** MDL dockets first filed in this state's federal courts and then transferred (dataset mdl_state_scope). */
export function StateMdlScopePanel({ usps }: { usps: string }) {
  const fn = useServerFn(getStateMdlScope);
  const q = useQuery({
    queryKey: ["state-mdl-scope", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section className="resource-panel" aria-label="MDL cases that started here">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-heading font-semibold text-foreground">
          <Network className="size-4" aria-hidden />
          MDL cases that started here
        </h2>
        <span className="text-[11px] text-muted-foreground">Matter registry</span>
      </div>
      {q.isPending ? (
        <p role="status" aria-busy="true" className="px-3 py-5 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.isError ? (
        <p role="alert" className="px-3 py-4 text-xs text-muted-foreground">
          MDL origins could not load.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : q.data ? (
        <Body s={q.data} />
      ) : (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No MDL origin record for this state.
        </p>
      )}
    </section>
  );
}

function Body({ s }: { s: StateMdlScope }) {
  const holding = s.tests.filter((t) => t.holds);
  return (
    <div className="space-y-3 px-3 py-3 text-xs">
      {s.dockets ? (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-[11px] text-muted-foreground">Dockets transferred into MDLs</dt>
              <dd className="m-0 font-mono text-base font-semibold">{n(s.dockets)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Per 100,000 residents</dt>
              <dd className="m-0 font-mono text-base font-semibold">
                {s.per100k === null ? "Not recorded" : s.per100k.toFixed(2)}
              </dd>
              {s.rankPer100k ? (
                <dd className="m-0 text-[10.5px] text-muted-foreground">
                  rank {s.rankPer100k} of {s.rankedStates}
                  {s.populationYear ? ` · population ${s.populationYear}` : ""}
                </dd>
              ) : null}
            </div>
          </dl>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {s.mdls.slice(0, 8).map((m) => (
              <li key={m.mdl} className="flex items-baseline justify-between gap-2">
                <Link
                  to="/matters/lens/$mdl"
                  params={{ mdl: String(m.mdl) }}
                  className="text-primary hover:underline"
                >
                  MDL {m.mdl}
                </Link>
                <span className="font-mono tabular-nums text-muted-foreground">{n(m.dockets)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="m-0 text-muted-foreground">
          The registry records no docket first filed in this state's federal courts and transferred
          into an MDL it holds.
        </p>
      )}
      {s.tests.length ? (
        <details className="rounded border border-border/70 px-2 py-1.5">
          <summary className="cursor-pointer text-[11.5px]">
            Across states:{" "}
            {holding.length === 1
              ? `of ${s.tests.length} metrics tested, only ${lowerFirst(holding[0]!.label.split(" (")[0]!)} holds (rho ${signed(holding[0]!.rho)})`
              : holding.length
                ? `${holding.length} of ${s.tests.length} associations tested hold`
                : `none of ${s.tests.length} associations tested holds`}
          </summary>
          <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
            {s.tests.map((t) => (
              <TestRow key={t.key} t={t} />
            ))}
          </ul>
          <p className="m-0 mt-1.5 text-[10.5px] leading-4 text-muted-foreground">
            Spearman rank correlations of originating dockets per resident with each state metric;
            95% Fisher intervals, permutation p and Benjamini-Hochberg adjustment across the tests.
            Associations, not causes; origin counts follow where cases were filed before transfer
            and which MDLs the registry holds.
          </p>
        </details>
      ) : null}
    </div>
  );
}

function TestRow({ t }: { t: ScopeTest }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <span className={t.holds ? "font-medium" : "text-muted-foreground"}>{t.label}</span>
      <span className="text-right font-mono tabular-nums">
        {signed(t.rho)}
        <span className="block text-[10px] text-muted-foreground">
          {t.ci ? `${signed(t.ci[0])} to ${signed(t.ci[1])}` : ""}
          {t.pBh !== null ? ` · adj. p ${t.pBh.toFixed(3)}` : ""}
          {` · n ${t.n}`}
        </span>
      </span>
    </li>
  );
}
