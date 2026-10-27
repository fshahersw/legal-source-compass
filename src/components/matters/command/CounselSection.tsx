/**
 * Leadership, parties and counsel. Court-appointed leadership comes only from the transferee court's own page (quoted
 * as listed) and the leadership orders on the docket. The defendant roster reads parties whose printed type is exactly
 * "Defendant" (mixed types are listed apart), with dismissals by month and defense firms as printed: firm spellings are
 * never merged, and PACER's "Lead attorney" flag is not court-appointed leadership.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChartCard, RankBars, TrendColumns, periodTable } from "@/components/charts/recharts";
import { Card, CardBody, DataDrawer, KpiStrip, type DataColumn } from "@/components/kit";
import { CasesPanel } from "@/components/matters/CasesPanel";
import { SampleCourtsCard } from "@/components/matters/OverviewPanel";
import { PartiesPanel } from "@/components/matters/PartiesPanel";
import { LeadershipList } from "@/components/mdl/LeadershipList";
import type { DefendantRow, MdlCommandPayload } from "@/lib/matters/types";
import { mdlDefendantsQuery } from "./commandQueries";
import { kindRows } from "./commandView";
import { Disclosure, Note, Out, Unavailable, day, fmt } from "./shared";

const PARTIES_SOURCE = {
  label: "Master-docket parties (CourtListener RECAP)",
  url: "https://www.courtlistener.com/recap/",
};

const rosterColumns: DataColumn<DefendantRow>[] = [
  { key: "name", label: "Party as printed", value: (r) => r.name },
  { key: "types", label: "Party type", value: (r) => r.types.join(" / ") },
  { key: "terminated", label: "Terminated", value: (r) => r.dateTerminated },
  { key: "counsel", label: "Counsel listed", align: "right", value: (r) => r.counselCount },
  { key: "firms", label: "Firms as printed", value: (r) => r.firms.join("; ") },
];

function Leadership({ cmd }: { cmd: MdlCommandPayload }) {
  const page = cmd.lens?.courtPage ?? null;
  const orders = useMemo(() => kindRows(cmd.orders?.entries ?? [], ["leadership"]), [cmd.orders]);
  if (!page?.leadership.length && !orders.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {page?.leadership.length ? (
        <Card>
          <CardBody className="pt-4">
            <h3 className="text-label text-foreground">Leadership as the court lists it</h3>
            <LeadershipList
              sections={page.leadership}
              moreRoles={page.leadershipMore}
              moreUrl={page.leadershipMoreUrl}
              className="mt-2"
            />
            <Note>
              Quoted from the transferee court's MDL page
              {page.pages[0] ? (
                <>
                  {" "}
                  (<Out href={page.pages[0].url}>{page.pages[0].title}</Out>)
                </>
              ) : null}
              ; contact details removed.
            </Note>
          </CardBody>
        </Card>
      ) : null}
      {orders.length ? (
        <Card>
          <CardBody className="pt-4">
            <h3 className="text-label text-foreground">
              Leadership orders on the docket{" "}
              <span className="tabular-nums text-muted-foreground">· {fmt(orders.length)}</span>
            </h3>
            <ul className="mt-2 space-y-1.5 text-body">
              {orders.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <span className="tabular-nums text-muted-foreground">{day(r.date)}</span> ·{" "}
                  <Out href={r.sourceUrl}>
                    {r.title.length > 150 ? `${r.title.slice(0, 149)}…` : r.title}
                  </Out>
                </li>
              ))}
            </ul>
            <Note>Appointee names are in the order documents, not the docket text.</Note>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function Defendants({ cmd }: { cmd: MdlCommandPayload }) {
  const q = useQuery(mdlDefendantsQuery(cmd.mdl));
  if (q.isPending)
    return (
      <div
        className="h-40 animate-pulse rounded-xl border border-border bg-muted/40"
        aria-busy="true"
      />
    );
  if (q.isError) return <Unavailable what="The defendant roster" />;
  const d = q.data;
  if (!d.defendants.length && !d.mixed.length) return <Note>{d.captureNote}</Note>;
  const terminated = d.defendants.filter((r) => r.dateTerminated).length;
  const all = [...d.defendants, ...d.mixed];
  const topFirm = d.firms[0];
  return (
    <div className="space-y-4">
      <KpiStrip
        label="Defendants"
        cellBasis="basis-[calc(50%-1px)] xl:basis-[calc(25%-1px)]"
        items={[
          {
            key: "def",
            label: "Defendant parties",
            value: fmt(d.defendants.length),
            meta: 'Printed type exactly "Defendant"',
          },
          {
            key: "term",
            label: "Terminated (dismissed or otherwise)",
            value: fmt(terminated),
            meta: "Date terminated on the docket",
          },
          {
            key: "mixed",
            label: "Listed with another type",
            value: fmt(d.mixed.length),
            meta: '"Defendant / Plaintiff" and similar',
          },
          {
            key: "firms",
            label: "Defense firm lines",
            value: fmt(d.firms.length),
            meta: "As printed, never merged",
          },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={
            d.terminatedByMonth.length
              ? `${fmt(terminated)} defendant parties terminated on the master docket`
              : "Defendant terminations by month"
          }
          subtitle="Defendant parties by month of termination · master docket"
          status={
            d.terminatedByMonth.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No defendant party has a termination date." }
          }
          sources={[PARTIES_SOURCE]}
          partial={d.captureNote}
          table={periodTable(
            d.terminatedByMonth,
            "month",
            [{ key: "count", label: "Defendants terminated" }],
            fmt,
            {
              caption: `MDL ${cmd.mdl}: defendant parties terminated per month`,
              xLabel: "Month",
            },
          )}
          about={
            <p>
              A termination date ends the party's role on this docket; the docket does not say why
              here.
            </p>
          }
        >
          <TrendColumns
            rows={d.terminatedByMonth}
            xKey="month"
            series={[{ key: "count", label: "Defendants terminated" }]}
            format={fmt}
            ariaLabel={`Defendant parties terminated per month, MDL ${cmd.mdl}`}
          />
        </ChartCard>
        <ChartCard
          title={
            topFirm
              ? `${topFirm.firm} represents the most defendant parties (${fmt(topFirm.parties)})`
              : "Defense firms"
          }
          subtitle="Defendant parties represented, by firm line as printed"
          status={
            d.firms.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No active counsel is listed for the defendants." }
          }
          sources={[PARTIES_SOURCE]}
          partial={d.captureNote}
          table={{
            caption: `MDL ${cmd.mdl}: defense firms by defendant parties represented`,
            columns: [{ label: "Firm as printed" }, { label: "Defendant parties", align: "right" }],
            rows: d.firms.map((f) => ({ key: f.firm, cells: [f.firm, fmt(f.parties)] })),
          }}
          about={
            <p>
              Firm lines are shown exactly as printed; spelling variants of one firm stay separate.
              "Lead attorney" on PACER is a per-party flag, not a court appointment.
            </p>
          }
        >
          <RankBars
            items={d.firms.map((f) => ({ id: f.firm, label: f.firm, value: f.parties }))}
            limit={10}
            format={fmt}
            ariaLabel={`Defense firms by defendant parties represented, MDL ${cmd.mdl}`}
          />
        </ChartCard>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DataDrawer
          title={`MDL ${cmd.mdl}: defendant roster`}
          triggerLabel={`View all ${fmt(all.length)} defendant parties`}
          rows={all}
          rowKey={(r) => r.id}
          columns={rosterColumns}
          searchable
          source={{
            source: { label: PARTIES_SOURCE.label, href: PARTIES_SOURCE.url },
            about: <p>{d.captureNote}</p>,
          }}
        />
        <span className="text-meta text-muted-foreground">{d.captureNote}</span>
      </div>
    </div>
  );
}

export function CounselSection({
  cmd,
  open,
}: {
  cmd: MdlCommandPayload;
  /** Open the cases and parties lists (a former ?tab=cases or ?tab=parties address). */
  open: boolean;
}) {
  const payload = cmd.overview;
  return (
    <div className="space-y-4">
      <Leadership cmd={cmd} />
      <Defendants cmd={cmd} />
      {payload ? (
        <Disclosure title="Member cases, parties and counsel lists" defaultOpen={open}>
          <CasesPanel payload={payload} />
          <SampleCourtsCard payload={payload} />
          <PartiesPanel payload={payload} />
        </Disclosure>
      ) : null}
    </div>
  );
}
