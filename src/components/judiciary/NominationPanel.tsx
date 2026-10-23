import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceLink } from "@/components/enforcement/parts";
import { PanelError, PanelLoading, PanelShell } from "@/components/courts/clb/ClbRestParts";
import { fjcRecordQuery } from "./judiciaryQueries";
import {
  getJudgeNominations,
  getSenateVoteMembers,
  type FjcRecord,
  type FjcService,
  type Nomination,
  type SenateVote,
} from "@/lib/external/judiciary.functions";
import { fmtDay, NR, ordinal, splitText, tallyText } from "./judiciaryFormat";

const STATUS: Record<string, string> = {
  confirmed: "Confirmed",
  withdrawn: "Withdrawn by the President",
  returned: "Returned to the President",
  rejected: "Rejected by the Senate",
  pending: "Pending",
  no_final_action: "No final action recorded",
};

/**
 * Nomination and confirmation record of one judge: Congress.gov nominations (1981 on) linked by exact key, Senate roll
 * calls with the party split as published, and the FJC directory's own appointment fields (seat, statute, committee
 * dates, vote) for every appointment, including those before 1981.
 */
export function NominationPanel({ judgeId }: { judgeId: string }) {
  const fjc = useQuery(fjcRecordQuery(judgeId));
  const noms = useQuery({
    queryKey: ["judiciary-nominations", judgeId],
    queryFn: () => getJudgeNominations({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (fjc.isLoading || noms.isLoading)
    return <PanelLoading label="Loading nomination and confirmation record" height="h-32" />;
  if (fjc.isError && noms.isError)
    return (
      <PanelError
        text="The nomination and confirmation record could not be loaded."
        onRetry={() => {
          void fjc.refetch();
          void noms.refetch();
        }}
      />
    );
  const record = fjc.data ?? null;
  const nominations = noms.data ?? [];
  if (!record && !nominations.length) return null;
  return (
    <Body
      record={record}
      nominations={nominations}
      partial={fjc.isError || noms.isError}
      retry={() => {
        void fjc.refetch();
        void noms.refetch();
      }}
    />
  );
}

function Body({
  record,
  nominations,
  partial,
  retry,
}: {
  record: FjcRecord | null;
  nominations: Nomination[];
  partial: boolean;
  retry: () => void;
}) {
  const services = record?.services ?? [];
  const matched = new Set<Nomination>();
  const rows = services.map((s) => {
    const n =
      nominations.find(
        (x) =>
          x.status === "confirmed" &&
          x.confirmation?.date === s.confirmation &&
          (s.courtId == null || x.courtIds.includes(s.courtId)),
      ) ?? null;
    if (n) matched.add(n);
    return { s, n };
  });
  const others = nominations.filter((n) => !matched.has(n));
  const earliest = services[0]?.nomination ?? null;
  return (
    <PanelShell
      title="Nomination and confirmation"
      subtitle="Federal Judicial Center appointment record, Congress.gov nomination actions (1981 on) and Senate roll-call votes (1989 on)"
      aside={
        record ? (
          <SourceLink href={`https://www.fjc.gov/node/${record.nid}`}>FJC entry</SourceLink>
        ) : null
      }
    >
      {partial ? (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground" role="status">
          Part of this record could not be loaded.{" "}
          <button type="button" onClick={retry} className="text-primary underline">
            Retry
          </button>
        </p>
      ) : null}
      <ol className="space-y-2 px-3 pb-3">
        {rows.map(({ s, n }) => (
          <li
            key={`${s.court}-${s.commission}-${s.nomination}`}
            className="rounded-md border border-border/70"
          >
            <Appointment s={s} n={n} />
          </li>
        ))}
        {others.map((n) => (
          <li key={n.id} className="rounded-md border border-border/70">
            <NominationOnly n={n} />
          </li>
        ))}
      </ol>
      {!nominations.length && earliest && earliest < "1981-01-01" ? (
        <p className="px-3 pb-3 text-[11px] text-muted-foreground">
          Congress.gov nomination records start in 1981; the appointment fields above are the
          FJC&apos;s.
        </p>
      ) : null}
      {nominations.length || !record ? null : earliest && earliest >= "1981-01-01" ? (
        <p className="px-3 pb-3 text-[11px] text-muted-foreground">
          No Congress.gov nomination is linked: the link needs the same surname, court and an
          identical nomination or confirmation date in both sources.
        </p>
      ) : null}
    </PanelShell>
  );
}

/** Hearing days grouped by their printed hearing record: "Mar 21, 2022; Mar 22, 2022 (S.Hrg. 117-422)". */
function hearingText(hearings: Nomination["hearings"]): string {
  const groups = new Map<string, string[]>();
  for (const h of hearings) {
    const key = h.citation ?? "";
    groups.set(key, [...(groups.get(key) ?? []), fmtDay(h.date)]);
  }
  return [...groups.entries()]
    .map(([cit, days]) => `${days.join("; ")}${cit ? ` (${cit})` : ""}`)
    .join("; ");
}

function Step({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-4 text-muted-foreground">{label}</dt>
      <dd className="break-words text-xs leading-5">{children}</dd>
    </div>
  );
}

function Appointment({ s, n }: { s: FjcService; n: Nomination | null }) {
  const confirmVote = n?.votes.find((v) => v.question === "On the Nomination") ?? null;
  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold">
          {s.courtId ? (
            <Link to="/courts/$id" params={{ id: s.courtId }} className="hover:underline">
              {s.court}
            </Link>
          ) : (
            s.court
          )}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {s.president ? `Nominated by ${s.president}` : NR}
          {s.partyLabel ? ` · ${s.partyLabel}` : ""}
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-6">
        <Step label="Nominated">{fmtDay(n?.receivedDate ?? s.nomination)}</Step>
        <Step label="Referred to committee">
          {fmtDay(n?.referral?.date ?? s.committeeReferral)}
        </Step>
        <Step label="Hearing">
          {n?.hearings.length ? hearingText(n.hearings) : fmtDay(s.hearing)}
        </Step>
        <Step label="Committee action">
          {s.committeeAction
            ? `${s.committeeAction}${s.committeeActionDate ? `, ${fmtDay(s.committeeActionDate)}` : ""}`
            : NR}
        </Step>
        <Step label="Confirmed">
          {s.confirmation
            ? fmtDay(s.confirmation)
            : s.recessAppointment
              ? "Recess appointment"
              : NR}
          <span className="block text-muted-foreground">{s.voteLabel}</span>
        </Step>
        <Step label="Commissioned">{fmtDay(s.commission)}</Step>
        <Step label="Seat">
          {s.seatId ?? NR}
          {s.statute ? <span className="block text-muted-foreground">{s.statute}</span> : null}
        </Step>
        <Step label="Predecessor (as published)">
          {n
            ? (n.predecessor ?? (n.newPosition ? "New position" : NR))
            : "Not in the Congress.gov record"}
        </Step>
      </dl>
      {n ? <CongressRecord n={n} confirmVote={confirmVote} /> : null}
    </div>
  );
}

function NominationOnly({ n }: { n: Nomination }) {
  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold">
          {n.citation}, {ordinal(n.congress)} Congress · {STATUS[n.status] ?? n.status}
          {n.statusDate ? `, ${fmtDay(n.statusDate)}` : ""}
        </h3>
        <span className="text-[11px] text-muted-foreground">Received {fmtDay(n.receivedDate)}</span>
      </div>
      {n.description ? <p className="mt-0.5 text-xs">{n.description}</p> : null}
      <CongressRecord n={n} confirmVote={null} />
    </div>
  );
}

function CongressRecord({ n, confirmVote }: { n: Nomination; confirmVote: SenateVote | null }) {
  const votes = n.votes;
  return (
    <div className="mt-2 space-y-1 border-t border-border/60 pt-1.5 text-xs">
      <p className="text-muted-foreground">
        {n.congressUrl ? (
          <SourceLink href={n.congressUrl}>{`${n.citation} on Congress.gov`}</SourceLink>
        ) : (
          n.citation
        )}
        {n.referral?.committee
          ? ` · referred to the ${n.referral.committee.replace(/^the /i, "")}`
          : ""}
        {n.confirmation
          ? ` · confirmed ${fmtDay(n.confirmation.date)} by ${
              n.confirmation.method === "Roll call" && n.confirmation.yeas != null
                ? `roll call ${n.confirmation.yeas}–${n.confirmation.nays}${n.confirmation.recordVote ? ` (record vote ${n.confirmation.recordVote})` : ""}`
                : n.confirmation.method.toLowerCase()
            }`
          : ""}
      </p>
      {n.cloture.length ? (
        <p className="text-muted-foreground">
          Cloture:{" "}
          {n.cloture.map((c) => `${fmtDay(c.date)} ${c.text.replace(/\.$/, "")}`).join("; ")}
        </p>
      ) : null}
      {votes.length ? (
        <ul className="space-y-1">
          {votes.map((v) => (
            <VoteRow key={v.voteId} v={v} highlight={v === confirmVote} />
          ))}
        </ul>
      ) : n.confirmation?.method === "Roll call" && n.congress < 101 ? (
        <p className="text-[11px] text-muted-foreground">
          Senate member-level vote records are published from 1989 (101st Congress).
        </p>
      ) : null}
    </div>
  );
}

function VoteRow({ v, highlight }: { v: SenateVote; highlight: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("rounded border border-border/60 px-2 py-1", highlight && "bg-muted/40")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="font-medium">{v.question}</span>
        <span className="text-muted-foreground">{fmtDay(v.date)}</span>
        <span className="font-mono tabular-nums">{tallyText(v)}</span>
        {v.split.length ? (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {splitText(v.split)}
          </span>
        ) : null}
        {v.enBlocSize > 1 ? (
          <span className="text-[11px] text-muted-foreground">
            en bloc, {v.enBlocSize} nominations
          </span>
        ) : null}
        <span className="text-[11px] text-muted-foreground">{v.result ?? ""}</span>
        {v.pageUrl ? <SourceLink href={v.pageUrl}>Senate roll call</SourceLink> : null}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((x) => !x)}
          className="inline-flex items-center gap-0.5 rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          Each senator&apos;s vote
        </button>
      </div>
      {open ? <Members voteId={v.voteId} /> : null}
    </li>
  );
}

function Members({ voteId }: { voteId: string }) {
  const q = useQuery({
    queryKey: ["judiciary-vote-members", voteId],
    queryFn: () => getSenateVoteMembers({ data: { voteId } }),
    staleTime: 60 * 60 * 1000,
  });
  if (q.isLoading)
    return <p className="py-1 text-[11px] text-muted-foreground">Loading the roll call…</p>;
  if (q.isError)
    return (
      <p role="alert" className="py-1 text-[11px] text-muted-foreground">
        The roll call could not be loaded.{" "}
        <button type="button" onClick={() => void q.refetch()} className="text-primary underline">
          Retry
        </button>
      </p>
    );
  if (!q.data) return <p className="py-1 text-[11px] text-muted-foreground">{NR}</p>;
  const groups = new Map<string, string[]>();
  for (const m of q.data.members) {
    const list = groups.get(m.vote) ?? [];
    list.push(m.name);
    groups.set(m.vote, list);
  }
  return (
    <div className="mt-1 space-y-1 text-[11px] leading-4">
      {[...groups.entries()].map(([vote, names]) => (
        <p key={vote}>
          <span className="font-medium">
            {vote} ({names.length}):
          </span>{" "}
          <span className="text-muted-foreground">{names.join(", ")}</span>
        </p>
      ))}
      <p className="text-muted-foreground">Names, parties and states as printed by the Senate.</p>
    </div>
  );
}
