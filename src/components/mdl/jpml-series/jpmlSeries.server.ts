/**
 * Server-side reads for the JPML statistics series (datasets jpml_pending_snapshots, jpml_quarterly_caseload,
 * jpml_transferee_series, jpml_mdl_pending_series, jpml_series_index). Read-only PostgREST; stored JSON goes through
 * the defensive parsers in model.ts and malformed rows are dropped.
 */
import { restGet } from "@/lib/external/rest.server";
import {
  parseCircuit,
  parseDatedValues,
  parseEntity,
  parseMdlSeries,
  parseOverview,
  topAtLatest,
  type EntitySeries,
  type MdlSeries,
  type National,
} from "./model";

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; value: National | null } | null = null;

async function readAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < 20000; start += 1000) {
    const page = await restGet<T[]>(path, { range: [start, start + 999] });
    out.push(...page.rows);
    if (page.rows.length < 1000) break;
  }
  return out;
}

const base = (dataset: string, select: string, filter: string) =>
  `corpus_records?select=${select}&dataset=eq.${dataset}${filter}&order=id.asc`;

/** Judges shown in the over-time view: the largest by pending actions at the latest monthly report. */
export const JUDGES_SHOWN = 12;
/** Districts shown in the over-time view, chosen the same way. */
export const DISTRICTS_SHOWN = 9;

export async function readNational(): Promise<National | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [over, fy, circuits, districts, judges] = await Promise.all([
    readAll<{ item: unknown }>(
      base("jpml_pending_snapshots", "item:item->overview", "&id=eq.summary:overview"),
    ),
    readAll<{ points: unknown }>(
      base(
        "jpml_series_index",
        "points:item->points",
        "&id=eq.series:national.pending_actions.fiscal_year",
      ),
    ),
    readAll<{ circuit: unknown; series: unknown }>(
      base(
        "jpml_quarterly_caseload",
        "circuit:item->circuit,series:item->series",
        "&id=like.circuit:*",
      ),
    ),
    readAll<{ id: unknown; district: unknown; court: unknown; series: unknown }>(
      base(
        "jpml_transferee_series",
        "id,district:item->district,court:item->court,series:item->series",
        "&id=like.district:*",
      ),
    ),
    readAll<{ id: unknown; judge: unknown; series: unknown }>(
      base(
        "jpml_transferee_series",
        "id,judge:item->judge,series:item->series",
        "&id=like.judge:*",
      ),
    ),
  ]);
  const o = parseOverview(over[0]?.item);
  if (!o) {
    cache = { at: Date.now(), value: null };
    return null;
  }
  const latest = o.monthly[o.monthly.length - 1]!.date;
  const allJudges = judges.flatMap(
    (j) => parseEntity(j.id, { judge: j.judge, series: j.series }) ?? [],
  );
  const value: National = {
    ...o,
    fiscalYear: parseDatedValues(fy[0]?.points),
    circuits: circuits.flatMap((c) => parseCircuit({ circuit: c.circuit, series: c.series }) ?? []),
    districts: topAtLatest(
      districts.flatMap(
        (d) => parseEntity(d.id, { district: d.district, court: d.court, series: d.series }) ?? [],
      ),
      latest,
      DISTRICTS_SHOWN,
    ),
    judges: topAtLatest(allJudges, latest, JUDGES_SHOWN),
    judgesTotal: allJudges.length,
  };
  cache = { at: Date.now(), value };
  return value;
}

export async function readMdlSeries(mdl: number): Promise<MdlSeries | null> {
  const rows = await readAll<{ series: unknown; source_url: unknown }>(
    base("jpml_mdl_pending_series", "source_url,series:item->series", `&id=eq.mdl:${mdl}`),
  );
  const r = rows[0];
  return r ? parseMdlSeries(mdl, { series: r.series }, r.source_url) : null;
}

export type { EntitySeries };
