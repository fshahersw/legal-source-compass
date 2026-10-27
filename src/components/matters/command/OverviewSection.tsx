/**
 * The page's answer: 4-6 headline figures, then three charts (pending trend, actions added per report, the key-order
 * timeline) and the AI summary of exactly those figures.
 */
import { useMemo } from "react";
import {
  ChartCard,
  TrendColumns,
  TrendLines,
  periodTable,
  trendTakeaway,
} from "@/components/charts/recharts";
import { Swimlanes } from "@/components/charts/Swimlanes";
import { KpiCard, KpiGrid } from "@/components/kit";
import { MatterAi } from "@/components/matters/MatterAi";
import { docketedNote } from "@/lib/matters/docketDates";
import { ORDERS_RULE_VERSION } from "@/lib/matters/orders";
import type { MdlCommandPayload } from "@/lib/matters/types";
import {
  NUMBERED_LABEL,
  SWIM_GROUPS,
  addedRows,
  headline,
  numberedMeta,
  orderSwimlanes,
  sortedPoints,
  type Headline,
} from "./commandView";
import { collectedNote, day, docketSource, fmt, jpmlSource, signed } from "./shared";

const monthTick = (v: string) =>
  /^\d{4}-\d{2}/.test(v)
    ? new Date(`${v.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      })
    : v;

function Kpis({ cmd, h }: { cmd: MdlCommandPayload; h: Headline }) {
  const jpml = jpmlSource(cmd);
  const docket = docketSource(cmd);
  const cards = [
    <KpiCard
      key="pending"
      as="li"
      label="Actions pending"
      value={h.pending ? fmt(h.pending.value) : null}
      unit="actions"
      meta={h.pending ? `JPML report of ${day(h.pending.date)}` : "JPML report"}
      delta={
        h.pending?.prior
          ? {
              value: h.pending.value - h.pending.prior.value,
              kind: "absolute",
              detail: `vs ${day(h.pending.prior.date)}`,
            }
          : null
      }
      source={{ source: { label: jpml.label, href: jpml.url } }}
    />,
    <KpiCard
      key="added"
      as="li"
      label="Actions added, latest report interval"
      value={h.added ? signed(h.added.value) : null}
      unit="actions"
      meta={
        h.added
          ? `${day(h.added.from)} to ${day(h.added.to)} · ${h.added.days} days`
          : "Needs two JPML reports"
      }
      footnote={
        h.added?.negative
          ? "The published total fell between the two reports; the report does not say why."
          : "Difference of the two published totals."
      }
      source={{ source: { label: jpml.label, href: jpml.url } }}
    />,
    <KpiCard
      key="orders"
      as="li"
      label={NUMBERED_LABEL}
      value={h.numbered && h.numbered.distinct > 0 ? fmt(h.numbered.distinct) : null}
      unit="order numbers"
      meta={numberedMeta(h.numbered?.series ?? [])}
      footnote={`${
        h.numbered?.latest
          ? `Latest found: ${h.numbered.latest.label}, ${day(h.numbered.latest.date)}. `
          : ""
      }Not the number of orders issued. ${collectedNote(h.collectedThrough)}`}
      source={{ source: { label: docket.label, href: docket.url } }}
    />,
    <KpiCard
      key="next"
      as="li"
      label="Next date set on the docket"
      value={h.next ? day(h.next.date) : null}
      meta={
        h.next
          ? (h.next.label ?? "Event not named in the entry")
          : "No date ahead in the collected text"
      }
      footnote={
        h.next
          ? docketedNote(h.next.entryDate, h.collectedThrough)
          : collectedNote(h.collectedThrough)
      }
      source={{ source: { label: docket.label, href: docket.url } }}
    />,
  ];
  if (cmd.mode === "registry")
    cards.push(
      <KpiCard
        key="members"
        as="li"
        label="Member dockets with evidence"
        value={h.members !== null ? fmt(h.members) : null}
        unit="dockets"
        meta="Partial count, not the size of the MDL"
        source={{ source: { label: "Seeger Weiss matter registry" } }}
      />,
    );
  if (h.rule702)
    cards.push(
      <KpiCard
        key="702"
        as="li"
        label="Rule 702 rulings"
        value={fmt(h.rule702.rulings)}
        unit="orders"
        meta={`${fmt(h.rule702.motions)} Rule 702 motions counted apart`}
        source={{ source: { label: docket.label, href: docket.url } }}
      />,
    );
  return (
    <KpiGrid columns={cards.length >= 5 ? 6 : 4} label={`MDL ${cmd.mdl} headline figures`}>
      {cards}
    </KpiGrid>
  );
}

export function OverviewSection({ cmd }: { cmd: MdlCommandPayload }) {
  const h = useMemo(() => headline(cmd), [cmd]);
  const points = useMemo(() => sortedPoints(cmd.jpmlPoints), [cmd.jpmlPoints]);
  const added = useMemo(() => addedRows(cmd.jpmlPoints), [cmd.jpmlPoints]);
  const swim = useMemo(
    () => (cmd.orders ? orderSwimlanes(cmd.orders.entries) : null),
    [cmd.orders],
  );
  const jpml = jpmlSource(cmd);
  const docket = docketSource(cmd);
  const period = points.length
    ? `${day(points[0]!.date)} to ${day(points.at(-1)!.date)}`
    : undefined;
  const pendingTitle =
    trendTakeaway(
      "Actions pending",
      points.map((p) => ({ label: day(p.date), value: p.pending })),
      fmt,
    ) ?? "Actions pending at each JPML report";
  const last = added.at(-1);
  const addedTitle = last
    ? `${signed(last.added)} actions between the reports of ${day(last.from)} and ${day(last.report)}`
    : "Actions added between JPML reports";
  return (
    <div className="space-y-4">
      <Kpis cmd={cmd} h={h} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={pendingTitle}
          subtitle={`Actions pending · MDL ${cmd.mdl} · monthly JPML reports`}
          status={
            points.length >= 2
              ? { kind: "ready" }
              : { kind: "empty", reason: "Fewer than two JPML reports list this MDL." }
          }
          sources={[jpml]}
          period={period}
          table={periodTable(
            points,
            "date",
            [
              { key: "pending", label: "Actions pending" },
              { key: "total", label: "Total actions" },
            ],
            fmt,
            {
              caption: `MDL ${cmd.mdl}: actions pending and total at each JPML report`,
              xLabel: "Report date",
            },
          )}
          about={
            <p>Counts as each monthly JPML report prints them. Total includes closed actions.</p>
          }
        >
          <TrendLines
            rows={points}
            xKey="date"
            series={[{ key: "pending", label: "Actions pending" }]}
            format={fmt}
            xTick={monthTick}
            ariaLabel={`Actions pending in MDL ${cmd.mdl} at each JPML report`}
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={addedTitle}
          subtitle="Actions added between consecutive reports · difference of published totals"
          status={
            added.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "Fewer than two JPML reports list this MDL." }
          }
          sources={[jpml]}
          period={period}
          table={periodTable(
            added,
            "report",
            [
              { key: "added", label: "Actions added since the prior report" },
              { key: "days", label: "Days since the prior report" },
            ],
            fmt,
            {
              caption: `MDL ${cmd.mdl}: actions added between JPML reports`,
              xLabel: "Report date",
            },
          )}
          about={
            <p>
              Each bar is the report's total minus the prior report's total. A negative value is
              shown as printed; the report does not say why the total fell. Report intervals differ
              in length.
            </p>
          }
        >
          <TrendColumns
            rows={added.slice(-24)}
            xKey="report"
            series={[{ key: "added", label: "Actions added" }]}
            format={fmt}
            xTick={monthTick}
            ariaLabel={`Actions added to MDL ${cmd.mdl} between JPML reports`}
          />
        </ChartCard>
      </div>
      <ChartCard
        variant="editorial"
        title={
          swim
            ? `Key orders on the master docket, ${day(swim.domain[0])} to ${day(swim.domain[1])}`
            : "Key orders on the master docket"
        }
        subtitle={`Classified docket entries by family · rule ${ORDERS_RULE_VERSION}`}
        status={
          cmd.errors.includes("orders")
            ? { kind: "error", message: "The docket text could not be read just now." }
            : swim
              ? { kind: "ready" }
              : {
                  kind: "empty",
                  reason:
                    "No classified order is in the collected master-docket text for this MDL.",
                }
        }
        sources={[docket]}
        partial={h.collectedThrough ? collectedNote(h.collectedThrough) : undefined}
        about={
          <p>
            Read only from explicit docket text that starts with the order's own wording. Withheld
            entries are never classified. Each dot opens its docket entry.
          </p>
        }
      >
        {swim ? (
          <Swimlanes
            groups={SWIM_GROUPS}
            lanes={swim.lanes}
            domain={swim.domain}
            ariaLabel={`Key orders on the MDL ${cmd.mdl} master docket over time`}
            unitLabel={(n) => `${fmt(n)} ${n === 1 ? "entry" : "entries"}`}
            onOpen={(e) => {
              if (e.href) window.open(e.href, "_blank", "noreferrer");
            }}
          />
        ) : null}
      </ChartCard>
      <MatterAi cmd={cmd} h={h} />
    </div>
  );
}
