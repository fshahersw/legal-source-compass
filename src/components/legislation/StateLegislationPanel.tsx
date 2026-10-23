import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ScrollText } from "lucide-react";
import type { StateHit } from "@/lib/external/legislation";
import { getStateLegislation } from "@/lib/external/legislation.functions";
import { fmtDay, fmtN } from "./format";

/**
 * A state's legislation at a glance (dataset state_bills): the most recent bills Open States records as signed or
 * became law, and pending bills of the current regular session, each linking to its bill page; the heading links to the
 * legislation index filtered to the state.
 */
export function StateLegislationPanel({ usps }: { usps: string }) {
  const fn = useServerFn(getStateLegislation);
  const q = useQuery({
    queryKey: ["state-legislation", usps],
    queryFn: () => fn({ data: { state: usps } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section className="resource-panel" aria-label="State legislation">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScrollText className="size-4" aria-hidden />
          Legislation
        </h2>
        <Link
          to="/law/legislation"
          search={{ scope: "state", state: usps }}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          All bills <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      {q.isPending ? (
        <p role="status" aria-busy="true" className="px-3 py-5 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.isError ? (
        <p role="alert" className="px-3 py-4 text-xs text-muted-foreground">
          State bills could not load.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          The state bill collection is not published yet.
        </p>
      ) : (
        <div className="space-y-3 px-3 py-3 text-xs">
          <p className="m-0 text-[11px] text-muted-foreground">
            {q.data.sessions.length
              ? q.data.sessions
                  .map(
                    (s) => `${s.label.replace(/^\D*?(?=\d)/, "")}${s.role ? ` (${s.role})` : ""}`,
                  )
                  .join(" · ")
              : "No session recorded"}
            {q.data.currentTotal != null
              ? ` · ${fmtN(q.data.currentTotal)} bills in the current session`
              : ""}
          </p>
          <List
            title="Recently signed or became law"
            rows={q.data.enacted}
            total={q.data.enactedTotal}
            empty="Open States records no signed or enacted bill for these sessions."
          />
          <List
            title="Pending in the current session"
            rows={q.data.pending}
            total={q.data.pendingTotal}
            empty="No pending bill is recorded for the current session."
          />
          <p className="m-0 text-[10.5px] leading-4 text-muted-foreground">
            Open States public data, collected from the legislature's website; status follows Open
            States' action classifications. Pending means no signature, enactment or veto is
            recorded.
          </p>
        </div>
      )}
    </section>
  );
}

function List({
  title,
  rows,
  total,
  empty,
}: {
  title: string;
  rows: StateHit[];
  total: number | null;
  empty: string;
}) {
  return (
    <div>
      <h3 className="m-0 mb-1 flex items-baseline justify-between gap-2 text-[11.5px] font-semibold">
        {title}
        <span className="font-mono font-normal text-muted-foreground">
          {total != null ? fmtN(total) : ""}
        </span>
      </h3>
      {rows.length ? (
        <ul className="m-0 list-none space-y-1 p-0">
          {rows.map((r) => (
            <li key={r.id} className="min-w-0">
              <Link
                to="/law/legislation/state/$id"
                params={{ id: r.id }}
                className="font-medium text-primary hover:underline"
              >
                {r.identifier}
              </Link>{" "}
              <span className="line-clamp-1 inline text-foreground">{r.title}</span>
              <span className="block text-[10.5px] text-muted-foreground">
                {r.statusLabel} · {fmtDay(r.latestActionDate)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
