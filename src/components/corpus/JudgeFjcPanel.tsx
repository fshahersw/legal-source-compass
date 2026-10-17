import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getCourtJudges,
  getJudgeFjcProfile,
  type FjcProfile,
} from "@/lib/external/judgeProfiles.functions";

const FJC = (nid: string) => `https://www.fjc.gov/node/${nid}`;
const year = (iso: string | null) => (iso ? iso.slice(0, 4) : "—");

export function JudgeFjcPanel({ judgeId }: { judgeId: string }) {
  const q = useQuery({
    queryKey: ["judge-fjc", judgeId],
    queryFn: () => getJudgeFjcProfile({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-40 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading judicial service record"
      />
    );
  if (q.isError)
    return (
      <p role="alert" className="mb-5 text-xs text-muted-foreground">
        The judicial service record could not be loaded.
      </p>
    );
  return q.data ? <Panel p={q.data} /> : null;
}

function Panel({ p }: { p: FjcProfile }) {
  const current = p.services.filter((s) => !s.termination).at(-1) ?? p.services.at(-1);
  const mdlActions = p.mdls.reduce((sum, m) => sum + m.pending, 0);
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-surface"
      aria-label="Judicial service"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="font-sans text-sm font-semibold">Judicial service</h2>
        <a
          href={FJC(p.nid)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          Federal Judicial Center biographical directory
        </a>
      </header>
      <dl className="grid grid-cols-2 gap-px bg-border/60 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Status" value={p.status} />
        <Fact
          label="Appointed by"
          value={current ? `${current.president}` : "—"}
          note={current?.party}
        />
        <Fact label="ABA rating" value={current?.aba_rating ?? "Not recorded"} />
        <Fact
          label="Confirmed"
          value={current?.confirmation ?? "—"}
          note={current?.vote ? `Vote ${current.vote.trim()}` : undefined}
        />
        <Fact
          label="Years of service"
          value={p.years_service?.toString() ?? "—"}
          note={
            p.birth_year
              ? `Born ${p.birth_year}${p.birth_place ? `, ${p.birth_place}` : ""}`
              : undefined
          }
        />
        <Fact
          label="Pending MDLs"
          value={p.mdls.length.toString()}
          note={p.mdls.length ? `${mdlActions.toLocaleString("en-US")} actions` : undefined}
        />
      </dl>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <div>
            <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
              Federal judicial service
            </h3>
            <ol className="space-y-1.5 text-xs">
              {p.services.map((s) => (
                <li key={`${s.court}-${s.commission}`} className="border-l-2 border-border pl-2">
                  <div className="font-medium">
                    {s.court_id ? (
                      <Link
                        to="/courts/$id"
                        params={{ id: s.court_id }}
                        className="hover:underline"
                      >
                        {s.court}
                      </Link>
                    ) : (
                      s.court
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    {s.title} · commissioned {s.commission ?? "—"} · {s.president}
                    {s.chief_begin
                      ? ` · chief judge ${year(s.chief_begin)}–${year(s.chief_end)}`
                      : ""}
                    {s.senior_status ? ` · senior status ${s.senior_status}` : ""}
                    {s.termination
                      ? ` · ${s.termination.toLowerCase()} ${s.termination_date ?? ""}`
                      : ""}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {p.other_federal_service.length ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                Other federal judicial service
              </h3>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {p.other_federal_service.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.education.length ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Education</h3>
              <ul className="space-y-0.5 text-xs">
                {p.education.map((e) => (
                  <li key={`${e.school}-${e.year}`}>
                    {e.school}
                    <span className="text-muted-foreground">
                      {e.degree ? `, ${e.degree}` : ""}
                      {e.year ? `, ${e.year}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="min-w-0 space-y-3">
          {p.mdls.length ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                Pending MDLs as transferee judge
              </h3>
              <ul className="divide-y divide-border/60 text-xs">
                {p.mdls.map((m) => (
                  <li key={m.mdl} className="flex items-center gap-2 py-1.5">
                    <Link
                      to="/records/$dataset/$id"
                      params={{ dataset: "mdl_analytics", id: String(m.mdl) }}
                      className="w-10 shrink-0 font-medium tabular-nums text-primary hover:underline"
                    >
                      {m.mdl}
                    </Link>
                    <span className="min-w-0 flex-1 truncate" title={m.title}>
                      {m.title.replace(/^IN RE:\s*/i, "")}
                    </span>
                    <span className="w-16 text-right tabular-nums">
                      {m.pending.toLocaleString("en-US")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.career ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                Professional career
              </h3>
              <ul className="space-y-0.5 text-xs">
                {p.career.split(/;\s*/).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.court_workload ? (
            <p className="text-xs text-muted-foreground">
              Court workload (June 2026):{" "}
              {p.court_workload["per_judge_weighted_filings"]?.toLocaleString("en-US") ?? "—"}{" "}
              weighted filings and{" "}
              {p.court_workload["per_judge_pending"]?.toLocaleString("en-US") ?? "—"} pending cases
              per judgeship.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

export function CourtJudgesPanel({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["court-judges", courtId],
    queryFn: () => getCourtJudges({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading || q.isError || !q.data?.length) return null;
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-surface"
      aria-label="Sitting judges"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="font-sans text-sm font-semibold">Sitting judges · {q.data.length}</h2>
        <p className="text-xs text-muted-foreground">
          From the Federal Judicial Center directory (top 1,000 sitting judges selection)
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border/60">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Judge
              </th>
              <th scope="col" className="px-2 py-2 text-left font-medium">
                Status
              </th>
              <th scope="col" className="px-2 py-2 text-left font-medium">
                Appointed by
              </th>
              <th scope="col" className="px-2 py-2 text-left font-medium">
                Commissioned
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Pending MDLs
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((j) => (
              <tr key={j.nid} className="border-t border-border/50">
                <td className="px-4 py-1.5 font-medium">
                  {j.profileId ? (
                    <Link
                      to="/judges/$id"
                      params={{ id: j.profileId }}
                      className="text-primary hover:underline"
                    >
                      {j.name}
                    </Link>
                  ) : (
                    j.name
                  )}
                </td>
                <td className="px-2 py-1.5">{j.status}</td>
                <td className="px-2 py-1.5">
                  {j.president} <span className="text-muted-foreground">({j.party})</span>
                </td>
                <td className="px-2 py-1.5 tabular-nums">{j.commission ?? "—"}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {j.mdls ? `${j.mdls} · ${j.mdlActions.toLocaleString("en-US")} actions` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
