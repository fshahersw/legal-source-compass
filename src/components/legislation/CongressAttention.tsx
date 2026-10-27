/**
 * /law/legislation: how much attention Congress gives to mass-tort topics (PFAS, opioids, talc and asbestos, Camp
 * Lejeune, litigation funding): bills introduced and hearings published per Congress whose title or summary mentions
 * the topic. Text matches, labelled as such; the current Congress is partial.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatasetSwitch } from "@/components/apiLaw/DatasetSwitch";
import { ChartCard } from "@/components/charts/ChartCard";
import { Heatmap } from "@/components/charts/Heatmap";
import { metricFormatter } from "@/components/charts/format";
import { AiSummary, AskAiButton, DataDrawer, Section, buildSectionContext } from "@/components/kit";
import { latestHeld, type AttentionTopic, type Hearing } from "@/lib/law/legislationWatch";
import { ordinal } from "@/lib/analytics/trend";
import { legislationWatchQuery } from "./legislationWatchQuery";

const SOURCES = [
  { label: "GovInfo congressional hearings", url: "https://www.govinfo.gov/app/collection/chrg" },
  { label: "GovInfo Bill Status", url: "https://www.govinfo.gov/bulkdata/BILLSTATUS" },
];
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "congress-attention";
const TITLE = "Congressional attention to mass torts";
type Measure = "bills" | "hearings";

export function CongressAttention() {
  const q = useQuery(legislationWatchQuery);
  const [measure, setMeasure] = useState<Measure>("bills");
  const d = q.data;
  const rows = d?.attention ?? [];
  const congresses = rows[0]?.cells.map((c) => c.congress) ?? [];
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({
          kind: "error",
          message: "This chart could not be loaded.",
          onRetry: () => void q.refetch(),
        } as const)
      : ({ kind: "ready" } as const);
  const hearings = rows.flatMap((r) => r.hearings.map((h) => ({ ...h, topic: r.topic.label })));
  const top = [...rows].sort((a, b) => b.bills - a.bills)[0];
  const period = congresses.length
    ? `${ordinal(congresses[0]!)}–${ordinal(congresses.at(-1)!)} Congress`
    : undefined;
  const context = d
    ? buildSectionContext({
        id: ID,
        title: TITLE,
        scope: "Bills and hearings whose title or summary mentions the topic",
        period: `${period ?? ""} (${ordinal(d.congress)} in progress)`,
        source: SOURCES.map((s) => s.label).join("; "),
        figures: rows.flatMap((r) => [
          { label: `${r.topic.label}: bills introduced`, value: r.bills, unit: "bills" },
          {
            label: `${r.topic.label}: bills that became law`,
            value: r.billsBecameLaw,
            unit: "bills",
          },
          { label: `${r.topic.label}: hearings`, value: r.hearings.length, unit: "hearings" },
          {
            label: `${r.topic.label}: latest dated hearing`,
            value: latestHeld(r.hearings) ?? "Not recorded",
          },
        ]),
        maxFigures: 20,
      })
    : null;
  const value = (r: AttentionTopic, c: number) => {
    const cell = r.cells.find((x) => x.congress === c);
    return cell ? cell[measure] : null;
  };

  return (
    <Section
      id={ID}
      title={TITLE}
      description="Bills and hearings that mention each mass-tort topic, per Congress."
      actions={
        <AskAiButton
          sectionId={ID}
          title={TITLE}
          context={context}
          questions={[
            "When did Congress pay the most attention to PFAS?",
            "Did opioid legislation lead to new laws?",
            "Has Congress held hearings on litigation funding?",
          ]}
        />
      }
    >
      <ChartCard
        variant="editorial"
        title={
          top
            ? `${top.topic.label} drew the most bills (${fmt(top.bills)} since the ${ordinal(congresses[0] ?? 108)} Congress)`
            : TITLE
        }
        subtitle={`${measure === "bills" ? "Bills introduced" : "Hearings published"} per Congress whose title or summary mentions the topic · ${d ? `${ordinal(d.congress)} Congress in progress` : ""}`}
        status={status}
        sources={SOURCES}
        period={period}
        asOf={(measure === "bills" ? d?.dataAsOf.congressBills : d?.dataAsOf.hearings) ?? undefined}
        partial={d ? `The ${ordinal(d.congress)} Congress is in progress.` : undefined}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Topic membership is a text match on titles and summaries, not a subject
              classification.
            </li>
            <li>
              Hearings carry no committee in the source, and some print no date (“Not stated”);
              undated hearings are counted by Congress but never used as the latest date.
            </li>
          </ul>
        }
        table={{
          caption: `${measure === "bills" ? "Bills" : "Hearings"} per Congress by topic`,
          columns: [
            { label: "Topic" },
            ...congresses.map((c) => ({ label: ordinal(c) })),
            { label: "Total" },
            { label: "Bills that became law" },
            { label: "Latest dated hearing" },
          ],
          rows: rows.map((r) => ({
            key: r.topic.id,
            cells: [
              r.topic.label,
              ...congresses.map((c) => value(r, c) ?? "Not recorded"),
              measure === "bills" ? r.bills : r.hearings.length,
              r.billsBecameLaw,
              latestHeld(r.hearings) ?? "Not recorded",
            ],
          })),
        }}
        footnotes={
          rows.length
            ? [
                `Bills that became law: ${rows.map((r) => `${r.topic.label} ${fmt(r.billsBecameLaw)}`).join(" · ")}.`,
                `Latest dated hearing: ${rows.map((r) => `${r.topic.label} ${latestHeld(r.hearings) ?? "Not recorded"}`).join(" · ")}.`,
              ]
            : undefined
        }
        actions={d ? <HearingsDrawer hearings={hearings} asOf={d.dataAsOf.hearings} /> : undefined}
      >
        {d ? (
          <>
            <DatasetSwitch
              label="Measure"
              options={[
                { value: "bills" as const, label: "Bills" },
                { value: "hearings" as const, label: "Hearings" },
              ]}
              value={measure}
              onChange={setMeasure}
            />
            <Heatmap
              rows={rows.map((r) => ({ id: r.topic.id, label: r.topic.label }))}
              columns={congresses.map((c) => ({
                id: String(c),
                label: c === d.congress ? `${c}*` : String(c),
              }))}
              value={(row, col) => {
                const r = rows.find((x) => x.topic.id === row);
                return r ? value(r, Number(col)) : null;
              }}
              formatter={metricFormatter("count")}
              cellLabels
              ariaLabel={`${measure === "bills" ? "Bills" : "Hearings"} per Congress by mass-tort topic`}
            />
          </>
        ) : null}
      </ChartCard>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}

function HearingsDrawer({
  hearings,
  asOf,
}: {
  hearings: (Hearing & { topic: string })[];
  asOf: string | null;
}) {
  return (
    <DataDrawer
      title="Hearings that mention a mass-tort topic"
      description="Newest first; a hearing the publisher dates “Not stated” shows Not recorded."
      triggerLabel={`Hearings (${fmt(hearings.length)})`}
      filename="mass-tort-hearings"
      rows={hearings}
      rowKey={(h, i) => `${h.id}:${h.topic}:${i}`}
      searchable
      source={{ source: SOURCES[0], asOf: asOf ?? undefined }}
      columns={[
        { key: "held", label: "Held", value: (h) => h.held },
        { key: "topic", label: "Topic", value: (h) => h.topic },
        {
          key: "title",
          label: "Hearing",
          value: (h) => h.title,
          render: (h) =>
            h.url ? (
              <a
                href={h.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {h.title}
              </a>
            ) : (
              h.title
            ),
        },
        { key: "congress", label: "Congress", align: "right", value: (h) => h.congress },
      ]}
    />
  );
}
