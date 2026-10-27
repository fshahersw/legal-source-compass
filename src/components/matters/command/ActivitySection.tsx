/**
 * Docket activity: entries per month on the master docket (litviz), key orders entered per year by family (the
 * classifier), the typed events the docket-link dataset itself assigns, and the full docket entry list on demand.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChartCard, RankBars } from "@/components/charts/recharts";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import { DataDrawer, type DataColumn } from "@/components/kit";
import { DocketPanel } from "@/components/matters/DocketPanel";
import { ProfileTrend } from "@/components/trends/ProfileTrend";
import { ORDERS_RULE_VERSION } from "@/lib/matters/orders";
import type { MdlCommandPayload, TypedEvent } from "@/lib/matters/types";
import { mdlTypedEventsQuery } from "./commandQueries";
import { YEAR_GROUPS, ordersPerYear } from "./commandView";
import { Disclosure, Out, collectedNote, day, docketSource, fmt } from "./shared";

const TYPED_SOURCE = {
  label: "Docket links (mdl_docket_activity, mdl_docket_documents)",
  url: "https://www.courtlistener.com/recap/",
};

const eventColumns: DataColumn<TypedEvent>[] = [
  { key: "type", label: "Type (source's own)", value: (r) => r.documentType },
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "basis", label: "Date basis", value: (r) => r.dateBasis },
  { key: "entry", label: "Entry", value: (r) => r.entryNumber },
  {
    key: "attribution",
    label: "Linked by",
    value: (r) => (r.attribution === "mdl" ? "MDL number" : "Exact master docket"),
  },
  {
    key: "url",
    label: "Evidence",
    value: (r) => r.evidenceUrl,
    render: (r) => <Out href={r.evidenceUrl}>{r.evidenceUrl ? "Open" : ""}</Out>,
  },
];

function TypedEvents({ cmd }: { cmd: MdlCommandPayload }) {
  const q = useQuery(mdlTypedEventsQuery(cmd.mdl));
  const d = q.data;
  const typed = d ? d.byType.filter((t) => t.type && t.type !== "Other") : [];
  const top = typed[0];
  return (
    <ChartCard
      title={
        top
          ? `${top.type} is the most frequent typed docket event (${fmt(top.count)})`
          : "Typed docket events"
      }
      subtitle={`Docket events by the source's own type${d?.window.first ? ` · ${day(d.window.first)} to ${day(d.window.last)}` : ""}`}
      status={
        q.isPending
          ? { kind: "loading" }
          : q.isError
            ? { kind: "error", onRetry: () => void q.refetch() }
            : typed.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No typed docket event is linked to this MDL." }
      }
      sources={[TYPED_SOURCE]}
      partial={d?.window.last ? `Collected through ${day(d.window.last)}; later events are not collected.` : undefined}
      table={
        d
          ? {
              caption: `MDL ${cmd.mdl}: typed docket events by type`,
              columns: [
                { label: "Type" },
                { label: "Events", align: "right" },
                { label: "First", align: "right" },
                { label: "Last", align: "right" },
                { label: "Undated", align: "right" },
              ],
              rows: d.byType.map((t) => ({
                key: t.type,
                cells: [t.type, fmt(t.count), t.first ?? "Not recorded", t.last ?? "Not recorded", fmt(t.undated)],
              })),
            }
          : undefined
      }
      about={
        <p>
          The type is the dataset's own topic tag, not this page's classifier; a tag can name a
          letter or stipulation about the topic.
          {d?.blankMdlAttributed
            ? ` ${fmt(d.blankMdlAttributed)} events with no MDL number are attributed by this MDL's exact master docket.`
            : ""}
        </p>
      }
      actions={
        d?.events.length ? (
          <DataDrawer
            title={`MDL ${cmd.mdl}: typed docket events`}
            rows={d.events}
            rowKey={(r) => `${r.sourceDataset}:${r.sourceRecordId}`}
            columns={eventColumns}
            searchable
            source={{ source: { label: TYPED_SOURCE.label, href: TYPED_SOURCE.url } }}
          />
        ) : null
      }
    >
      <RankBars
        items={typed.map((t) => ({ id: t.type, label: t.type, value: t.count }))}
        limit={10}
        format={fmt}
        ariaLabel={`Typed docket events by type, MDL ${cmd.mdl}`}
      />
    </ChartCard>
  );
}

export function ActivitySection({ cmd, open }: { cmd: MdlCommandPayload; open: boolean }) {
  const through = cmd.orders?.coverage.collectedThrough ?? null;
  const years = useMemo(() => ordersPerYear(cmd.orders?.entries ?? [], through), [cmd.orders, through]);
  const docket = docketSource(cmd);
  const total = years.reduce(
    (a, r) => a + Object.values(r.values).reduce<number>((s, v) => s + (v ?? 0), 0),
    0,
  );
  const labels = Object.fromEntries(YEAR_GROUPS.map((g) => [g.key, g.label]));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileTrend kind="matter-docket-entries" id={cmd.mdl} />
        <ChartCard
          title={
            years.length
              ? `${fmt(total)} key orders entered, ${years[0]!.period} to ${years.at(-1)!.period}`
              : "Key orders entered per year"
          }
          subtitle={`Court-entered key orders per year, by family · rule ${ORDERS_RULE_VERSION}`}
          status={years.length ? { kind: "ready" } : { kind: "empty", reason: "No classified order in the collected docket text." }}
          sources={[docket]}
          partial={collectedNote(through)}
          table={{
            caption: `MDL ${cmd.mdl}: key orders entered per year by family`,
            columns: [{ label: "Year" }, ...YEAR_GROUPS.map((g) => ({ label: g.label, align: "right" as const }))],
            rows: [...years].reverse().map((r) => ({
              key: r.period,
              cells: [
                `${r.period}${r.partial ? " (partial)" : ""}`,
                ...YEAR_GROUPS.map((g) => fmt(r.values[g.key] ?? 0)),
              ],
            })),
          }}
          about={
            <p>
              Only entries the court entered (orders, judgments, verdicts) whose text starts with the
              order's own wording; each counts once, in its first family. The last year is partial.
            </p>
          }
        >
          <StackedBarsOverTime rows={years} keys={YEAR_GROUPS.map((g) => g.key)} labels={labels} format={fmt} />
        </ChartCard>
      </div>
      <TypedEvents cmd={cmd} />
      {cmd.overview ? (
        <Disclosure title="All docket entries" defaultOpen={open}>
          <DocketPanel payload={cmd.overview} />
        </Disclosure>
      ) : null}
    </div>
  );
}
