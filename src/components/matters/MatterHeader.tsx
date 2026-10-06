import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { CorpusRecordLink } from "@/components/corpus/DatasetBrowser";
import { Chip, Fact, LinkOut, NotRecorded } from "@/components/matters/common";
import { formatBytes } from "@/lib/matters/documents";
import { getMatterDocumentsSummary } from "@/lib/matters/matters.functions";
import { judgeLinkBasisLabel, judgePersonBasisLabel, orNotRecorded } from "@/lib/matters/overview";
import { registryMetrics } from "@/lib/matters/registry";
import type { MatterOverviewPayload } from "@/lib/matters/types";
import { getEntity } from "@/lib/external/entity.functions";
import { buildEntityView } from "@/lib/external/entityView";
import { fileUrl } from "@/lib/external/groups";

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
 * verified PDF source records open and held. Nothing here is the size of the MDL except the JPML counts.
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
  const live = payload.liveRegistry;
  const notInRegistry = "MDL not in the matter registry";
  const pdf = docs.data && docs.data.connected ? docs.data.summary : null;
  return (
    <div
      aria-label="Matter metrics"
      role="group"
      className="grid divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x"
    >
      <Metric
        label="JPML actions"
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
        label={m ? "Member-like dockets" : "Dockets in the saved sample"}
        title={
          m
            ? "Member and transferor dockets the Seeger Weiss matter registry holds for this MDL, each with its evidence. The master docket and the JPML panel proceeding are listed on the Member cases tab but are not counted here; never the size of the MDL."
            : "Dockets in this matter's saved sample (the same list as the Member cases tab). Not the size of the MDL."
        }
        value={
          m && m.dockets !== null ? (
            n(m.dockets)
          ) : !m && o.cases?.total != null ? (
            n(o.cases.total)
          ) : (
            <NotRecorded />
          )
        }
        note={m ? "Evidence-backed; partial count" : `Saved sample · ${notInRegistry}`}
      />
      <Metric
        label="Docket entries"
        title="Entries the registry holds for the master docket (against the total the provider reports, when the matter record has it). Counted from the registry's docket entries, the same rows as the Docket entries tab."
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
          ) : live.entries ? (
            n(live.entries)
          ) : (
            <span className="font-normal text-muted-foreground">Not yet available</span>
          )
        }
        note={
          !m?.entries && live.entries
            ? `Registry docket entries · ${notInRegistry}`
            : m?.entries
              ? [
                  m.entries.complete === true
                    ? "complete at last check"
                    : m.entries.complete === false
                      ? "partial"
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
        label="Parties & counsel"
        title="Parties of the master docket the registry published, and the counsel entries on them."
        value={
          m?.parties && m.parties.published !== null ? (
            <>
              {n(m.parties.published)}
              <span className="font-normal text-muted-foreground"> parties</span>
            </>
          ) : live.parties ? (
            <>
              {n(live.parties)}
              <span className="font-normal text-muted-foreground"> parties</span>
            </>
          ) : (
            <span className="font-normal text-muted-foreground">Not yet available</span>
          )
        }
        note={
          m?.parties && m.parties.counselLinks !== null
            ? `${n(m.parties.counselLinks)} counsel entries`
            : !m?.parties && live.parties
              ? `Registry parties · ${notInRegistry}`
              : undefined
        }
      />
      <Metric
        label="Verified PDF source records"
        title="Provider-native records in the private verified PDF archive for the master and JPML dockets: open (linkable) and held (no link). Duplicate bytes can appear under multiple source records."
        value={
          pdf ? (
            <>
              {pdf.open.toLocaleString()} open records
              <span className="font-normal text-muted-foreground">
                {" "}
                · {pdf.held.toLocaleString()} held records
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
            ? `${pdf.total.toLocaleString()} source records${pdf.openBytes ? ` · ${formatBytes(pdf.openBytes)}` : ""}`
            : docs.data && !docs.data.connected
              ? "Archive not connected"
              : undefined
        }
      />
      {m?.lastCaptured || payload.master?.dateLastFiling || payload.master?.sourceCheckedAt ? (
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-5">
          {payload.master?.dateLastFiling ? (
            <span>
              Last filing on the master docket{" "}
              <span className="font-mono text-foreground">{payload.master.dateLastFiling}</span>
            </span>
          ) : null}
          {payload.master?.sourceCheckedAt ? (
            <span>
              CourtListener checked —{" "}
              <span className="font-mono text-foreground">
                {payload.master.sourceCheckedAt.slice(0, 10)}
              </span>
            </span>
          ) : null}
          {m?.lastCaptured ? (
            <span>
              Registry coverage updated{" "}
              <span className="font-mono text-foreground">{m.lastCaptured}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const officialCourtMarks: Record<
  string,
  { src: string; source: string; shape: "seal" | "banner" }
> = {
  cand: {
    src: "/court-marks/cand.svg",
    source: "https://cand.uscourts.gov/",
    shape: "seal",
  },
  njd: {
    src: "/court-marks/njd.png",
    source: "https://www.njd.uscourts.gov/",
    shape: "seal",
  },
  paed: {
    src: "/court-marks/paed.png",
    source: "https://www.paed.uscourts.gov/",
    shape: "seal",
  },
  flsd: {
    src: "/court-marks/flsd.png",
    source: "https://www.flsd.uscourts.gov/",
    shape: "seal",
  },
  scd: {
    src: "/court-marks/scd.gif",
    source: "https://www.scd.uscourts.gov/",
    shape: "banner",
  },
};

/** Uses an official, locally stored mark only for an exact CourtListener court ID. */
function CourtSeal({ id, title }: { id: string; title: string }) {
  const officialMark = officialCourtMarks[id];
  const getEntityFn = useServerFn(getEntity);
  const court = useQuery({
    queryKey: ["court-profile-image", id],
    queryFn: async () => (await getEntityFn({ data: { dataset: "court_spine", id } })).json,
    staleTime: Infinity,
    enabled: !officialMark,
  });
  const src = useMemo(() => {
    if (!court.data) return null;
    try {
      const raw = JSON.parse(court.data) as Record<string, unknown>;
      const links = buildEntityView(raw).links.filter(
        (link) => link.url.startsWith("/") && /seal|image|logo/i.test(link.label),
      );
      const source = links.find((link) => /seal/i.test(link.label)) ?? links[0];
      return source ? { src: source.url, label: source.label } : null;
    } catch {
      return null;
    }
  }, [court.data]);
  const [failed, setFailed] = useState(false);
  if (officialMark) {
    return (
      <img
        src={officialMark.src}
        alt={`${title} official court ${officialMark.shape === "banner" ? "mark" : "seal"}`}
        title={`Official court artwork · ${officialMark.source}`}
        className={`size-9 shrink-0 border border-border bg-white ${
          officialMark.shape === "banner"
            ? "rounded-md object-cover object-left"
            : "rounded-full object-contain p-1"
        }`}
        loading="lazy"
      />
    );
  }
  if (!src || failed) return null;
  return (
    <img
      src={fileUrl(src.src)}
      alt={`${title} ${src.label}`}
      className="size-9 shrink-0 rounded-full border border-border bg-white object-contain p-1"
      loading="lazy"
      onError={() => setFailed(true)}
    />
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
            Priority tier {sw.tier}
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
              Membership evidence
              {registry.members.rows !== null
                ? ` · ${registry.members.rows.toLocaleString()} member-like dockets`
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
          <div className="flex items-center gap-2">
            {o.court.clId ? (
              <CourtSeal
                id={o.court.clId}
                title={o.court.shortName ?? o.court.fullName ?? "Court"}
              />
            ) : null}
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
          </div>
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
        <Fact label="Transferee judge">
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
              <details className="mt-1 text-[11px] text-muted-foreground">
                <summary className="w-fit cursor-pointer underline decoration-dotted underline-offset-2">
                  Judge record details
                </summary>
                <div className="mt-1 space-y-0.5">
                  {judge.printedName &&
                  judge.printedName !== (judgeProfile?.name ?? judge.profileName) ? (
                    <div>JPML lists the judge as “{judge.printedName}”.</div>
                  ) : null}
                  <div>
                    {judgeProfile
                      ? `Profile linked${profileBasis ? `: ${profileBasis}` : ""}.`
                      : "No linked judge profile is recorded."}
                  </div>
                  {judge.clPersonId ? (
                    <div>
                      CourtListener person{" "}
                      <CorpusRecordLink
                        dataset="cl_people"
                        id={`cl:people:${judge.clPersonId}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {judge.clPersonId}
                      </CorpusRecordLink>
                      {personBasis ? ` (${personBasis})` : ""}
                    </div>
                  ) : null}
                  {referred ? (
                    <div>Referred to on the CourtListener docket: {referred.sourceString}</div>
                  ) : null}
                </div>
              </details>
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

      <details className="border-t border-border px-4 py-2 text-[12px]">
        <summary className="w-fit cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
          Source & coverage details
        </summary>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          JPML action totals describe the MDL. Member-like dockets have recorded relationship
          evidence and are a partial count, not a census.
          {payload.master?.sourceAsOf
            ? ` Original selection snapshot: ${payload.master.sourceAsOf}.`
            : ""}
          {payload.master?.sourceCheckedAt
            ? ` CourtListener checked ${payload.master.sourceCheckedAt.slice(0, 10)}.`
            : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {clUrl ? <LinkOut href={clUrl}>CourtListener master docket</LinkOut> : null}
          {byNumberReport?.officialUrl ? (
            <LinkOut href={byNumberReport.officialUrl}>
              JPML MDL statistics
              {byNumberReport.reportDate ? ` · ${byNumberReport.reportDate}` : ""}
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
      </details>
    </section>
  );
}
