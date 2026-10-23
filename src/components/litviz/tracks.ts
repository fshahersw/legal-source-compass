/**
 * Pure builders from litviz series rows to Lanes tracks, markers and table rows (client-safe, tested in
 * litviz.test.ts beside the components).
 */
import type { ChartSource, TableSpec } from "@/components/charts/ChartFrame";
import type { LaneBin, LaneMarker, LanePoint, LaneTrack } from "@/components/charts/Lanes";
import { metricFormatter } from "@/components/charts/format";
import type { LaneSummary, YearRun } from "@/lib/litviz/lanes";
import { pendingPoints } from "@/lib/litviz/lanes";
import {
  bySeries,
  dateIndex,
  dayLabel,
  isPartialBasis,
  isUnverifiedBasis,
  monthIndex,
  monthLabel,
  periodLabel,
  rowSpan,
  seriesMeta,
  type MdlAttributes,
  type SeriesRow,
} from "@/lib/litviz/model";

const count = metricFormatter("count");

/** Events of an MDL as markers: motion filed, centralized (transfer order), closed (or terminated in a year). */
export function mdlMarkers(a: Pick<MdlAttributes, "dates">): LaneMarker[] {
  const out: LaneMarker[] = [];
  const filed = dateIndex(a.dates.motionFiled);
  const central = dateIndex(a.dates.centralized);
  const closed = dateIndex(a.dates.closed);
  if (filed !== null) out.push({ t: filed, label: "Motion filed", kind: "mark" });
  if (central !== null) out.push({ t: central, label: "Centralized", kind: "start" });
  if (closed !== null) out.push({ t: closed, label: "Closed", kind: "end" });
  else if (a.dates.closedYear !== null)
    out.push({
      t: a.dates.closedYear * 12 + 6,
      label: `Terminated in ${a.dates.closedYear}`,
      kind: "end",
    });
  return out;
}

/** The pending-actions line of one MDL from its rows: JPML monthly reports and verified fiscal-year ends. */
export function pendingLine(rows: readonly SeriesRow[]): LanePoint[] {
  const s = bySeries(rows);
  const monthly = s.get("jpml_pending") ?? [];
  const fy = (s.get("jpml_fy_pending") ?? []).filter((r) => !isUnverifiedBasis(r.basis));
  const run = (list: SeriesRow[], key: (r: SeriesRow) => number | null) => {
    const entries = list.flatMap((r) => {
      const k = key(r);
      return k === null || r.value === null ? [] : [[k, r.value] as const];
    });
    if (!entries.length) return null;
    const start = Math.min(...entries.map((e) => e[0]));
    const values: (number | null)[] = Array(Math.max(...entries.map((e) => e[0])) - start + 1).fill(
      null,
    );
    for (const [k, v] of entries) values[k - start] = v;
    return { start, values };
  };
  const pts = pendingPoints({
    pendingMonthly: run(monthly, (r) => monthIndex(r.month)),
    pendingFy: run(fy, (r) => Number(r.month.slice(0, 4))),
  });
  return pts.map(([t, v, link, isFy]) => ({
    t,
    v,
    link: link === 1,
    label: isFy ? `FY${Math.floor(t / 12)} end, September 30` : `JPML report, ${monthLabel(t)}`,
  }));
}

/** Bins of one series (any grain); unverified fiscal-year attributions and null values are left out. */
export function seriesBins(rows: readonly SeriesRow[]): LaneBin[] {
  return rows.flatMap((r) => {
    if (r.value === null || isUnverifiedBasis(r.basis)) return [];
    const meta = seriesMeta(r.series, r);
    const span = rowSpan(r, meta.grain);
    if (!span) return [];
    const partial = isPartialBasis(r.basis);
    return [
      {
        t0: span[0],
        t1: span[1],
        v: r.value,
        label: periodLabel(r, meta.grain),
        partial,
        note: /15_month_period/.test(r.basis) ? "15-month period" : undefined,
      },
    ];
  });
}

/** Tooltip labels of the known series. */
export const SHORT_LABEL: Record<string, string> = {
  jpml_pending: "Pending",
  jpml_fy_pending: "Pending",
  jpml_fy_closed: "Closed",
  jpml_fy_remanded: "Remanded",
  fjc_idb_cases: "FJC civil cases",
  docket_entries: "Docket entries",
  filings: "Filings",
  filings_year: "Filings",
  faers_reports: "FAERS reports",
  maude_reports: "MAUDE reports",
  adverse_events: "Adverse-event reports",
  adverse_events_serious: "Serious reports",
  adverse_events_death: "Reports with a death",
  device_reports: "Device reports",
  device_reports_death: "Death reports",
  device_reports_injury: "Injury reports",
  device_reports_malfunction: "Malfunction reports",
  enforcement_reports: "Enforcement reports",
  recalls: "Recalls",
  complaints: "Complaints",
  jpml_actions_added: "Change in actions",
  jpml_motions_granted: "Motions granted",
};

const trackOf = (id: string, rows: readonly SeriesRow[], slot = 0): LaneTrack => {
  const meta = seriesMeta(id, rows[0]);
  return {
    kind: "bins",
    id,
    short: SHORT_LABEL[id] ?? meta.label,
    label: `${meta.label} (${meta.source})`,
    unit: meta.unit,
    formatter: count,
    bins: seriesBins(rows),
    slot,
  };
};

/** Sources behind a set of rows: one link per dataset with an http(s) or in-app URL. */
export function rowSources(
  rows: readonly SeriesRow[],
  names: Record<string, string> = {},
): ChartSource[] {
  const seen = new Map<string, ChartSource>();
  for (const r of rows) {
    if (!r.source_url || seen.has(r.source_dataset)) continue;
    seen.set(r.source_dataset, {
      label: names[r.source_dataset] ?? r.source_dataset,
      url: r.source_url,
    });
  }
  return [...seen.values()];
}

export const DATASET_NAMES: Record<string, string> = {
  jpml_pending_history_mdls: "JPML pending-MDL report",
  jpml_statistics_extra: "JPML fiscal-year statistical analysis",
  fjc_civil_mdls: "FJC Integrated Database (civil)",
  sw_docket_entries_v1: "Master docket (CourtListener)",
  mdl_docket_activity: "Master docket (CourtListener)",
  documents: "Court filings collected",
  fda_faers_product_series: "FDA FAERS via openFDA",
  fda_device_event_series: "FDA MAUDE via openFDA",
  mdl_intel_jpml_stats: "JPML calendar-year statistics",
  openfda_faers: "FDA FAERS via openFDA",
  openfda_caers: "FDA CAERS via openFDA",
  openfda_maude: "FDA MAUDE via openFDA",
  openfda_enforcement: "FDA enforcement reports via openFDA",
  openfda_device_recall: "FDA device recalls via openFDA",
  nhtsa_recalls: "NHTSA recalls",
  nhtsa_complaints: "NHTSA complaints",
};

/** The detailed lifecycle lane of one MDL. */
export function lifecycleTracks(rows: readonly SeriesRow[]): LaneTrack[] {
  const s = bySeries(rows);
  const tracks: LaneTrack[] = [];
  const line = pendingLine(rows);
  tracks.push(
    line.length
      ? {
          kind: "line",
          id: "pending",
          label: "Actions pending (JPML reports)",
          short: "Pending",
          unit: "actions",
          formatter: count,
          points: line,
          reach: 0.75,
        }
      : {
          kind: "note",
          id: "pending",
          label: "Actions pending (JPML reports)",
          text: "Not recorded in the JPML reports held.",
        },
  );
  const closed = s.get("jpml_fy_closed") ?? [];
  if (seriesBins(closed).length) tracks.push(trackOf("jpml_fy_closed", closed));
  const remanded = s.get("jpml_fy_remanded") ?? [];
  if (seriesBins(remanded).some((b) => b.v > 0)) tracks.push(trackOf("jpml_fy_remanded", remanded));
  const fjc = s.get("fjc_idb_cases") ?? [];
  if (fjc.length) tracks.push(trackOf("fjc_idb_cases", fjc));
  const docket = s.get("docket_entries") ?? [];
  tracks.push(
    docket.length
      ? trackOf("docket_entries", docket)
      : {
          kind: "note",
          id: "docket_entries",
          label: "Master-docket entries collected",
          text: "No docket entries of this MDL are held.",
        },
  );
  const filings = s.get("filings") ?? s.get("filings_year") ?? [];
  const filingsId = s.has("filings") ? "filings" : "filings_year";
  tracks.push(
    filings.length
      ? trackOf(filingsId, filings)
      : {
          kind: "note",
          id: "filings",
          label: "Court filings collected",
          text: "No dated filings of this MDL are held.",
        },
  );
  return tracks;
}

/** One row per value, for the "Show data" table. */
export function seriesTable(rows: readonly SeriesRow[], caption: string): TableSpec {
  const order = (id: string) => {
    const g = seriesMeta(id).group;
    return g === "lifecycle" ? 0 : g === "product" ? 1 : g === "activity" ? 2 : 3;
  };
  const sorted = [...rows].sort(
    (a, b) =>
      order(a.series) - order(b.series) ||
      a.series.localeCompare(b.series) ||
      a.month.localeCompare(b.month),
  );
  return {
    caption,
    columns: [
      { label: "Series" },
      { label: "Period", align: "left" },
      { label: "Value", align: "right" },
      { label: "Note", align: "left" },
    ],
    rows: sorted.map((r) => {
      const meta = seriesMeta(r.series, r);
      const notes = [
        isPartialBasis(r.basis) ? "Partial period" : null,
        isUnverifiedBasis(r.basis) ? "MDL attribution not verified; not drawn" : null,
        /15_month_period/.test(r.basis) ? "15-month fiscal year" : null,
      ].filter(Boolean);
      return {
        key: `${r.series}|${r.month}`,
        muted: isUnverifiedBasis(r.basis),
        cells: [
          meta.label,
          periodLabel(r, meta.grain),
          r.value === null ? "Not recorded" : `${count.full(r.value)} ${meta.unit}`.trim(),
          notes.join("; ") || "",
        ],
      };
    }),
  };
}

/** Bins of a yearly run (overview strips). */
export function yearBins(run: YearRun | null): LaneBin[] {
  if (!run) return [];
  return run.values.flatMap((v, i) => {
    if (v === null) return [];
    const y = run.start + i;
    return [{ t0: y * 12, t1: y * 12 + 12, v, label: String(y), partial: run.partial === y }];
  });
}

/** Points of a lane's pending line (overview rows). */
export function lanePoints(l: Pick<LaneSummary, "pendingMonthly" | "pendingFy">): LanePoint[] {
  return pendingPoints(l).map(([t, v, link, fy]) => ({
    t,
    v,
    link: link === 1,
    label: fy ? `FY${Math.floor(t / 12)} end` : monthLabel(t),
  }));
}

/** "Mar 4, 2021" style label for a marker in tables and readouts. */
export const eventText = (iso: string | null) => (iso ? dayLabel(iso) : "Not recorded");
