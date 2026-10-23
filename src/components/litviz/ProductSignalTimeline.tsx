/**
 * Product signal timeline of one MDL: the agency series held for its product (FDA FAERS / MAUDE reports by year, and
 * worker SAFETY's enforcement, recall and report series once product_signals_v1 is applied) above the MDL's docket
 * entries and filings per month, on one time axis with the centralization date ruled across every band.
 *
 * A product series is shown only when its record names this MDL itself; nothing is matched to the MDL by name.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartFrame, type ChartSource } from "@/components/charts/ChartFrame";
import { LaneTracks, laneDomain, type LaneTrack } from "@/components/charts/Lanes";
import { metricFormatter } from "@/components/charts/format";
import { bySeries, dateIndex, seriesMeta } from "@/lib/litviz/model";
import type { ProductSignals } from "@/lib/litviz/signals";
import { todayIndex } from "./MdlLaneDetail";
import { productSignalsQuery } from "./queries";
import { DATASET_NAMES, rowSources, seriesBins, seriesTable } from "./tracks";

const count = metricFormatter("count");

const RECALL = /recall/;
const ENFORCEMENT = /enforcement/;

/** Tracks: agency series first (product slot), then litigation activity; a "Not recorded" band for enforcement
 * reports and recalls whenever no such series is held for the MDL. */
export function signalTracks(p: ProductSignals): LaneTrack[] {
  const s = bySeries(p.rows);
  const tracks: LaneTrack[] = [];
  const ids = [...s.keys()];
  const agency = ids.filter((id) => seriesMeta(id, s.get(id)![0]).group === "product");
  const activity = ids.filter((id) => seriesMeta(id).group === "activity");
  for (const id of agency) {
    const rows = s.get(id)!;
    const meta = seriesMeta(id, rows[0]);
    const product = p.products.find((x) => x.dataset === rows[0]?.source_dataset)?.product;
    tracks.push({
      kind: "bins",
      id,
      label: `${meta.label}${product ? `: ${product}` : ""} (${meta.source}${meta.grain === "calendar_year" ? ", per year" : ""})`,
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
      label: `${meta.label}${meta.grain === "calendar_year" ? ", per year" : ", per month"}`,
      unit: meta.unit,
      formatter: count,
      bins: seriesBins(rows),
      slot: 0,
    });
  }
  return tracks;
}

export function ProductSignalTimeline({ mdl }: { mdl: string }) {
  const q = useQuery(productSignalsQuery(mdl));
  const p = q.data ?? null;
  const tracks = p ? signalTracks(p) : [];
  const central = p ? dateIndex(p.centralized) : null;
  const markers =
    central !== null ? [{ t: central, label: "Centralized", kind: "start" as const }] : [];
  const domain = p
    ? laneDomain(
        tracks.map((t) =>
          t.kind === "bins" ? { bins: t.bins } : t.kind === "line" ? { points: t.points } : {},
        ),
        markers,
        todayIndex(p.today),
      )
    : null;
  const sources: ChartSource[] = p ? rowSources(p.rows, DATASET_NAMES) : [];
  const hasData = tracks.some((t) => t.kind !== "note");
  return (
    <ChartFrame
      title="Product signals and litigation activity"
      unit="reports per year; docket entries and filings per month"
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
      notes={[
        "Each band has its own scale. Report counts are reports that mention the product, not incidence: reporting rises with publicity and litigation.",
        "A product series appears only when its own record names this MDL; recalls and enforcement reports are shown once a record links them to the MDL explicitly.",
        "The vertical rule marks the JPML transfer order (centralization). Hatched bars are periods still in progress.",
      ]}
      footnotes={
        p
          ? [
              p.agencySource === "product_signals_v1"
                ? "Agency series: product safety signals layer."
                : p.agencySource === "fda_product_series"
                  ? `Agency series: FDA product series for ${p.products.map((x) => x.product).join(", ")}${p.products[0]?.dataThrough ? `, data through ${p.products[0].dataThrough}` : ""}.`
                  : "No agency series is held for this MDL.",
            ]
          : undefined
      }
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
