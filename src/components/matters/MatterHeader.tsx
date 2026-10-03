import { Link } from "@tanstack/react-router";

import { Chip, Fact, LinkOut } from "@/components/matters/common";
import { orNotRecorded } from "@/lib/matters/overview";
import type { MatterOverviewPayload } from "@/lib/matters/types";

const REFERENCE_LABELS: Record<string, string> = {
  "court-master-references": "Court's MDL information page",
  "order-locators": "JPML panel orders index",
  "mdl-motion-observations": "JPML panel orders index (motion index)",
  "judge-profile-references": "Court page naming the judge",
};

function statusTone(status: string | null): "success" | "neutral" | "warning" {
  if (status === "pending") return "success";
  if (status === "terminated") return "neutral";
  return "warning";
}

/** Master docket header: court, docket number, presiding judge, dates, status, JPML counts and source links. */
export function MatterHeader({ payload }: { payload: MatterOverviewPayload }) {
  const { overview: o, master, judgeProfile, jpmlReferences, sw } = payload;
  const filed = master?.dateFiled ?? null;
  const closed = master?.dateTerminated ?? o.dates.closed;
  const clUrl = o.masterDocket.clDocketId
    ? `https://www.courtlistener.com/docket/${o.masterDocket.clDocketId}/`
    : null;
  const byNumberReport = o.reports.find((r) => r.kind === "by_mdl_number" && r.officialUrl);
  const references = jpmlReferences.filter(
    (r) =>
      r.kind === "court-master-references" ||
      r.kind === "order-locators" ||
      r.kind === "mdl-motion-observations",
  );
  const seen = new Set<string>();
  const uniqueReferences = references.filter((r) =>
    seen.has(r.url) ? false : (seen.add(r.url), true),
  );
  const judge = o.judge;
  // The registry records the magistrate judge the master docket is referred to, as the source string only.
  const referred =
    payload.registry?.judges.find((j) => j.role === "referred_to" && j.sourceString) ?? null;
  const registry = payload.registry;

  return (
    <section
      aria-label="Master docket header"
      className="rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5">
        <span className="font-display text-[15px] font-semibold">MDL {o.mdl}</span>
        {o.status ? (
          <Chip
            tone={statusTone(o.status)}
            title={
              o.asOf ? `Status as listed in the JPML report dated ${o.asOf}` : "Status as recorded"
            }
          >
            {o.status[0]!.toUpperCase() + o.status.slice(1)}
            {o.asOf ? ` · as of ${o.asOf}` : ""}
          </Chip>
        ) : (
          <Chip>Status not recorded</Chip>
        )}
        {sw.tier ? (
          <Chip
            tone="primary"
            title="Seeger Weiss priority tier; orders the hub and never asserts a firm role."
          >
            SW tier {sw.tier}
          </Chip>
        ) : null}
        {o.litigationType ? <Chip title="JPML docket type">{o.litigationType}</Chip> : null}
        {registry ? (
          <Link
            to="/matters/$id"
            params={{ id: o.mdl }}
            search={{ tab: "cases" }}
            className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Chip
              tone="success"
              title="The Seeger Weiss matter registry holds explicit case ids and evidence-backed dockets for this MDL."
            >
              In the matter registry
              {registry.members.rows !== null
                ? ` · ${registry.members.rows.toLocaleString()} dockets`
                : ""}
            </Chip>
          </Link>
        ) : null}
        <Link
          to="/matters/seeger-weiss"
          className="ml-auto text-[12px] text-primary underline-offset-2 hover:underline"
        >
          Seeger Weiss matters hub
        </Link>
      </div>

      <dl className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Court">
          {o.court.clId ? (
            <Link
              to="/courts/$id"
              params={{ id: o.court.clId }}
              className="text-primary underline-offset-2 hover:underline"
            >
              {o.court.shortName ?? o.court.fullName ?? o.court.clId}
            </Link>
          ) : (
            orNotRecorded(o.court.shortName)
          )}
          <span className="block text-[11px] text-muted-foreground">
            {[
              o.court.fullName && o.court.fullName !== o.court.shortName ? o.court.fullName : null,
              o.court.circuit,
            ]
              .filter(Boolean)
              .join(" · ") || null}
          </span>
        </Fact>
        <Fact label="Master docket">
          <span className="font-mono text-[12px]">{o.masterDocket.number ?? "Not recorded"}</span>
          {clUrl ? (
            <span className="block text-[11px]">
              <LinkOut href={clUrl}>CourtListener docket {o.masterDocket.clDocketId}</LinkOut>
            </span>
          ) : null}
        </Fact>
        <Fact label="Presiding (transferee) judge">
          {judge.printedName || judge.profileName ? (
            <>
              {judgeProfile ? (
                <Link
                  to="/judges/$id"
                  params={{ id: judgeProfile.id }}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {judgeProfile.name}
                </Link>
              ) : (
                <span>{judge.profileName ?? judge.printedName}</span>
              )}
              <span className="block text-[11px] text-muted-foreground">
                {judge.printedName &&
                judge.printedName !== (judgeProfile?.name ?? judge.profileName)
                  ? `Printed by the JPML as “${judge.printedName}”. `
                  : ""}
                {judgeProfile
                  ? `Profile linked by native id${judge.evidenceNote ? ` — ${judge.evidenceNote}` : ""}.`
                  : "No profile link: no native-id evidence ties a judge profile to this MDL."}
              </span>
              {referred ? (
                <span className="block text-[11px] text-muted-foreground">
                  Referred to (CourtListener docket): {referred.sourceString}
                  {referred.clPersonId ? ` · person ${referred.clPersonId}` : ""}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">Not recorded</span>
          )}
        </Fact>
        <Fact label={filed ? "Master docket filed" : "Filed (JPML listing field)"}>
          {filed ?? o.dates.filed}
        </Fact>
        <Fact label="Transferred (JPML order)">{o.dates.transferred}</Fact>
        <Fact label="Terminated / closed">{closed}</Fact>
        <Fact label="Last filing on master docket">{master?.dateLastFiling ?? null}</Fact>
        <Fact label="Actions (JPML)">
          {o.actions.total !== null || o.actions.pending !== null ? (
            <>
              <span className="tabular-nums">{orNotRecorded(o.actions.total)}</span> total ·{" "}
              <span className="tabular-nums">{orNotRecorded(o.actions.pending)}</span> pending
              <span className="block text-[11px] text-muted-foreground">
                {o.countsLabel ?? (o.asOf ? `as of ${o.asOf}` : null)}
              </span>
            </>
          ) : null}
        </Fact>
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[12px]">
        <span className="font-medium text-muted-foreground">Sources</span>
        {clUrl ? <LinkOut href={clUrl}>CourtListener master docket</LinkOut> : null}
        {byNumberReport?.officialUrl ? (
          <LinkOut href={byNumberReport.officialUrl}>
            JPML MDL statistics (by MDL number
            {byNumberReport.reportDate ? `, ${byNumberReport.reportDate}` : ""})
          </LinkOut>
        ) : null}
        {uniqueReferences.map((r) => (
          <LinkOut key={r.id} href={r.url}>
            {REFERENCE_LABELS[r.kind] ?? r.kind}
          </LinkOut>
        ))}
        {!clUrl && !byNumberReport && !uniqueReferences.length ? (
          <span className="text-muted-foreground">No source links recorded</span>
        ) : null}
      </div>
    </section>
  );
}
