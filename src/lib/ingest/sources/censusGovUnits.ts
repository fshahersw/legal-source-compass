/**
 * Census Bureau Government Units List (Census of Governments / Government Units Survey): every county, municipal and
 * township government, special district, independent school district, dependent school system and public pension system
 * in the United States, with its mailing address, website, contact title as printed, population (general purpose) or
 * enrollment (schools), and the county it is listed under.
 *   - One corpus row per county (5-digit FIPS) and category, plus one per state for units the file lists without a county
 *     (state-level dependent school systems and state pension systems). A unit serving several counties is listed once,
 *     under the county the file gives it.
 *   - The workbook is read in eight parts on consecutive runs (general purpose and special districts each split into three
 *     state ranges; school districts with dependent school systems; pension systems) so each run stays within the edge
 *     runtime's CPU budget. Rows of a part are skipped by their state code before they are parsed.
 *   - The file names no individuals; contact titles are as printed. Public domain (U.S. Census Bureau).
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type {
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
  CollectContext,
} from "../types.ts";
import { xlsxRecords, xlsxSheets, xlsxSharedStrings, type RowFilter } from "../xlsx.ts";
import { zipEntries, zipRead } from "../zip.ts";

export const GOV_UNITS_DATASET = "census_gov_units";
export const GUS_INDEX = "https://www2.census.gov/programs-surveys/gus/datasets/";
export const GUS_PAGE = "https://www.census.gov/programs-surveys/gus.html";
export const GUS_DEFAULT_YEAR = 2026;
export const gusZipUrl = (year: number) => `${GUS_INDEX}${year}/gov_units_${year}.zip`;

export type Category = "general" | "special" | "schools" | "pensions";

export const CATEGORY_LABEL: Record<Category, string> = {
  general: "County, municipal and township governments",
  special: "Special districts",
  schools: "School districts and dependent school systems",
  pensions: "Public pension systems",
};

/**
 * Workbook slices read in each part, in order. A sheet too large for one run is split by state FIPS code (a county never
 * spans states, so each county's row is always built from one part).
 */
export type Part = { sheets: string[]; states?: [string, string] };
export const PARTS: Part[] = [
  { sheets: ["General Purpose"], states: ["01", "24"] },
  { sheets: ["General Purpose"], states: ["25", "39"] },
  { sheets: ["General Purpose"], states: ["40", "56"] },
  { sheets: ["Special District"], states: ["01", "17"] },
  { sheets: ["Special District"], states: ["18", "36"] },
  { sheets: ["Special District"], states: ["37", "56"] },
  { sheets: ["School District", "DEP School Dist"] },
  { sheets: ["Public Pension Sys"] },
];

export const partLabel = (p: Part) =>
  `${p.sheets.join(", ")}${p.states ? `, state FIPS ${p.states[0]}-${p.states[1]}` : ""}`;

const SHEET_CATEGORY: Record<string, Category> = {
  "General Purpose": "general",
  "Special District": "special",
  "School District": "schools",
  "DEP School Dist": "schools",
  "Public Pension Sys": "pensions",
};

const STATE_FIPS: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

export type GovUnit = {
  id: string;
  name: string;
  /** "1 - COUNTY", "4 - SPECIAL DISTRICT", ... as printed. */
  type: string;
  /** Special-district function, school level or pension activity, as printed. */
  kind: string | null;
  title: string | null;
  address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  website: string | null;
  population: number | null;
  population_year: string | null;
  enrollment: number | null;
  enrollment_year: string | null;
  political: string | null;
  fips_place: string | null;
  parent_id: string | null;
  parent_name: string | null;
  active: boolean;
};

type Rec = Record<string, string | null>;

const SPACE_RUN = /\s{2,}|[\t\n\r]/;
const clean = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const t = SPACE_RUN.test(v) ? v.replace(/\s+/g, " ").trim() : v.trim();
  return t ? t : null;
};

/** "61,464" → 61464; null when not a whole number. */
export function count(v: string | null | undefined): number | null {
  const t = (v ?? "").replace(/,/g, "").trim();
  return /^\d{1,10}$/.test(t) ? Number(t) : null;
}

const WEB =
  /^(https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(:\d+)?(\/[^\s]*)?$/i;
/** A website as printed, with a scheme added when missing; null when it is not a host name. */
export function website(v: string | null | undefined): string | null {
  const t = clean(v);
  if (!t) return null;
  const m = WEB.exec(t);
  if (!m) return null;
  return `${m[1] ? m[1].toLowerCase() : "http://"}${m[2]!.toLowerCase()}${m[3] ?? ""}${m[4] ?? "/"}`;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One unit from a sheet record; null when it has no identifier, name or state code. */
export function unitOf(sheet: string, r: Rec): GovUnit | null {
  const id = clean(r["CENSUS_ID_PID6"]);
  const name = clean(r["UNIT_NAME"]);
  // mailing state as printed; a unit listed without an address takes the state of its FIPS state code
  const state = clean(r["STATE"]) ?? STATE_FIPS[clean(r["FIPS_STATE"]) ?? ""] ?? null;
  if (!id || !/^\d{1,9}$/.test(id) || !name || !state || !/^[A-Z]{2}$/.test(state)) return null;
  const address = [clean(r["ADDRESS1"]), clean(r["ADDRESS2"])].filter(Boolean).join(", ") || null;
  const zip5 = clean(r["ZIP"]);
  const zip4 = clean(r["ZIP4"]);
  const kind =
    clean(r["FUNCTION_NAME"]) ?? clean(r["SCHOOL_LEVEL_DESCRIPTION"]) ?? clean(r["ACTIVITY_NAME"]);
  return {
    id,
    name,
    type:
      clean(r["UNIT_TYPE"]) ??
      (sheet === "Special District" ? "4 - SPECIAL DISTRICT" : "Not recorded"),
    kind,
    title: clean(r["TITLE"]),
    address,
    city: clean(r["CITY"]),
    state,
    zip: zip5 ? (zip4 ? `${zip5}-${zip4}` : zip5) : null,
    website: website(r["WEB_ADDRESS"]),
    population: count(r["POPULATION"]),
    population_year: clean(r["POPULATION_SOURCE_YEAR"]) ?? clean(r["POPULATION_YEAR"]),
    enrollment: count(r["SCHOOL_ENROLLMENT"] ?? r["ENROLLMENT"]),
    enrollment_year: clean(r["ENROLLMENT_YEAR"]),
    political: clean(r["POLITICAL_CODE_DESCRIPTION"]),
    fips_place: clean(r["FIPS_PLACE"]),
    parent_id: clean(r["PARENT_CENSUS_ID_PID6"]),
    parent_name: clean(r["PARENT_UNIT_NAME"]),
    active: (clean(r["ACTIVE"]) ?? clean(r["IS_ACTIVE"]) ?? "Y").toUpperCase() !== "N",
  };
}

/** The county (5-digit) or state (2-digit) area a record is listed under, with the area's printed name. */
export function areaOf(r: Rec): { geo: string; name: string | null } | null {
  const st = clean(r["FIPS_STATE"]);
  if (!st || !/^\d{2}$/.test(st)) return null;
  const co = clean(r["FIPS_COUNTY"]);
  if (co && /^\d{3}$/.test(co)) return { geo: `${st}${co}`, name: clean(r["COUNTY_AREA_NAME"]) };
  return { geo: st, name: null };
}

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s.'’(/-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => `Mc${c.toUpperCase()}`);

export type AreaGroup = {
  geo: string;
  state: string;
  areaName: string | null;
  category: Category;
  units: GovUnit[];
};

/** Groups the units of one part by area and category. */
export function groupUnits(
  rows: { sheet: string; record: Rec }[],
  held: HeldRecord[],
): AreaGroup[] {
  const groups = new Map<string, AreaGroup>();
  const seen = new Set<string>();
  for (const { sheet, record } of rows) {
    const category = SHEET_CATEGORY[sheet];
    if (!category) continue;
    const unit = unitOf(sheet, record);
    const area = areaOf(record);
    if (!unit || !area) {
      held.push({
        key: clean(record["CENSUS_ID_PID6"]) ?? clean(record["UNIT_NAME"]) ?? sheet,
        reason: "unit without an identifier, name, state or state code",
      });
      continue;
    }
    if (seen.has(unit.id)) {
      held.push({ key: unit.id, reason: "unit identifier listed twice" });
      continue;
    }
    seen.add(unit.id);
    const key = `${area.geo}:${category}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        geo: area.geo,
        state: STATE_FIPS[area.geo.slice(0, 2)] ?? unit.state,
        areaName: area.name,
        category,
        units: [],
      };
      groups.set(key, g);
    }
    if (!g.areaName && area.name) g.areaName = area.name;
    g.units.push(unit);
  }
  for (const g of groups.values())
    g.units.sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id));
  return [...groups.values()].sort(
    (a, b) => byText(a.geo, b.geo) || byText(a.category, b.category),
  );
}

const SHORT = new Map<string, string>();
/** "91 - WATER SUPPLY UTILITY" → "Water Supply Utility" (memoised: a file has a few dozen distinct values). */
const shortType = (t: string) => {
  let v = SHORT.get(t);
  if (v === undefined) {
    v = titleCase(t.replace(/^\s*\w+\s*-\s*/, ""));
    SHORT.set(t, v);
  }
  return v;
};

function breakdown(units: GovUnit[], category: Category): [string, number][] {
  const m = new Map<string, number>();
  for (const u of units) {
    const k =
      category === "general"
        ? shortType(u.type)
        : category === "pensions"
          ? shortType(u.type)
          : u.kind
            ? shortType(u.kind)
            : "Not recorded";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
}

const compact = (u: GovUnit): JsonObject => {
  const o: JsonObject = {};
  for (const [k, v] of Object.entries(u)) if (v !== null && v !== "") o[k] = v as Json;
  return o;
};

export function areaLabel(g: AreaGroup): string {
  if (g.geo.length === 2) return `${g.state} (statewide)`;
  return g.areaName ? `${titleCase(g.areaName)}, ${g.state}` : `County ${g.geo}, ${g.state}`;
}

export function govUnitsRow(g: AreaGroup, year: number, zipUrl: string): CorpusRow {
  const label = CATEGORY_LABEL[g.category];
  const area = areaLabel(g);
  const parts = breakdown(g.units, g.category);
  const active = g.units.filter((u) => u.active).length;
  const county = g.units.find((u) => /^1\b/.test(u.type) && g.category === "general") ?? null;
  const enrollment = g.units.reduce((s, u) => s + (u.enrollment ?? 0), 0);
  const largest =
    g.category === "general"
      ? [...g.units].sort((a, b) => (b.population ?? -1) - (a.population ?? -1))[0]
      : g.category === "schools"
        ? [...g.units].sort((a, b) => (b.enrollment ?? -1) - (a.enrollment ?? -1))[0]
        : undefined;
  const id = `govunits:${g.geo}:${g.category}`;
  const row = corpusRecord(
    GOV_UNITS_DATASET,
    id,
    `${area}: ${label.toLowerCase()} (${g.units.length})`,
    {
      source_url: GUS_PAGE,
      state: g.state,
      subtitle: `${parts
        .slice(0, 3)
        .map(([k, n]) => `${n} ${k.toLowerCase()}`)
        .join(" · ")} · Government Units List ${year}`,
      cells: {
        area,
        state: g.state,
        category: label,
        units: g.units.length,
        active,
        county_population: county?.population ?? null,
        enrollment: g.category === "schools" ? enrollment : null,
        largest: largest?.name ?? null,
        edition: year,
      },
      facts: [
        [
          "Area",
          g.geo.length === 5
            ? `${area} (county FIPS ${g.geo})`
            : `${area}: units listed without a county`,
        ],
        ["Category", label],
        ["Units listed", `${g.units.length} (${active} active as the file marks them)`],
        [
          "By type",
          parts
            .slice(0, 12)
            .map(([k, n]) => `${k}: ${n}`)
            .join("; "),
        ],
        ...(county?.population !== null && county?.population !== undefined
          ? [
              [
                "County population (as the file states)",
                `${county.population.toLocaleString("en-US")} (${county.population_year ?? "year not recorded"})`,
              ] as [string, string],
            ]
          : []),
        ...(g.category === "schools" && enrollment
          ? [["Enrollment listed", enrollment.toLocaleString("en-US")] as [string, string]]
          : []),
        ["Edition", `Census Bureau Government Units List ${year} (Census of Governments)`],
        [
          "Note",
          "A unit serving several counties is listed once, under the county the file gives it. Contact titles are as printed; the file names no individuals.",
        ],
      ],
      text: `${area} ${label} ${g.units.map((u) => `${u.name} ${u.city ?? ""}`).join(" ")}`.slice(
        0,
        60000,
      ),
      filters: {
        category: [g.category],
        state: [g.state],
        type: parts.map(([k]) => k).slice(0, 40),
      },
      links: [
        { label: "Census Government Units Survey", url: GUS_PAGE },
        { label: `Government Units List ${year} (ZIP)`, url: zipUrl },
      ],
      extra: {
        gov_units: {
          edition: year,
          geo: g.geo,
          area,
          category: g.category,
          units: g.units.map(compact),
        },
      },
    },
  );
  row.county_geoids = g.geo.length === 5 ? [g.geo] : [];
  return row;
}

export const comparableGovUnits = (content: RowContent): Json => content as unknown as Json;

/** Newest year folder under the GUS datasets index that holds a gov_units_<year>.zip. */
export async function latestEdition(ctx: CollectContext, notes: JsonObject): Promise<number> {
  let year = GUS_DEFAULT_YEAR;
  try {
    const idx = await ctx.http.getText(GUS_INDEX);
    if (idx.status === 200) {
      const years = [...idx.text.matchAll(/href="(20\d\d)\/"/g)]
        .map((m) => Number(m[1]))
        .filter((y) => y > year)
        .sort((a, b) => b - a);
      for (const y of years.slice(0, 2)) {
        const dir = await ctx.http.getText(`${GUS_INDEX}${y}/`);
        if (dir.status === 200 && new RegExp(`gov_units_${y}\\.zip`, "i").test(dir.text)) {
          year = y;
          break;
        }
      }
    }
    notes["index"] = idx.status;
  } catch (error) {
    if (error instanceof BudgetExhausted || error instanceof RateLimited) throw error;
    notes["index"] = "unreadable";
  }
  return year;
}

export const censusGovUnits: SourceAdapter = {
  source: "census_gov_units",
  dataset: GOV_UNITS_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-census",
  limits: { maxRequests: 6, minIntervalMs: 1000 },
  secrets: [],
  async collect(ctx): Promise<Collected> {
    if (!ctx.http.getBytes) throw new Error("this run's HTTP client cannot read binary files");
    const cursor =
      ctx.cursor && typeof ctx.cursor === "object" && !Array.isArray(ctx.cursor)
        ? (ctx.cursor as JsonObject)
        : {};
    const notes: JsonObject = {};
    const year = await latestEdition(ctx, notes);
    const sameEdition = cursor["edition"] === year;
    const next =
      sameEdition && typeof cursor["next"] === "number" ? cursor["next"] % PARTS.length : 0;
    const url = gusZipUrl(year);
    const res = await ctx.http.getBytes(url);
    if (res.status !== 200) throw new Error(`Government Units List ZIP HTTP ${res.status}`);
    const entry = zipEntries(res.bytes).find((e) => /\.xlsx$/i.test(e.name));
    if (!entry) throw new Error("the Government Units archive has no workbook");
    const book = await zipRead(res.bytes, entry);
    const sheets = await xlsxSheets(book);
    const strings = await xlsxSharedStrings(book);
    const part = PARTS[next]!;
    const records: { sheet: string; record: Rec }[] = [];
    const bySheet: JsonObject = {};
    for (const name of part.sheets) {
      const sheet = sheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
      if (!sheet) throw new Error(`the workbook has no "${name}" sheet`);
      const filter: RowFilter | undefined = part.states
        ? {
            column: "FIPS_STATE",
            keep: (v) => {
              const t = (v ?? "").trim();
              return t >= part.states![0] && t <= part.states![1];
            },
          }
        : undefined;
      const recs = await xlsxRecords(book, sheet.path, strings, filter);
      bySheet[name] = recs.length;
      for (const record of recs) records.push({ sheet: name, record });
    }
    if (records.length < 1000)
      throw new Error(
        `only ${records.length} units read for part ${next + 1} (${partLabel(part)})`,
      );
    const held: HeldRecord[] = [];
    const groups = groupUnits(records, held);
    const rows = groups.map((g) => govUnitsRow(g, year, url));
    const done =
      sameEdition &&
      cursor["done"] &&
      typeof cursor["done"] === "object" &&
      !Array.isArray(cursor["done"])
        ? { ...(cursor["done"] as JsonObject) }
        : {};
    done[String(next)] = ctx.now.toISOString().slice(0, 10);
    notes["edition"] = year;
    notes["part"] = `${next + 1} of ${PARTS.length}: ${partLabel(part)}`;
    notes["units_by_sheet"] = bySheet;
    notes["areas"] = rows.length;
    return {
      rows,
      fetched: records.length,
      held,
      cursorAfter: { edition: year, next: (next + 1) % PARTS.length, done },
      complete: true,
      notes,
    };
  },
  comparable: comparableGovUnits,
};
