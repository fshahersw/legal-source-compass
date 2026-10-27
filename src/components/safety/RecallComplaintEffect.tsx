/**
 * A recall's effect on complaints: NHTSA complaints for the exact vehicles of one recall campaign (make, model and
 * model-year range as the recall lists them), by quarter received, with the recall quarter marked and the 12 months
 * before and after compared. From safety_nhtsa_recall_complaints_v1; renders nothing until that RPC is applied.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendColumns } from "@/components/charts/recharts";
import { AiSummary, buildSectionContext } from "@/components/kit";
import { nhtsaCampaigns, recallQuarterRows } from "@/lib/safety/safetyWindows";
import { recallComplaintsQuery } from "./sectionQueries";

const fmt = (v: number) => v.toLocaleString("en-US");
const nr = (v: number | null | undefined) => (v == null ? "Not recorded" : fmt(v));

export function RecallComplaintEffect({ campaigns }: { campaigns: readonly string[] }) {
  const list = nhtsaCampaigns(campaigns).slice(0, 12);
  const [picked, setPicked] = useState<string | null>(null);
  const campaign = picked && list.includes(picked) ? picked : (list[0] ?? null);
  const q = useQuery({ ...recallComplaintsQuery(campaign ?? "00V000000"), enabled: !!campaign });
  const r = q.data;
  if (!campaign || !r) return null;
  const rows = recallQuarterRows(r);
  const b = r.before;
  const a = r.after;
  const source = {
    label: `NHTSA complaints for the vehicles of recall ${r.campaign}`,
    url: `https://www.nhtsa.gov/recalls?nhtsaId=${r.campaign}`,
  };
  const partial = !!(b?.partial || a?.partial);
  const partialNote = partial
    ? [
        b?.partial
          ? `The 12 months before the recall start before the complaint data (${r.coverage_from ?? "start Not recorded"}); ${nr(b.complaints)} counted.`
          : `${nr(b?.complaints)} complaints in the 12 months before.`,
        a?.partial
          ? `The 12 months after the recall run past the latest complaint (${r.coverage_to ?? "Not recorded"}); ${nr(a.complaints)} so far.`
          : `${nr(a?.complaints)} complaints in the 12 months after.`,
        "The two windows are not compared.",
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;
  // Only the figures the card shows: the before and after complaint totals (in the title or partial note).
  const context = buildSectionContext({
    id: `recall-effect-${r.campaign}`,
    title: `Complaints before and after recall ${r.campaign}`,
    period: r.recall_date ? `recall date ${r.recall_date}` : null,
    source: source.label,
    figures: [
      {
        label: "Complaints in the 12 months before the recall",
        value: b?.complaints ?? null,
        note: b?.partial ? "partial window; not comparable with the other window" : undefined,
      },
      {
        label: "Complaints in the 12 months after the recall",
        value: a?.complaints ?? null,
        note: a?.partial
          ? "partial window, counted so far; not comparable with the other window"
          : undefined,
      },
    ],
  });
  return (
    <section className="space-y-2" aria-label="Complaints before and after the recall">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-xs font-semibold">Complaints before and after the recall</h3>
        {list.length > 1 ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Campaign
            <select
              value={campaign}
              onChange={(e) => setPicked(e.target.value)}
              className="h-7 rounded border border-border bg-background px-1.5 text-xs"
            >
              {list.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <ChartCard
        title={
          partial
            ? `Complaints per quarter for the vehicles of recall ${r.campaign}`
            : `Recall ${r.campaign}: ${nr(b?.complaints)} complaints in the 12 months before, ${nr(a?.complaints)} after`
        }
        subtitle={`Complaints per quarter received for the recalled vehicles and component${r.recall_date ? ` · recalled ${r.recall_date}` : ""}`}
        status={
          rows.length
            ? { kind: "ready" }
            : { kind: "empty", reason: "No complaint is recorded for these vehicles." }
        }
        sources={[source]}
        period={
          r.coverage_from && r.coverage_to ? `${r.coverage_from} to ${r.coverage_to}` : undefined
        }
        partial={partialNote}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Vehicles:{" "}
              {r.vehicles
                .map((v) => `${v.make} ${v.model} ${v.from}${v.to !== v.from ? `–${v.to}` : ""}`)
                .join("; ") || "Not recorded"}
              {r.unparsed.length
                ? `. Not matched (could not be read exactly): ${r.unparsed.join("; ")}`
                : ""}
              .
            </li>
            <li>
              Component: complaints naming {r.components.join(" or ") || "Not recorded"} at the top
              level, exactly as NHTSA words it. NHTSA&apos;s newer component names (for example
              &quot;ENGINE&quot;) are not merged in; the table also gives every complaint for the
              same vehicles.
            </li>
            <li>Complaints are unverified. News of a recall itself brings more complaints.</li>
          </ul>
        }
        table={{
          caption: `Complaints per quarter for recall ${r.campaign}`,
          columns: [
            { label: "Quarter" },
            { label: "Same component", align: "right" },
            { label: "All complaints, same vehicles", align: "right" },
          ],
          rows: [...rows].reverse().map((x) => ({
            key: x.quarter,
            cells: [
              `${x.quarter}${x.recall ? " (recall)" : ""}${x.partial ? " (partial)" : ""}`,
              x.complaints,
              x.vehicle,
            ],
          })),
        }}
      >
        <TrendColumns
          rows={rows}
          xKey="quarter"
          series={[{ key: "complaints", label: "Complaints, same component" }]}
          format={fmt}
          partialKey="partial"
          highlightX={rows.find((x) => x.recall)?.quarter}
          ariaLabel={`Complaints per quarter for the vehicles of recall ${r.campaign}`}
        />
      </ChartCard>
      <AiSummary context={context} />
    </section>
  );
}
