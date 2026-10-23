/**
 * Product signal timeline of one MDL: the agency series held for its product (FDA FAERS / MAUDE reports by year, and
 * worker SAFETY's enforcement, recall and report series once product_signals_v1 is applied) above the MDL's docket
 * entries and filings per month, on one time axis with the centralization date ruled across every band.
 *
 * A product series is shown only when its record names this MDL itself; nothing is matched to the MDL by name.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartFrame, type ChartSource } from "@/components/charts/ChartFrame";
import { LaneTracks, laneDomain, type LaneTrack } from "@/components/charts/Lanes";
import { metricFormatter } from "@/components/charts/format";
import { bySeries, dateIndex, seriesMeta } from "@/lib/litviz/model";
import type { ProductSignals } from "@/lib/litviz/signals";
import { todayIndex } from "./MdlLaneDetail";
import { productSignalsQuery } from "./queries";
import { DATASET_NAMES, rowSources, SHORT_LABEL, seriesBins, seriesTable } from "./tracks";

const count = metricFormatter("count");

const RECALL = /recall/;
const ENFORCEMENT = /enforcement/;
/** Breakdowns of a report series (serious, death, injury, malfunction) are listed in the table, not drawn. */
const BREAKDOWN = /_(serious|death|injury|malfunction)$/;

/** Tracks: agency series first (product slot), then litigation activity; a "Not recorded" band for enforcement
 * reports and recalls whenever no such series is held for the MDL. */
export function signalTracks(p: ProductSignals): LaneTrack[] {
  const s = bySeries(p.rows);
  const tracks: LaneTrack[] = [];
  const ids = [...s.keys()];
  const agency = ids.filter(
    (id) => seriesMeta(id, s.get(id)![0]).group === "product" && !BREAKDOWN.test(id),
  );
  const activity = ids.filter((id) => seriesMeta(id).group === "activity");
  for (const id of agency) {
    const rows = s.get(id)!;
    const meta = seriesMeta(id, rows[0]);
    const product = p.products.find((x) => x.dataset === rows[0]?.source_dataset)?.product;
    tracks.push({
      kind: "bins",
      id,
      short: SHORT_LABEL[id] ?? meta.label,
      label: `${meta.label}${product ? `: ${product}` : ""} (${meta.source}${meta.grain === "calendar_year" ? ", per year" : ", per month"})`,
      unit: meta.unit,
      formatter: count,
      bins: seriesBins(rows),
      slot: 2,
    });
  }
  if (!agency.length)
    tracks.push({
      kind: "note",
      id: "agency",
      label: "Adverse-event and device reports",
      text: "Not recorded: no FDA report series held names this MDL.",
    });
  if (!agency.some((id) => ENFORCEMENT.test(id)))
    tracks.push({
      kind: "note",
      id: "enforcement",
      label: "FDA enforcement reports",
      text: "Not recorded: no enforcement report is linked to this MDL by explicit evidence.",
    });
  if (!agency.some((id) => RECALL.test(id)))
    tracks.push({
      kind: "note",
      id: "recalls",
      label: "Recalls (CPSC, FDA, NHTSA)",
      text: "Not recorded: no recall is linked to this MDL by explicit evidence.",
    });
  for (const id of activity) {
    const rows = s.get(id)!;
    const meta = seriesMeta(id, rows[0]);
    tracks.push({
      kind: "bins",
      id,
      short: SHORT_LABEL[id] ?? meta.label,
      label: `${meta.label}${meta.grain === "calendar_year" ? ", per year" : ", per month"}`,
      unit: meta.unit,
      formatter: count,
      bins: seriesBins(rows),
      slot: 0,
    });
  }
  return tracks;
}

/** What the table holds beyond the bands, and why each agency series belongs to this MDL. */
export function signalFootnotes(p: ProductSignals): string[] {
  const out: string[] = [];
  const ids = [...bySeries(p.rows).keys()];
  if (p.agencySource === "product_signals_v1") {
    const why = [
      ...new Set(
        p.rows
          .filter((r) => seriesMeta(r.series, r).group === "product" && r.basis)
          .map((r) =>
            r.basis
              .replace(/:partial(_month)?$/, "")
              .replace(/_/g, " ")
              .trim(),
          )
          .filter(Boolean),
      ),
    ];
    out.push(
      why.length
        ? `Agency series linked to this MDL by the product safety signals layer: ${why.slice(0, 2).join("; ")}${why.length > 2 ? `; and ${why.length - 2} more` : ""}.`
        : "Agency series: product safety signals layer.",
    );
  } else if (p.agencySource === "fda_product_series")
    out.push(
      `Agency series: FDA product series for ${p.products.map((x) => x.product).join(", ")}${p.products[0]?.dataThrough ? `, data through ${p.products[0].dataThrough}` : ""}; the series record names this MDL.`,
    );
  else out.push("No agency series is held for this MDL.");
  const listed = ids
    .filter((id) => BREAKDOWN.test(id))
    .map((id) => seriesMeta(id).label.toLowerCase());
  if (listed.length) out.push(`Listed in the table, not drawn: ${listed.join(", ")}.`);
  if (ids.includes("jpml_actions_added"))
    out.push(
      "The change in actions between consecutive JPML monthly reports is listed in the table, not drawn: it counts actions added less actions closed or corrected, so it can be negative.",
    );
  return out;
}

/** Lead-up shown by default: this many years before centralization (all years remain one choice away). */
const LEAD_YEARS = 10;

export function ProductSignalTimeline({ mdl }: { mdl: string }) {
  const [all, setAll] = useState(false);
  const q = useQuery(productSignalsQuery(mdl));
  const p = q.data ?? null;
  const tracks = p ? signalTracks(p) : [];
  const central = p ? dateIndex(p.centralized) : null;
  const markers =
    central !== null ? [{ t: central, label: "Centralized", kind: "start" as const }] : [];
  const full = p
    ? laneDomain(
        tracks.map((t) =>
          t.kind === "bins" ? { bins: t.bins } : t.kind === "line" ? { points: t.points } : {},
        ),
        markers,
        todayIndex(p.today),
      )
    : null;
  const leadStart = central !== null ? (Math.floor(central / 12) - LEAD_YEARS) * 12 : null;
  const windowed = full !== null && leadStart !== null && full[0] < leadStart;
  const domain: [number, number] | null =
    full && windowed && !all && leadStart !== null ? [leadStart, full[1]] : full;
  const sources: ChartSource[] = p ? rowSources(p.rows, DATASET_NAMES) : [];
  const hasData = tracks.some((t) => t.kind !== "note");
  return (
    <ChartFrame
      title="Product signals and litigation activity"
      unit={`reports per ${tracks.some((t) => t.kind === "bins" && t.slot === 2 && seriesMeta(t.id).grain === "month") ? "month" : "year"}; docket entries and filings per month`}
      period={
        domain ? `${Math.floor(domain[0] / 12)}–${Math.floor(domain[1] / 12) - 1}` : undefined
      }
      sources={sources.length ? sources : [{ label: "openFDA", url: "https://open.fda.gov/" }]}
      minHeight={240}
      status={
        q.isPending
          ? { kind: "loading" }
          : q.isError
            ? {
                kind: "error",
                message: "The product signal timeline could not be read just now.",
                onRetry: () => void q.refetch(),
              }
            : !p || !domain || !hasData
              ? {
                  kind: "empty",
                  reason: `No product series, docket entry or filing of MDL No. ${mdl} is held.`,
                }
              : { kind: "ready" }
      }
      partialNotice={p?.notices.length ? p.notices.join(" ") : undefined}
      actions={
        windowed && full ? (
          <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            From
            <select
              value={all ? "all" : "lead"}
              onChange={(e) => setAll(e.target.value === "all")}
              className="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground"
            >
              <option value="lead">{LEAD_YEARS} years before centralization</option>
              <option value="all">All years held (from {Math.floor(full[0] / 12)})</option>
            </select>
          </label>
        ) : null
      }
      notes={[
        "Each band has its own scale. Report counts are reports that mention the product, not incidence: reporting rises with publicity and litigation.",
        "A product series appears only when it is linked to this MDL explicitly: its own record names the MDL, or the product safety signals layer links it because the MDL's JPML title names the product (the link is stated below the chart). Nothing is matched by a search term.",
        "The vertical rule marks the JPML transfer order (centralization). Hatched bars are periods still in progress.",
      ]}
      footnotes={p ? signalFootnotes(p) : undefined}
      table={
        p
          ? seriesTable(p.rows, `MDL No. ${mdl}: product signals and litigation activity`)
          : undefined
      }
    >
      {p && domain ? (
        <LaneTracks
          tracks={tracks}
          markers={markers}
          domain={domain}
          ariaLabel={`Product signals and litigation activity of MDL No. ${mdl}: ${tracks.map((t) => t.label).join("; ")}.`}
        />
      ) : null}
    </ChartFrame>
  );
}
