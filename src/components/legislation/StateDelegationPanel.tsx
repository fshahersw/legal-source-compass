import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Landmark } from "lucide-react";
import type { MemberHit } from "@/lib/external/congressMembers";
import { getStateDelegation } from "@/lib/external/congressMembers.functions";
import { PartyChip } from "./MemberSearch";

/**
 * A state's or territory's current delegation in Congress (dataset congress_members): its senators, its representatives by
 * district and any delegate or resident commissioner, each linking to the member page; party is the latest entry of the
 * Congress.gov party history. "Current" is the API's currentMember flag together with the state of the latest term.
 */
export function StateDelegationPanel({ usps }: { usps: string }) {
  const fn = useServerFn(getStateDelegation);
  const q = useQuery({
    queryKey: ["state-delegation", usps],
    queryFn: () => fn({ data: { state: usps } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section className="resource-panel" aria-label="Delegation in Congress">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Landmark className="size-4" aria-hidden />
          Delegation in Congress
        </h2>
        <Link
          to="/law/legislation/members"
          search={{ state: usps }}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          All members <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      {q.isPending ? (
        <p role="status" aria-busy="true" className="px-3 py-5 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.isError ? (
        <p role="alert" className="px-3 py-4 text-xs text-muted-foreground">
          The delegation could not load.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : q.data.total === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No current member is recorded for this state or territory in the members collection.
        </p>
      ) : (
        <div className="flex flex-col gap-3 px-3 py-3 text-xs">
          <Group title="Senators" rows={q.data.senators} />
          <Group title="Representatives" rows={q.data.representatives} district />
          <Group title="Delegates and resident commissioners" rows={q.data.delegates} />
          <p className="m-0 text-[10.5px] leading-4 text-muted-foreground">
            Congress.gov API (Library of Congress): members flagged current, listed under the state
            of their latest term. Party is the latest entry of each member's party history.
          </p>
        </div>
      )}
    </section>
  );
}

function Group({
  title,
  rows,
  district = false,
}: {
  title: string;
  rows: MemberHit[];
  district?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="m-0 mb-1 flex items-baseline justify-between gap-2 text-[11.5px] font-semibold">
        {title}
        <span className="font-mono font-normal text-muted-foreground">{rows.length}</span>
      </h3>
      <ul className="m-0 list-none space-y-1 p-0">
        {rows.map((m) => (
          <li key={m.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {district ? (
              <span className="w-[7.5rem] shrink-0 text-[10.5px] text-muted-foreground">
                {m.district === "At large"
                  ? "At large"
                  : m.district
                    ? `District ${m.district}`
                    : "District not recorded"}
              </span>
            ) : null}
            <Link
              to="/law/legislation/members/$bioguide"
              params={{ bioguide: m.id }}
              className="font-medium text-primary hover:underline"
            >
              {m.displayName ?? m.name}
            </Link>
            <PartyChip party={m.party} abbreviation={m.partyAbbreviation} />
          </li>
        ))}
      </ul>
    </div>
  );
}
