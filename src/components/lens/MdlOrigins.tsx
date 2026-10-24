import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getMdlHierarchy, type MdlHierarchy } from "@/lib/external/mdlNetwork.functions";

const n = (v: number | null | undefined) =>
  v === null || v === undefined ? "Not recorded" : v.toLocaleString("en-US");

function Bars({
  rows,
  label,
}: {
  rows: { key: string; label: string; value: number }[];
  label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="m-0 list-none space-y-1 p-0" aria-label={label}>
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-2 text-[11.5px]"
        >
          <span className="truncate text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 rounded-sm bg-muted" aria-hidden>
            <span
              className="block h-2 rounded-sm bg-primary/70"
              style={{ width: `${Math.max(2, (100 * r.value) / max)}%` }}
            />
          </span>
          <span className="text-right font-mono tabular-nums">
            {r.value.toLocaleString("en-US")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Member actions and where they started for one MDL (dataset mdl_hierarchy). Renders nothing for MDLs the matter registry does not hold.
 */
export function MdlOrigins({ mdl }: { mdl: number }) {
  const q = useQuery({
    queryKey: ["mdl-hierarchy", mdl],
    queryFn: () => getMdlHierarchy({ data: { mdl } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isPending)
    return (
      <div
        className="h-40 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading member actions and origins"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="rounded-lg border border-dashed border-border px-4 py-3 text-[11.5px] text-muted-foreground"
      >
        Member actions and origins could not be loaded.{" "}
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  return q.data ? <Body h={q.data} /> : null;
}

function Body({ h }: { h: MdlHierarchy }) {
  const [allCourts, setAllCourts] = useState(false);
  const top = h.memberJudges.top[0] ?? null;
  const origin = h.origin;
  const courts = origin ? (allCourts ? origin.byCourt : origin.byCourt.slice(0, 8)) : [];
  const kpis: [string, string, string | undefined][] = [
    [
      "Member actions in the registry",
      n(h.actions),
      h.jpmlTotal !== null
        ? `JPML total ${n(h.jpmlTotal)}${h.registrySharePct !== null ? ` · ${h.registrySharePct}% held` : ""}`
        : undefined,
    ],
    [
      "Assigned to the transferee judge",
      top && top.sharePct !== null ? `${top.sharePct}%` : "Not recorded",
      top && h.memberJudges.joined !== null
        ? `${n(top.dockets)} of ${n(h.memberJudges.joined)} joined member dockets`
        : undefined,
    ],
    [
      "Started in another court",
      origin ? n(origin.dockets) : "None recorded",
      origin
        ? `${n(origin.courts)} courts · ${n(origin.states)} states`
        : "most members are filed directly in the MDL court",
    ],
    [
      "Median days open there",
      origin?.medianDaysToClose !== null && origin?.medianDaysToClose !== undefined
        ? n(Math.round(origin.medianDaysToClose))
        : "Not recorded",
      origin?.daysN ? `before transfer · n = ${n(origin.daysN)}` : undefined,
    ],
  ];
  return (
    <section
      className="min-w-0 rounded-lg border border-border bg-surface"
      aria-label="Member actions and where they started"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-[12.5px] font-semibold">Member actions and where they started</h2>
          <p className="text-[11px] text-muted-foreground">
            The matter registry's member dockets joined to by exact docket id
          </p>
        </div>
        <p className="m-0 text-[11px] text-muted-foreground">
          {h.masterDocket?.number ? (
            <>
              Master docket{" "}
              {h.masterDocket.clDocketId ? (
                <a
                  href={`https://www.courtlistener.com/docket/${h.masterDocket.clDocketId}/`}
                  className="font-mono text-primary hover:underline"
                >
                  {h.masterDocket.number}
                </a>
              ) : (
                <span className="font-mono">{h.masterDocket.number}</span>
              )}
            </>
          ) : null}
          {h.transfereeCourt ? (
            <>
              {h.masterDocket?.number ? " · " : ""}
              <Link
                to="/courts/$id"
                params={{ id: h.transfereeCourt.id }}
                className="text-primary hover:underline"
              >
                {h.transfereeCourt.name}
              </Link>
            </>
          ) : null}
          {h.transfereeJudge ? (
            <>
              {" · "}
              {h.transfereeJudge.link ? (
                <Link
                  to="/records/$dataset/$id"
                  params={{ dataset: "clb_judge_dockets", id: String(h.transfereeJudge.personId) }}
                  className="text-primary hover:underline"
                >
                  {h.transfereeJudge.name}
                </Link>
              ) : (
                h.transfereeJudge.name
              )}
            </>
          ) : null}
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
        {kpis.map(([label, value, note]) => (
          <div key={label} className="min-w-0 bg-surface px-3 py-2">
            <dt className="text-[11px] leading-4 text-muted-foreground">{label}</dt>
            <dd className="m-0 font-mono text-lg font-semibold leading-tight">{value}</dd>
            {note ? <dd className="m-0 text-[10.5px] text-muted-foreground">{note}</dd> : null}
          </div>
        ))}
      </dl>
      <div className="grid gap-4 border-t border-border/70 p-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          {h.byBasis.length ? (
            <div>
              <p className="m-0 mb-1 text-[11px] text-muted-foreground">
                How membership is evidenced (member actions)
              </p>
              <Bars
                label="Member actions by evidence"
                rows={h.byBasis.map((b) => ({ key: b.basis, label: b.label, value: b.actions }))}
              />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 space-y-3">
          {origin ? (
            <>
              <div>
                <p className="m-0 mb-1 text-[11px] text-muted-foreground">
                  Courts where transferred cases were first filed
                </p>
                <table className="w-full text-[11.5px]">
                  <thead className="sr-only">
                    <tr>
                      <th>Court</th>
                      <th>State</th>
                      <th>Dockets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courts.map((c) => (
                      <tr key={c.courtId} className="border-b border-border/50 last:border-0">
                        <td className="py-1 pr-2">
                          <Link
                            to="/courts/$id"
                            params={{ id: c.courtId }}
                            className="text-primary hover:underline"
                          >
                            {c.court}
                          </Link>
                        </td>
                        <td className="py-1 pr-2 text-muted-foreground">{c.state ?? ""}</td>
                        <td className="py-1 text-right font-mono tabular-nums">{n(c.dockets)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {origin.byCourt.length > 8 ? (
                  <button
                    type="button"
                    onClick={() => setAllCourts((v) => !v)}
                    className="mt-1 text-[11px] text-primary hover:underline"
                    aria-expanded={allCourts}
                  >
                    {allCourts ? "Show fewer" : `Show all ${origin.byCourt.length} courts`}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="m-0 text-[11.5px] text-muted-foreground">
              The registry records no member docket of this MDL that was first filed in another
              court.
            </p>
          )}
        </div>
      </div>
      <footer className="border-t border-border/70 px-3 py-2 text-[10.5px] leading-4 text-muted-foreground">
        Membership is only what the registry records (JPML schedules and conditional transfer
 orders, the master docket's party list, provider-reported links and firm crosswalks); it is
 never inferred from a caption, product, judge or firm. Most member cases are filed directly
 in the transferee court and have no other court of origin. Judges are CourtListener
 assignments by exact person id.
      </footer>
    </section>
  );
}
