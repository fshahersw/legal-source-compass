/**
 * Court data for one state's page: the federal civil caseload (fjc_civil_states, FJC Integrated Database, key `<USPS>`),
 * the state's dockets and opinion clusters in CourtListener's collection (clb_docket_master, key `state:<USPS>`), the
 * largest courts in that collection (clb_court_profiles) and the judicial positions on record for the state's courts
 * (clb_court_benches). CourtListener counts describe a collection, not complete court totals; bench counts are positions
 * on record, not a census. Courts are matched by exact CourtListener court id and only inside the state's own rows; a
 * court links to its page only when the court spine has that exact id. Stored JSON is validated here; rows that do not
 * parse are dropped, never repaired, and an unknown value stays null ("Not recorded").
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const nonNeg = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const strings = (v: unknown) => arr(v).flatMap((s) => (strOrNull(s) ? [s as string] : []));

/** CourtListener court ids are lowercase letters and digits; anything else is never placed in a query. */
export const COURT_ID = /^[a-z0-9]{1,30}$/;

export type CivilYear = {
  fy: number;
  filings: number | null;
  terminations: number | null;
  /** Cases pending at the end of the fiscal year (September 30). */
  pending: number | null;
  medianDays: number | null;
};

export type CaseMixGroup = { label: string; sharePct: number; filings: number };

export type CivilCaseload = {
  recordId: string;
  sourceUrl: string | null;
  /** Latest complete fiscal year; later years are partial and never ranked. */
  latestFy: number;
  districts: string[];
  /** FY2005 through the latest complete year. */
  series: CivilYear[];
  /** The fiscal year in progress, when the snapshot has one (through the snapshot date). */
  partialYear: CivilYear | null;
  mix: { fyFrom: number; fyTo: number; groups: CaseMixGroup[] } | null;
  /** FY-latest shares among cases where the field is recorded. */
  shares: { classActionPct: number | null; proSePct: number | null; productPct: number | null };
};

export type DocketGroup = { label: string; dockets: number };

export type CourtListenerState = {
  recordId: string;
  sourceUrl: string | null;
  courts: number | null;
  dockets: number;
  clusters: number | null;
  /** Dockets whose number marks a civil case (-cv-). */
  civilDockets: number | null;
  recapPct: number | null;
  byGroup: DocketGroup[];
  topCourts: { courtId: string; name: string; dockets: number }[];
};

export type LargeCourt = {
  courtId: string;
  name: string;
  level: string | null;
  dockets: number;
  clusters: number | null;
  recapPct: number | null;
  firstYear: number | null;
  medianCivilDays: number | null;
  /** True only when the court spine has this exact court id. */
  linked: boolean;
};

export type BenchCourt = {
  courtId: string;
  name: string;
  level: string | null;
  positions: number;
  persons: number | null;
  /** Positions with a start date and no recorded end date (not a count of sitting judges). */
  noEndRecorded: number | null;
  /** Women among those with a recorded gender, percent; null where no gender is recorded. */
  womenPct: number | null;
  medianYearsServed: number | null;
  linked: boolean;
};

export type StateBenches = {
  courts: number;
  positions: number;
  noEndRecorded: number;
  /** The courts with the most positions on record. */
  rows: BenchCourt[];
};

export type CourtSection = "civil" | "dockets" | "courts" | "benches" | "sources";

export type StateCourtData = {
  usps: string;
  civil: CivilCaseload | null;
  courtListener: CourtListenerState | null;
  courts: LargeCourt[];
  benches: StateBenches | null;
  sources: {
    fjc: { source: string | null; snapshot: string | null; terms: string | null };
    courtListener: { snapshot: string | null; terms: string | null; caveats: string[] };
  };
  unavailable: CourtSection[];
};

const FIRST_FY = 2005;
const BENCH_ROWS = 8;

function civilYear(raw: unknown): CivilYear | null {
  const r = obj(raw);
  const fy = num(r?.["fy"]);
  if (!r || fy == null || !Number.isInteger(fy)) return null;
  const filings = nonNeg(r["filings"]);
  const terminations = nonNeg(r["terminations"]);
  if (filings == null && terminations == null) return null;
  return {
    fy,
    filings,
    terminations,
    pending: nonNeg(r["pending_end"]),
    medianDays: nonNeg(r["median_days"]),
  };
}

export function parseCivilCaseload(raw: unknown, usps: string): CivilCaseload | null {
  const row = obj(raw);
  if (!row || row["id"] !== usps) return null;
  const rawSeries = arr(row["series"]);
  const entries = rawSeries.flatMap((s) => {
    const y = civilYear(s);
    return y ? [{ y, partial: obj(s)?.["partial"] === true }] : [];
  });
  const complete = entries.filter((e) => !e.partial);
  const latestStored = num(row["latest"]);
  const latestFy =
    latestStored != null && Number.isInteger(latestStored)
      ? latestStored
      : Math.max(0, ...complete.map((e) => e.y.fy));
  if (!latestFy) return null;
  const series = entries
    .filter((e) => !e.partial && e.y.fy >= FIRST_FY && e.y.fy <= latestFy)
    .map((e) => e.y)
    .sort((a, b) => a.fy - b.fy);
  if (!series.length) return null;
  const partialYear =
    entries.filter((e) => e.partial || e.y.fy > latestFy).sort((a, b) => b.y.fy - a.y.fy)[0]?.y ??
    null;
  const groups = arr(row["groups"])
    .flatMap((g) => {
      const r = obj(g);
      const label = strOrNull(r?.["label"]);
      const share = num(r?.["share_pct"]);
      const filings = nonNeg(r?.["filings"]);
      return label && share != null && share >= 0 && share <= 100 && filings != null
        ? [{ label, sharePct: share, filings }]
        : [];
    })
    .sort((a, b) => b.sharePct - a.sharePct);
  const fyFrom = num(row["from"]);
  const fyTo = num(row["to"]);
  const cells = obj(row["cells"]);
  return {
    recordId: usps,
    sourceUrl: strOrNull(row["source_url"]),
    latestFy,
    districts: strings(row["districts"]).filter((d) => COURT_ID.test(d)),
    series,
    partialYear,
    mix: groups.length && fyFrom != null && fyTo != null ? { fyFrom, fyTo, groups } : null,
    shares: {
      classActionPct: nonNeg(cells?.["class_action_pct"]),
      proSePct: nonNeg(cells?.["pro_se_pct"]),
      productPct: nonNeg(cells?.["product_pct"]),
    },
  };
}

export function parseCourtListenerState(raw: unknown, usps: string): CourtListenerState | null {
  const row = obj(raw);
  const p = obj(row?.["p"]);
  const dockets = nonNeg(p?.["dockets"]);
  if (!row || !p || row["id"] !== `state:${usps}` || p["state"] !== usps || dockets == null)
    return null;
  const byGroup = Object.entries(obj(p["by_group"]) ?? {})
    .flatMap(([label, v]) => {
      const n = nonNeg(v);
      return n != null && label.trim() ? [{ label, dockets: n }] : [];
    })
    .sort((a, b) => b.dockets - a.dockets);
  const topCourts = arr(p["top_courts"]).flatMap((c) => {
    const r = obj(c);
    const courtId = strOrNull(r?.["court_id"]);
    const name = strOrNull(r?.["name"]);
    const n = nonNeg(r?.["dockets"]);
    return courtId && COURT_ID.test(courtId) && name && n != null
      ? [{ courtId, name, dockets: n }]
      : [];
  });
  return {
    recordId: `state:${usps}`,
    sourceUrl: strOrNull(row["source_url"]),
    courts: nonNeg(p["courts"]),
    dockets,
    clusters: nonNeg(p["clusters"]),
    civilDockets: nonNeg(p["civil"]),
    recapPct: nonNeg(obj(row["cells"])?.["recap_pct"]),
    byGroup,
    topCourts,
  };
}

export function parseLargeCourts(
  topCourts: CourtListenerState["topCourts"],
  profileRows: unknown[],
  spine: ReadonlySet<string>,
  usps: string,
): LargeCourt[] {
  const profiles = new Map<string, Record<string, unknown>>();
  for (const raw of profileRows) {
    const row = obj(raw);
    const id = strOrNull(row?.["id"]);
    const cells = obj(row?.["cells"]);
    // A profile counts only when it is this court's own record in this state.
    if (id && cells && cells["state"] === usps && !profiles.has(id)) profiles.set(id, cells);
  }
  return topCourts.map((t) => {
    const c = profiles.get(t.courtId);
    return {
      courtId: t.courtId,
      name: t.name,
      level: strOrNull(c?.["level"]),
      dockets: t.dockets,
      clusters: nonNeg(c?.["clusters"]),
      recapPct: nonNeg(c?.["recap_pct"]),
      firstYear: nonNeg(c?.["first_year"]),
      medianCivilDays: nonNeg(c?.["median_civil_days"]),
      linked: spine.has(t.courtId),
    };
  });
}

/** Bench rows of the state's courts, summed as positions on record, with the largest benches listed. */
export function parseBenches(
  rows: unknown[],
  usps: string,
  spine: ReadonlySet<string> = new Set(),
): StateBenches | null {
  const courts: Omit<BenchCourt, "linked">[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = obj(raw);
    const id = strOrNull(row?.["id"]);
    const c = obj(row?.["cells"]);
    const name = strOrNull(c?.["court"]);
    const positions = nonNeg(c?.["positions"]);
    if (!id || !COURT_ID.test(id) || seen.has(id) || !c || c["state"] !== usps || !name) continue;
    if (positions == null) continue;
    seen.add(id);
    courts.push({
      courtId: id,
      name,
      level: strOrNull(c["level"]),
      positions,
      persons: nonNeg(c["persons"]),
      noEndRecorded: nonNeg(c["active"]),
      womenPct: nonNeg(c["women_active_pct"]),
      medianYearsServed: nonNeg(c["median_tenure_years"]),
    });
  }
  if (!courts.length) return null;
  courts.sort((a, b) => b.positions - a.positions || a.name.localeCompare(b.name));
  return {
    courts: courts.length,
    positions: courts.reduce((a, c) => a + c.positions, 0),
    noEndRecorded: courts.reduce((a, c) => a + (c.noEndRecorded ?? 0), 0),
    rows: courts.slice(0, BENCH_ROWS).map((c) => ({ ...c, linked: spine.has(c.courtId) })),
  };
}

export function parseCourtSummaries(rows: unknown[]): StateCourtData["sources"] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of rows) {
    const r = obj(raw);
    const id = strOrNull(r?.["id"]);
    if (r && id) byId.set(id, r);
  }
  const fjc = byId.get("fjc_civil_states");
  const master = byId.get("clb_docket_master");
  return {
    fjc: {
      source: strOrNull(fjc?.["source"]),
      snapshot: strOrNull(fjc?.["snapshot"]),
      terms: strOrNull(fjc?.["terms"]),
    },
    courtListener: {
      snapshot: strOrNull(master?.["snapshot"]),
      terms: strOrNull(master?.["terms"]),
      caveats: strings(master?.["caveats"]),
    },
  };
}

export function buildStateCourtData(
  usps: string,
  input: {
    civil: unknown;
    master: unknown;
    profiles: unknown[];
    benches: unknown[];
    spine: ReadonlySet<string>;
    summaries: unknown[];
    unavailable?: CourtSection[];
  },
): StateCourtData {
  const courtListener = parseCourtListenerState(input.master, usps);
  return {
    usps,
    civil: parseCivilCaseload(input.civil, usps),
    courtListener,
    courts: courtListener
      ? parseLargeCourts(courtListener.topCourts, input.profiles, input.spine, usps)
      : [],
    benches: parseBenches(input.benches, usps, input.spine),
    sources: parseCourtSummaries(input.summaries),
    unavailable: input.unavailable ?? [],
  };
}

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StateCourtData }>();

export const getStateCourtData = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateCourtData> => {
    const u = data.usps;
    const hit = cache.get(u);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const read = (path: string) => restGet<unknown[]>(path).then((r) => r.rows);
    const [civil, master, benches, summaries] = await Promise.allSettled([
      read(
        `corpus_records?select=id,source_url,cells:item->cells,latest:item->profile->latest_fy,districts:item->profile->districts,series:item->profile->series,groups:item->profile->window->groups,from:item->profile->window->fy_from,to:item->profile->window->fy_to&dataset=eq.fjc_civil_states&id=eq.${u}&limit=1`,
      ),
      read(
        `corpus_records?select=id,source_url,cells:item->cells,p:item->profile&dataset=eq.clb_docket_master&id=eq.state:${u}&limit=1`,
      ),
      read(
        `corpus_records?select=id,cells:item->cells&dataset=eq.clb_court_benches&state=eq.${u}&limit=1000`,
      ),
      read(
        "corpus_datasets?select=id,terms:metadata->summary->terms,source:metadata->summary->source,snapshot:metadata->summary->snapshot,caveats:metadata->summary->caveats&id=in.(fjc_civil_states,clb_docket_master)",
      ),
    ]);
    const rows = (r: PromiseSettledResult<unknown[]>) => (r.status === "fulfilled" ? r.value : []);
    const masterRow = rows(master)[0];
    const parsedMaster = parseCourtListenerState(masterRow, u);
    const benchSummary = parseBenches(rows(benches), u);
    // Court ids come from this state's own rows and are validated before they enter a query.
    const topIds = (parsedMaster?.topCourts ?? []).map((c) => c.courtId);
    const benchIds = (benchSummary?.rows ?? []).map((c) => c.courtId);
    const profileIds = [...new Set(topIds)];
    const spineIds = [...new Set([...topIds, ...benchIds])];
    const [profiles, spine] = await Promise.allSettled([
      profileIds.length
        ? read(
            `corpus_records?select=id,cells:item->cells&dataset=eq.clb_court_profiles&state=eq.${u}&id=in.(${profileIds.join(",")})&limit=50`,
          )
        : Promise.resolve([] as unknown[]),
      spineIds.length
        ? read(
            `corpus_records?select=id&dataset=eq.court_spine&id=in.(${spineIds.join(",")})&limit=100`,
          )
        : Promise.resolve([] as unknown[]),
    ]);
    const spineSet = new Set(
      rows(spine).flatMap((r) => {
        const id = strOrNull(obj(r)?.["id"]);
        return id ? [id] : [];
      }),
    );
    const settled = {
      civil,
      dockets: master,
      benches,
      sources: summaries,
      courts: profiles,
    } satisfies Record<CourtSection, PromiseSettledResult<unknown[]>>;
    const unavailable = (Object.keys(settled) as CourtSection[]).filter(
      (k) => settled[k].status === "rejected",
    );
    if (
      civil.status === "rejected" &&
      master.status === "rejected" &&
      benches.status === "rejected"
    )
      throw new Error("Court data could not be read.");
    const value = buildStateCourtData(u, {
      civil: rows(civil)[0],
      master: masterRow,
      profiles: rows(profiles),
      benches: rows(benches),
      // A failed spine read leaves courts unlinked rather than guessing which pages exist.
      spine: spineSet,
      summaries: rows(summaries),
      unavailable,
    });
    if (!unavailable.length) cache.set(u, { at: Date.now(), value });
    return value;
  });
