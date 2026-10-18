import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { getMdlIntel, type MdlIntel as Data } from "@/lib/external/mdlIntel.functions";
import { courtPageYield } from "@/lib/external/mdlIntelView";
import { CentralizationTrends } from "./CentralizationTrends";
import { Concentration } from "./Concentration";
import { CourtPageIndex } from "./CourtPageIndex";
import { HearingOutcomes } from "./HearingOutcomes";
import { n, pct, signed, title } from "./intelFormat";

export const mdlIntelQuery = {
  queryKey: ["mdl-intel"],
  queryFn: () => getMdlIntel(),
  staleTime: 10 * 60 * 1000,
};

/** /matters/intel — JPML statistics, hearing outcomes, concentration and the products-liability court-page index. */
export function MdlIntel() {
  const q = useQuery(mdlIntelQuery);
  if (q.isLoading) return <Skeleton />;
  if (q.isError)
    return (
      <Notice tone="error">
        MDL intelligence could not be loaded. {q.error instanceof Error ? q.error.message : ""}
      </Notice>
    );
  if (!q.data) return <Notice>MDL intelligence has not been published yet.</Notice>;
  return <Dashboard data={q.data} />;
}

function Dashboard({ data }: { data: Data }) {
  const k = data.kpis;
  const last = data.stats.at(-1);
  const flagged = data.courts
    .filter((c) => c.flags.includes("fast_growth_no_bellwether_quote"))
    .sort((a, b) => (b.change12m ?? 0) - (a.change12m ?? 0));
  const timing = data.courts
    .filter((c) => c.firstBellwetherDate)
    .sort((a, b) => (a.monthsToBellwether ?? 1e9) - (b.monthsToBellwether ?? 1e9));
  const timed = timing.filter((c) => c.monthsToBellwether !== null).length;
  // Counted from the court records themselves, so the notice says what each located page actually yielded.
  const transferred = data.courts.filter((c) => c.status === "transferred");
  const yields = transferred.map(courtPageYield);
  const noPage = yields.filter((y) => y === "none" || y === "failed").length;
  const withPage = transferred.filter((c) => c.pages.length).length;
  const withOrders = yields.filter((y) => y === "orders").length;
  const statementsOnly = yields.filter((y) => y === "statements").length;
  const nothing = yields.filter((y) => y === "nothing").length;
  const many = (count: number, one: string, more: string) =>
    `${n(count)} ${count === 1 ? one : more}`;
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Built from official sources only: JPML Calendar Year Statistics (all {data.editions.length}{" "}
        editions), JPML hearing-session notices and Panel orders, GovInfo&rsquo;s JPML collection,
        the JPML pending-MDL reports of {data.asOf}, and transferee-court MDL pages on uscourts.gov
        (retrieved {data.retrieved ?? "—"}). Unknown values read “Not recorded”.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Pending MDLs" value={n(k.pendingMdls)} note={`as of ${data.asOf}`} />
        <Kpi label="Pending actions" value={n(k.pendingActions)} />
        <Kpi
          label={`Motions filed, ${last?.year ?? "—"}`}
          value={n(last?.motionsFiled)}
          note={`${n(last?.motionsGranted)} granted`}
        />
        <Kpi
          label={`Grant share, ${last?.year ?? "—"}`}
          value={pct(last?.rateAll)}
          note={`10-yr median ${pct(k.tenYearGrantMedian)}`}
        />
        <Kpi
          label="HHI · districts"
          value={n(data.concentration.hhiDistrictPending)}
          note="by pending actions"
        />
        <Kpi
          label="Products-liability MDLs"
          value={n(k.plMdls)}
          note={`transferred · ${n(withPage)} with court page · ${n(withOrders)} with orders extracted`}
        />
        <Kpi label="Bellwether quoted" value={n(k.plBellwetherQuoted)} note="on the court page" />
        <Kpi
          label="Flagged"
          value={n(k.flagged)}
          note="fast growth, no bellwether"
          tone={k.flagged ? "warn" : undefined}
        />
      </div>
      {noPage || statementsOnly || nothing ? (
        <Notice>
          Partial coverage:{" "}
          {[
            noPage
              ? `${n(noPage)} of ${n(transferred.length)} transferred products-liability MDLs have no official court page ${yields.includes("failed") ? "located and fetched" : "located"}`
              : null,
            statementsOnly
              ? `for ${many(statementsOnly, "MDL", "MDLs")} no order could be extracted from the court pages, but quoted statements or leadership were`
              : null,
            nothing
              ? `for ${many(nothing, "MDL", "MDLs")} nothing could be extracted from the fetched court pages`
              : null,
          ]
            .filter(Boolean)
            .join("; ")}
          . Rows without extracted orders show the JPML facts and any quoted statements; the linked
          court page itself may list orders the extractor did not read.{" "}
          {k.plNotTransferred
            ? `${many(k.plNotTransferred, "further products-liability docket", "further products-liability dockets")} on the 10/1/2026 report had not been transferred yet and ${k.plNotTransferred === 1 ? "is" : "are"} listed separately.`
            : null}
        </Notice>
      ) : null}

      <CentralizationTrends data={data} />
      <HearingOutcomes data={data} />
      <Concentration data={data} />

      <section aria-labelledby="flags-h" className="grid items-start gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="border-b border-border/70 px-3 py-2">
            <h2 id="flags-h" className="flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
              Fast growth, no bellwether schedule quoted
            </h2>
            <p className="text-xs text-muted-foreground">
              Rule:{" "}
              {data.rules["flag"] ??
                "pending actions up 25%+ in 12 months and no bellwether/trial statement on the court page"}
              .
            </p>
          </div>
          {flagged.length ? (
            <ul className="divide-y divide-border/60 text-xs">
              {flagged.map((c) => (
                <li key={c.mdl} className="flex items-start gap-3 px-3 py-1.5">
                  <Link
                    to="/matters/lens/$mdl"
                    params={{ mdl: String(c.mdl) }}
                    className="w-12 shrink-0 font-medium tabular-nums text-primary underline-offset-2 hover:underline"
                  >
                    {c.mdl}
                  </Link>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 font-medium" title={title(c.title)}>
                      {title(c.title)}
                    </span>
                    <span className="text-muted-foreground">
                      {n(c.pending)} pending · {signed(c.change12m)} in 12 months ·{" "}
                      {c.pages.length
                        ? many(c.pages.length, "court page", "court pages")
                        : "no court page located"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No products-liability MDL meets the rule.
            </p>
          )}
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="border-b border-border/70 px-3 py-2">
            <h2 className="text-sm font-semibold">
              Time from JPML transfer to the earliest quoted bellwether-trial date
            </h2>
            <p className="text-xs text-muted-foreground">
              Rule:{" "}
              {data.rules["bellwether_timing"] ??
                "first date in a quoted bellwether-trial statement"}
              .
            </p>
          </div>
          {timing.length ? (
            <ul className="divide-y divide-border/60 text-xs">
              {timing.map((c) => (
                <li key={c.mdl} className="px-3 py-1.5">
                  <div className="flex items-baseline gap-2">
                    <Link
                      to="/matters/lens/$mdl"
                      params={{ mdl: String(c.mdl) }}
                      className="font-medium tabular-nums text-primary underline-offset-2 hover:underline"
                    >
                      MDL {c.mdl}
                    </Link>
                    <span className="line-clamp-1 flex-1" title={title(c.title)}>
                      {title(c.title)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {c.monthsToBellwether !== null
                        ? `${c.monthsToBellwether} mo`
                        : `${c.firstBellwetherDate} · months not computed`}
                    </span>
                  </div>
                  <q
                    className="mt-0.5 line-clamp-2 text-muted-foreground"
                    title={c.firstBellwetherQuote ?? undefined}
                  >
                    {c.firstBellwetherQuote}
                  </q>
                  {c.bellwetherTimingNote ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {c.bellwetherTimingNote}.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No court page quotes a dated bellwether trial.
            </p>
          )}
          <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            {timing.length} of {n(k.plMdls)} transferred MDLs&rsquo; court pages print such a date
            and {timed} support a months figure; this is not a representative sample.
          </p>
        </div>
      </section>

      <CourtPageIndex courts={data.courts} />
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "warn" | undefined;
}) {
  return (
    <div
      className={`rounded-md border bg-surface px-3 py-2 ${tone === "warn" ? "border-warning/50" : "border-border"}`}
    >
      <div className="text-[11px] leading-4 text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-sans text-lg font-semibold tabular-nums">{value}</div>
      {note ? <div className="text-[11px] leading-4 text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-xs ${tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted/40 text-muted-foreground"}`}
    >
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading MDL intelligence">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-muted/40" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-md border border-border bg-muted/40" />
      <div className="h-72 animate-pulse rounded-md border border-border bg-muted/40" />
    </div>
  );
}
