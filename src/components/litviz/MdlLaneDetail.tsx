/** The detailed lifecycle lane of one MDL: pending actions (JPML monthly reports and fiscal-year ends), actions
 * closed and remanded per fiscal year, FJC civil cases carrying the number, docket entries and filings collected, with
 * the motion, centralization and closing dates ruled across every band. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChartFrame, type ChartSource } from "@/components/charts/ChartFrame";
import { LaneTracks, laneDomain } from "@/components/charts/Lanes";
import { metricFormatter } from "@/components/charts/format";
import { isUnverifiedBasis, monthIndex, STATUS_LABEL } from "@/lib/litviz/model";
import type { MdlDetail } from "@/lib/litviz/signals";
import { mdlLaneQuery } from "./queries";
import {
  DATASET_NAMES,
  eventText,
  lifecycleTracks,
  mdlMarkers,
  rowSources,
  seriesTable,
} from "./tracks";

const count = metricFormatter("count");

export function todayIndex(today: string | null): number {
  const t = monthIndex((today ?? new Date().toISOString()).slice(0, 7));
  return t ?? 0;
}

export function lifecycleNotes(d: MdlDetail): string[] {
  const out: string[] = [];
  const m = d.meta;
  if (m?.docketTotal)
    out.push(
      `${count.full(m.docketTotal)} master-docket entries are held${m.docketUndated ? `; ${count.full(m.docketUndated)} have no usable date and are not drawn` : ""}. Counts are of the entries collected, which can be a small part of the docket.`,
    );
  if (m?.filings)
    out.push(
      `${count.full(m.filings)} court filings are listed for this MDL${m.filingsUndated ? `; ${count.full(m.filingsUndated)} have no recorded filing date and are not drawn` : ""}.`,
    );
  const unverified = d.rows.filter((r) => isUnverifiedBasis(r.basis)).length;
  if (unverified)
    out.push(
      `${unverified} fiscal-year value${unverified === 1 ? " is" : "s are"} listed in the table but not drawn: the JPML extraction could not verify that the line belongs to this MDL.`,
    );
  return out;
}

export function MdlLaneDetail({
  mdl,
  headingLevel = "h3",
  showPageLink = false,
}: {
  mdl: string;
  headingLevel?: "h2" | "h3";
  showPageLink?: boolean;
}) {
  const q = useQuery(mdlLaneQuery(mdl));
  const d = q.data ?? null;
  const tracks = d ? lifecycleTracks(d.rows) : [];
  const markers = d ? mdlMarkers(d.attributes) : [];
  const domain = d
    ? laneDomain(
        tracks.map((t) =>
          t.kind === "line" ? { points: t.points } : t.kind === "bins" ? { bins: t.bins } : {},
        ),
        markers,
        todayIndex(d.today),
      )
    : null;
  const sources: ChartSource[] = d
    ? [
        ...rowSources(d.rows, DATASET_NAMES),
        ...(d.attributes.dates.closedSourceUrl
          ? [{ label: "JPML recently terminated MDLs", url: d.attributes.dates.closedSourceUrl }]
          : []),
      ]
    : [
        {
          label: "JPML pending MDL reports",
          url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
        },
      ];
  const a = d?.attributes;
  return (
    <ChartFrame
      title={`Lifecycle of MDL No. ${mdl}`}
      headingLevel={headingLevel}
      period={
        domain ? `${Math.floor(domain[0] / 12)}–${Math.floor(domain[1] / 12) - 1}` : undefined
      }
      sources={sources}
      minHeight={260}
      status={
        q.isPending
          ? { kind: "loading" }
          : q.isError
            ? {
                kind: "error",
                message: "This MDL's lifecycle could not be read just now.",
                onRetry: () => void q.refetch(),
              }
            : !d || !domain
              ? {
                  kind: "empty",
                  reason: `No JPML report, docket entry or filing of MDL No. ${mdl} is held.`,
                }
              : { kind: "ready" }
      }
      partialNotice={d?.notices.length ? d.notices.join(" ") : undefined}
      actions={
        showPageLink ? (
          <Link
            to="/matters/$id"
            params={{ id: mdl }}
            search={{ tab: "lifecycle" }}
            className="rounded text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Open the MDL page
          </Link>
        ) : null
      }
      notes={[
        "Each band has its own scale; the number at its top right is the band's highest gridline.",
        "Actions pending joins the JPML's fiscal-year totals (September 30) and its monthly reports; a missing period leaves a gap.",
        "Shaded bars are periods still in progress. Vertical rules mark the motion, the transfer order and the closing date where the JPML records them.",
        "Civil cases carrying the MDL number come from the FJC Integrated Database: a historical association, not proof that a case is part of the MDL.",
      ]}
      footnotes={d ? lifecycleNotes(d) : undefined}
      table={d ? seriesTable(d.rows, `MDL No. ${mdl}: every value drawn`) : undefined}
    >
      {d && domain && a ? (
        <>
          <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11.5px] sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Status</dt>
            <dd>{STATUS_LABEL[a.status]}</dd>
            <dt className="text-muted-foreground">Transferee court</dt>
            <dd className="min-w-0 truncate">
              {a.court.id ? (
                <Link
                  to="/courts/$id"
                  params={{ id: a.court.id }}
                  className="text-primary hover:underline"
                >
                  {a.court.label ?? a.court.id}
                </Link>
              ) : (
                (a.court.label ?? "Not recorded")
              )}
            </dd>
            <dt className="text-muted-foreground">Centralized</dt>
            <dd>{eventText(a.dates.centralized)}</dd>
            <dt className="text-muted-foreground">Transferee judge</dt>
            <dd className="min-w-0 truncate">
              {a.judge.href ? (
                <Link to={a.judge.href as never} className="text-primary hover:underline">
                  {a.judge.name}
                </Link>
              ) : (
                (a.judge.name ?? "Not recorded")
              )}
            </dd>
            {a.dates.closed || a.dates.closedYear ? (
              <>
                <dt className="text-muted-foreground">Closed</dt>
                <dd>
                  {a.dates.closed
                    ? eventText(a.dates.closed)
                    : `In ${a.dates.closedYear} (JPML terminated-litigation table)`}
                </dd>
              </>
            ) : null}
          </dl>
          <LaneTracks
            tracks={tracks}
            markers={markers}
            domain={domain}
            ariaLabel={`Lifecycle of MDL No. ${mdl}: ${tracks.map((t) => t.label).join("; ")}.`}
          />
        </>
      ) : null}
    </ChartFrame>
  );
}
