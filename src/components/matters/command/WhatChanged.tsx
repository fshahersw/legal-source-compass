/**
 * What changed: the latest JPML interval, orders entered in the last 30 and 90 days (printed labels), court-page orders
 * newer than the collected docket, and settings docketed or vacated. The AI summary reads only these server-computed
 * figures (whatChanged.ts); it is labelled AI-generated and names no model or vendor.
 */
import {
  AiSummary,
  AskAiButton,
  Card,
  CardBody,
  KpiStrip,
  buildSectionContext,
} from "@/components/kit";
import { ORDER_KIND_LABEL } from "@/lib/matters/orders";
import type { MdlCommandPayload } from "@/lib/matters/types";
import { Note, Out, collectedNote, day, fmt, signed } from "./shared";

export function WhatChanged({ cmd }: { cmd: MdlCommandPayload }) {
  const w = cmd.whatChanged;
  const [w30, w90] = w.windows;
  const d = w.jpml.latest;
  const context = buildSectionContext({
    id: "mdl-changes",
    title: `MDL ${cmd.mdl}: what changed`,
    period: `${w90?.from ?? ""} to ${w.asOf}`,
    source: "JPML pending MDL reports; master-docket text; transferee court page",
    figures: w.figures,
    maxFigures: 24,
  });
  const orders = w90?.orders ?? [];
  return (
    <div className="space-y-4">
      <KpiStrip
        label="Recent change"
        cellBasis="basis-[calc(50%-1px)] xl:basis-[calc(25%-1px)]"
        items={[
          {
            key: "added",
            label: "Actions added, latest JPML interval",
            value: d ? signed(d.added) : null,
            meta: d ? `${day(d.from)} to ${day(d.to)}` : "Needs two JPML reports",
          },
          {
            key: "o30",
            label: "Orders entered, last 30 days",
            value: w30 ? fmt(new Set(w30.orders.map((o) => o.entryId)).size) : null,
            meta: w30 ? `${day(w30.from)} to ${day(w.asOf)}` : undefined,
          },
          {
            key: "o90",
            label: "Orders entered, last 90 days",
            value: w90 ? fmt(new Set(w90.orders.map((o) => o.entryId)).size) : null,
            meta: w90 ? `${day(w90.from)} to ${day(w.asOf)}` : undefined,
          },
          {
            key: "settings",
            label: "Settings docketed, last 90 days",
            value: w90 ? fmt(w90.settings.set) : null,
            meta: w90 ? `${fmt(w90.settings.vacated)} docketed as vacated` : undefined,
          },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody className="pt-4">
            <h3 className="text-label text-foreground">Orders entered in the last 90 days</h3>
            {orders.length ? (
              <ul className="mt-2 space-y-1.5 text-body">
                {orders.slice(0, 10).map((o) => (
                  <li key={`${o.entryId}-${o.kind}`} className="flex flex-wrap gap-x-2">
                    <Out href={o.sourceUrl}>{o.printed}</Out>
                    <span className="text-meta text-muted-foreground">
                      {ORDER_KIND_LABEL[o.kind]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body text-muted-foreground">
                No classified order in the collected docket text for this window.
              </p>
            )}
            {orders.length > 10 ? (
              <Note>{fmt(orders.length - 10)} more in the key-orders section.</Note>
            ) : null}
            <Note>{collectedNote(w.collectedThrough)}</Note>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="pt-4">
            <h3 className="text-label text-foreground">
              Court-page orders newer than the docket text
            </h3>
            {w.courtPageNewer.length ? (
              <ul className="mt-2 space-y-1.5 text-body">
                {w.courtPageNewer.slice(0, 8).map((c) => (
                  <li key={c.url + c.printed}>
                    <Out href={c.url}>{c.printed}</Out>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body text-muted-foreground">
                {cmd.lens?.courtPage
                  ? "None: the court page lists no numbered order dated after the collected docket text."
                  : "No transferee-court page is recorded for this MDL."}
              </p>
            )}
            <Note>Matched to the docket ledger only on exact order kind, number and suffix.</Note>
          </CardBody>
        </Card>
      </div>
      <AiSummary
        context={w.figures.length ? context : null}
        title="What changed, in brief"
        actions={
          <AskAiButton
            sectionId="mdl-changes"
            title={`MDL ${cmd.mdl}: what changed`}
            context={context}
            questions={[
              "What changed in this MDL over the last 90 days?",
              "Which new orders matter most, and why?",
              "Is the docket text current, or is the court page newer?",
            ]}
          />
        }
      />
    </div>
  );
}
