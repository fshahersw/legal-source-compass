import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CorpusRecordLink } from "@/components/corpus/DatasetBrowser";
import { Chip, Fact, LinkOut, NotRecorded } from "@/components/matters/common";
import { evidenceKindLabel } from "@/lib/matters/cases";
import { formatBytes } from "@/lib/matters/documents";
import { getMatterDocumentsSummary } from "@/lib/matters/matters.functions";
import { judgeLinkBasisLabel, judgePersonBasisLabel, orNotRecorded } from "@/lib/matters/overview";
import { registryMetrics } from "@/lib/matters/registry";
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

/** One cell of the metrics band: a label, the number, and one line saying what it counts. */
function Metric({
  label,
  value,
  note,
  title,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-2.5" title={title}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 break-words text-[15px] font-semibold leading-tight tabular-nums">
        {value}
      </div>
      {note ? (
        <div className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
          {note}
        </div>
      ) : null}
    </div>
  );
}

const n = (v: number | null) => (v === null ? null : v.toLocaleString());

/**
 * The matter's numbers in one band, every one computed from the corpus: JPML counts (as of the report date), the
 * registry's dockets and their evidence, entries captured against what the provider reports, parties published, and
 * the verified PDFs open and held. Nothing here is the size of the MDL except the JPML counts.
 */
function MetricsBand({ payload }: { payload: MatterOverviewPayload }) {
  const o = payload.overview;
  const docsFn = useServerFn(getMatterDocumentsSummary);
  const docs = useQuery({
    queryKey: ["matter-documents-summary", o.mdl],
    queryFn: () => docsFn({ data: { id: o.mdl } }),
    staleTime: 5 * 60_000,
  });
  const m = registryMetrics(payload.registry);
  const pdf = docs.data && docs.data.connected ? docs.data.summary : null;
  const topKinds = (m?.byBasis ?? []).slice(0, 3);
  const moreKinds = (m?.byBasis.length ?? 0) - topKinds.length;
  return (
    <div
      aria-label="Matter metrics"
      role="group"
      className="grid divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x"
    >
      <Metric
        label="Actions (JPML)"
        title="Counts from the JPML report; the size of the MDL."
        value={
          o.actions.pending !== null || o.actions.total !== null ? (
            <>
              {orNotRecorded(o.actions.pending)} pending
              <span className="font-normal text-muted-foreground">
                {" "}
                / {orNotRecorded(o.actions.total)} total
              </span>
            </>
          ) : (
            <NotRecorded />
          )
        }
        note={o.asOf ? `JPML report ${o.asOf}` : (o.countsLabel ?? undefined)}
      />
      <Metric
        label="Registry dockets"
        title="Dockets the Seeger Weiss matter registry holds for this MDL, each with its evidence; never the size of the MDL."
        value={m && m.dockets !== null ? n(m.dockets) : <NotRecorded />}
        note={
          m && topKinds.length
            ? `${topKinds.map((k) => `${evidenceKindLabel(k.kind)} ${k.count.toLocaleString()}`).join(" · ")}${moreKinds > 0 ? ` · +${moreKinds} more` : ""}`
            : m
              ? "No evidence recorded"
              : "Not in the matter registry"
        }
      />
      <Metric
        label="Docket entries"
        title="CourtListener entries the registry captured for the master docket against the total the provider reports."
        value={
          m?.entries && m.entries.captured !== null ? (
            <>
              {n(m.entries.captured)}
              {m.entries.providerTotal !== null ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  / {n(m.entries.providerTotal)} reported
                </span>
              ) : null}
            </>
          ) : (
            <span className="font-normal text-muted-foreground">Not yet available</span>
          )
        }
        note={
          m?.entries
            ? [
                m.entries.complete === true
                  ? "complete at capture"
                  : m.entries.complete === false
                    ? "capture continues"
                    : null,
                m.entries.published !== null ? `${n(m.entries.published)} published` : null,
                m.entries.withheld ? `${n(m.entries.withheld)} without text` : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined
        }
      />
      <Metric
        label="Parties and counsel"
        title="Parties of the master docket the registry published, and the counsel entries on them."
        value={
          m?.parties && m.parties.published !== null ? (
            <>
              {n(m.parties.published)}
              <span className="font-normal text-muted-foreground"> parties</span>
            </>
          ) : (
            <span className="font-normal text-muted-foreground">Not yet available</span>
          )
        }
        note={
          m?.parties && m.parties.counselLinks !== null
            ? `${n(m.parties.counselLinks)} counsel entries`
            : undefined
        }
      />
      <Metric
        label="Verified PDFs"
        title="Documents in the private verified PDF archive for the master and JPML dockets: open (linkable) and held (no link)."
        value={
          pdf ? (
            <>
              {pdf.open.toLocaleString()} open
              <span className="font-normal text-muted-foreground">
                {" "}
                · {pdf.held.toLocaleString()} held
              </span>
            </>
          ) : docs.isLoading ? (
            <span className="font-normal text-muted-foreground">…</span>
          ) : (
            <NotRecorded />
          )
        }
        note={
          pdf
            ? `${pdf.total.toLocaleString()} documents${pdf.openBytes ? ` · ${formatBytes(pdf.openBytes)}` : ""}`
            : docs.data && !docs.data.connected
              ? "Archive not connected"
              : undefined
        }
      />
      {m?.lastCaptured || payload.master?.dateLastFiling ? (
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-5">
          {payload.master?.dateLastFiling ? (
            <span>
              Last filing on the master docket{" "}
              <span className="font-mono text-foreground">{payload.master.dateLastFiling}</span>
              {payload.master.sourceAsOf
                ? ` (CourtListener metadata as of ${payload.master.sourceAsOf})`
                : ""}
            </span>
          ) : null}
          {m?.lastCaptured ? (
            <span>
              Registry captures last observed{" "}
              <span className="font-mono text-foreground">{m.lastCaptured}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Master docket header: court, docket number, presiding judge, dates, status, the matter's numbers and source links. */
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
  const profileBasis = judgeLinkBasisLabel(judge.profileLinkBasis) ?? judge.evidenceNote;
  const personBasis = judgePersonBasisLabel(judge.clPersonBasis);

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

      <MetricsBand payload={payload} />

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
          {judge.printedName || judge.profileName || judgeProfile ? (
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
                  ? `Profile linked${profileBasis ? `: ${profileBasis}` : ""}.`
                  : "No profile link: no profile id is recorded for this MDL's judge."}
              </span>
              {judge.clPersonId ? (
                <span className="block text-[11px] text-muted-foreground">
                  CourtListener person{" "}
                  <CorpusRecordLink
                    dataset="cl_people"
                    id={`cl:people:${judge.clPersonId}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {judge.clPersonId}
                  </CorpusRecordLink>
                  {personBasis ? ` (${personBasis})` : ""}
                </span>
              ) : null}
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
