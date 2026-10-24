import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fjcRecordQuery } from "@/components/judiciary/judiciaryQueries";
import {
  getCourtSittingJudges,
  type FjcRecord,
  type FjcService,
} from "@/lib/external/judiciary.functions";

const FJC = (nid: string) => `https://www.fjc.gov/node/${nid}`;
const year = (iso: string | null) => (iso ? iso.slice(0, 4) : "—");
const NR = "Not recorded";

export function JudgeFjcPanel({ judgeId }: { judgeId: string }) {
  const q = useQuery(fjcRecordQuery(judgeId));
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
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        The judicial service record could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  return q.data ? <Panel p={q.data} /> : null;
}

function Panel({ p }: { p: FjcRecord }) {
  const current = p.services.filter((s) => !s.terminationDate).at(-1) ?? p.services.at(-1);
  const mdlActions = p.mdls.reduce((sum, m) => sum + m.pending, 0);
  return (
    <section
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
      aria-label="Judicial service"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="text-heading font-semibold text-foreground">Judicial service</h2>
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
          value={current?.president ?? NR}
          note={current?.partyLabel ?? undefined}
        />
        <Fact label="ABA rating" value={current?.abaRating ?? NR} />
        <Fact
          label="Confirmed"
          value={current?.confirmation ?? (current?.recessAppointment ? "Recess appointment" : NR)}
          note={current?.voteLabel}
        />
        <Fact
          label="Years of service"
          value={p.yearsService?.toString() ?? NR}
          note={
            p.birthYear
              ? `Born ${p.birthYear}${p.birthPlace ? `, ${p.birthPlace}` : ""}`
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
            <ol className="space-y-2 text-xs">
              {p.services.map((s) => (
                <ServiceItem key={`${s.court}-${s.commission}-${s.nomination}`} s={s} />
              ))}
            </ol>
          </div>
          {p.otherNominations.length ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                Other nominations and recess appointments
              </h3>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {p.otherNominations.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.otherFederalService.length ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                Other federal judicial service
              </h3>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {p.otherFederalService.map((s) => (
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
                  <li key={`${e.school}-${e.year}-${e.degree}`}>
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
          <div>
            <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
              Demographics ({p.demographicsLabel})
            </h3>
            <p className="text-xs">
              Gender: {p.gender ?? NR} · Race or ethnicity: {p.raceEthnicity ?? NR}
            </p>
          </div>
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
                {p.career.split(/;\s*/).map((c, i) => (
                  <li key={`${i}-${c}`}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.courtWorkload ? (
            <p className="text-xs text-muted-foreground">
              Court workload (June 2026):{" "}
              {p.courtWorkload.weightedPerJudge?.toLocaleString("en-US") ?? NR} weighted filings and{" "}
              {p.courtWorkload.pendingPerJudge?.toLocaleString("en-US") ?? NR} pending cases per
              judgeship.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ServiceItem({ s }: { s: FjcService }) {
  const steps = [
    s.nomination ? `nominated ${s.nomination}` : null,
    s.committeeReferral ? `referred ${s.committeeReferral}` : null,
    s.hearing ? `hearing ${s.hearing}` : null,
    s.committeeAction
      ? `${s.committeeAction.toLowerCase()}${s.committeeActionDate ? ` ${s.committeeActionDate}` : ""}`
      : null,
    s.confirmation ? `confirmed ${s.confirmation} (${s.voteLabel})` : null,
    s.recessAppointment ? `recess appointment ${s.recessAppointment}` : null,
  ].filter(Boolean);
  return (
    <li className="border-l-2 border-border pl-2">
      <div className="font-medium">
        {s.courtId ? (
          <Link to="/courts/$id" params={{ id: s.courtId }} className="hover:underline">
            {s.court}
          </Link>
        ) : (
          s.court
        )}
      </div>
      <div className="text-muted-foreground">
        {s.title ?? "Judge"} · commissioned {s.commission ?? NR}
        {s.president ? ` · ${s.president}` : ""}
        {s.partyLabel ? ` · ${s.partyLabel}` : ""}
        {s.chiefBegin ? ` · chief judge ${year(s.chiefBegin)}–${year(s.chiefEnd)}` : ""}
        {s.seniorStatus ? ` · senior status ${s.seniorStatus}` : ""}
        {s.termination ? ` · ${s.termination.toLowerCase()} ${s.terminationDate ?? ""}` : ""}
      </div>
      <div className="text-muted-foreground">
        Seat {s.seatId ?? NR}
        {s.statute ? ` · seat created by ${s.statute}` : ""}
        {steps.length ? ` · ${steps.join(" · ")}` : ""}
      </div>
    </li>
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
    queryKey: ["court-sitting-judges", courtId],
    queryFn: () => getCourtSittingJudges({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-32 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading sitting judges"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        The list of sitting judges could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  if (!q.data?.length) return null;
  return (
    <section
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
      aria-label="Sitting judges"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="text-heading font-semibold text-foreground">Sitting judges · {q.data.length}</h2>
        <p className="text-xs text-muted-foreground">
          Federal Judicial Center biographical directory, all sitting Article III judges of this
          court
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
                Confirmation vote
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
                  {j.president ?? NR}
                  {j.partyLabel ? (
                    <span className="block text-[11px] text-muted-foreground">{j.partyLabel}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">{j.voteLabel}</td>
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
