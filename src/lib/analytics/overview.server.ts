/**
 * Reads behind the Analytics overview: one reader per block. Each does compact read-only selects (or reuses the
 * validated reads of the domain pages), parses with the validators in ./parse, and hands the rows to the pure builder
 * in ./blocks. A reader returns null when its dataset holds nothing usable; a failed read throws, and the block shows
 * its error state. Results are cached in memory, so a page of twenty-one blocks costs one read per source per window.
 * Server-only.
 */
import { restGet } from "@/lib/external/rest.server";
import { parseNational } from "@/lib/external/courtCaseload.functions";
import { parseDojOverview } from "@/lib/external/enforcementActions.functions";
import { parseOshaEnforcement } from "@/lib/external/oshaEnforcement.functions";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { readCaers, readCpsc, readFaers } from "@/lib/insights/readers/safety";
import { readCfpb } from "@/lib/insights/readers/shared";
import {
  buildFederalCivil,
  buildFederalCriminal,
  buildMdlPending,
  buildNominations,
  buildSecurities,
  buildVacancies,
} from "./blocks/courts";
import {
  buildDojPress,
  buildEpaCases,
  buildFtcActions,
  buildOshaInspections,
  buildSecReleases,
  FTC_KIND_LABELS,
} from "./blocks/enforcement";
import { buildCfpbComplaints, buildSentinel } from "./blocks/consumer";
import {
  buildCaers,
  buildCpscRecalls,
  buildFaers,
  buildFdaRecalls,
  buildFsisRecalls,
  buildNhtsaRecalls,
  type FdaYear,
} from "./blocks/safety";
import { buildBills, buildFederalRegister } from "./blocks/rulemaking";
import {
  billsFromParts,
  integer,
  introducedByCongress,
  isoDate,
  obj,
  parseCriminalSeries,
  parseEpaYears,
  parseFsisByYear,
  parseMdlMonthly,
  parseMdlYears,
  parseSecuritiesYears,
  parseSentinelYears,
  parseTypeYears,
  parseVacancyMonths,
  tallyFtc,
  tallyNominations,
  tallySec,
  tallyYears,
  text,
} from "./parse";
import { countRows, jsonPath, mapLimit, readAllRows } from "./tally.server";
import { throughDate, type TrendBlockData } from "./trend";

/** Heavier reads (many pages or counts) are kept longer: the datasets change only when a build is published. */
const LONG_TTL_MS = 30 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

/** Selected keys of a dataset's `metadata.summary`. `suffix` is the JSON path after `summary`: "->>snapshot" (text) or "->by_year" (JSON). */
async function datasetSummary<K extends string>(
  dataset: string,
  keys: Record<K, string>,
): Promise<Partial<Record<K, unknown>>> {
  const select = Object.entries(keys)
    .map(([alias, suffix]) => `${alias}:metadata->summary${String(suffix)}`)
    .join(",");
  const r = await restGet<Record<string, unknown>[]>(
    `corpus_datasets?select=${select}&id=eq.${dataset}&limit=1`,
  );
  return (r.rows[0] ?? {}) as Partial<Record<K, unknown>>;
}

/** The latest date held in a dataset, read by ordering on a JSON path (ISO dates sort as text). */
async function latestDate(
  dataset: string,
  jsonOrder: string,
  jsonText: string,
): Promise<string | null> {
  const r = await restGet<{ d: unknown }[]>(
    `corpus_records?select=d:${jsonText}&dataset=eq.${dataset}&order=${jsonOrder}.desc.nullslast&limit=1`,
  );
  return isoDate(r.rows[0]?.d);
}

// ------------------------------------------------------------------------------------------------ courts

const readFederalCivil = memoAsync(READ_TTL_MS, async () => {
  const [profile, summary] = await Promise.all([
    restGet<{ p: unknown }[]>(
      "corpus_records?select=p:item->profile&dataset=eq.fjc_civil_national&id=eq.US:summary&limit=1",
    ),
    datasetSummary("fjc_civil_national", { snapshot: "->>snapshot" }),
  ]);
  const national = parseNational(profile.rows[0]?.p);
  if (!national) return null;
  return buildFederalCivil({
    rows: national.years.map((y) => ({
      fy: y.fy,
      partial: y.partial,
      filed: y.filings,
      terminated: y.terminations,
    })),
    throughDate: throughDate(text(summary.snapshot)),
  });
});

const readFederalCriminal = memoAsync(READ_TTL_MS, async () => {
  const [series, summary] = await Promise.all([
    restGet<{ s: unknown }[]>(
      "corpus_records?select=s:item->series&dataset=eq.fjc_criminal_districts&id=eq.national&limit=1",
    ),
    datasetSummary("fjc_criminal_districts", { snapshot: "->>snapshot" }),
  ]);
  return buildFederalCriminal({
    rows: parseCriminalSeries(series.rows[0]?.s),
    throughDate: throughDate(text(summary.snapshot)),
  });
});

const readMdlPending = memoAsync(READ_TTL_MS, async () => {
  const [years, monthly] = await Promise.all([
    restGet<{ s: unknown }[]>(
      "corpus_records?select=s:item->overview->series&dataset=eq.jpml_statistics_extra&id=eq.summary:overview&limit=1",
    ),
    restGet<{ p: unknown }[]>(
      "corpus_records?select=p:item->overview->portfolio&dataset=eq.mdl_analytics&id=eq.summary:overview&limit=1",
    ),
  ]);
  return buildMdlPending({
    years: parseMdlYears(years.rows[0]?.s),
    monthly: parseMdlMonthly(monthly.rows[0]?.p),
  });
});

const readSecurities = memoAsync(READ_TTL_MS, async () => {
  const [rows, summary] = await Promise.all([
    restGet<{ cells: unknown }[]>(
      "corpus_records?select=cells:item->cells&dataset=eq.scac_statistics&id=like.year:*&order=ordinal.asc&limit=200",
    ),
    datasetSummary("scac_statistics", { asOf: "->>as_of" }),
  ]);
  return buildSecurities({
    years: parseSecuritiesYears(rows.rows.map((r) => r.cells)),
    throughDate: throughDate(text(summary.asOf)),
  });
});

const readVacancies = memoAsync(READ_TTL_MS, async () => {
  const [national, summary] = await Promise.all([
    restGet<{ s: unknown }[]>(
      "corpus_records?select=s:item->series&dataset=eq.judicial_vacancies&id=eq.national&limit=1",
    ),
    datasetSummary("judicial_vacancies", { asOf: "->>as_of" }),
  ]);
  return buildVacancies({
    months: parseVacancyMonths(national.rows[0]?.s),
    asOf: isoDate(summary.asOf),
  });
});

const readNominations = memoAsync(LONG_TTL_MS, async () => {
  const [rows, summary] = await Promise.all([
    readAllRows<{ c: unknown; s: unknown }>(
      "corpus_records?select=c:filters->congress->>0,s:filters->status->>0&dataset=eq.judicial_nominations&order=ordinal.asc,id.asc",
    ),
    datasetSummary("judicial_nominations", { asOf: "->>as_of" }),
  ]);
  const asOf = isoDate(summary.asOf);
  if (!asOf) throw new Error("The nominations dataset states no as-of date.");
  return buildNominations({ congresses: tallyNominations(rows), asOf });
});

// ------------------------------------------------------------------------------------------------ enforcement

const readDojPress = memoAsync(LONG_TTL_MS, async () => {
  const overview = parseDojOverview(
    (
      await restGet<{ o: unknown }[]>(
        "corpus_records?select=o:item->overview&dataset=eq.doj_press_releases&id=eq.doj-index:overview&limit=1",
      )
    ).rows[0]?.o,
  );
  if (!overview) return null;
  const last = overview.partitions[overview.partitions.length - 1];
  const latest = last
    ? await latestDate(last.dataset, "item->release->date", "item->release->>date")
    : null;
  return buildDojPress({
    byYear: overview.byYear.map((y) => ({ year: Number(y.year), count: y.count })),
    latestDate: latest,
    today: today(),
  });
});

const readSecReleases = memoAsync(LONG_TTL_MS, async () => {
  const [rows, latest] = await Promise.all([
    readAllRows<{ y: unknown; t: unknown }>(
      "corpus_records?select=y:filters->year->>0,t:filters->type->>0&dataset=eq.sec_enforcement_actions&order=ordinal.asc,id.asc",
    ),
    latestDate("sec_enforcement_actions", "item->sec_action->date", "item->sec_action->>date"),
  ]);
  return buildSecReleases({ years: tallySec(rows), latestDate: latest, today: today() });
});

const readFtcActions = memoAsync(LONG_TTL_MS, async () => {
  const [rows, latest] = await Promise.all([
    readAllRows<{ y: unknown; k: unknown }>(
      "corpus_records?select=y:filters->year->>0,k:filters->kind->>0&dataset=eq.ftc_enforcement_actions&order=ordinal.asc,id.asc",
    ),
    latestDate("ftc_enforcement_actions", "item->ftc_action->date", "item->ftc_action->>date"),
  ]);
  const { years, undated } = tallyFtc(rows, Object.keys(FTC_KIND_LABELS));
  return buildFtcActions({ years, undated, latestDate: latest, today: today() });
});

const readEpaCases = memoAsync(READ_TTL_MS, async () => {
  const [rows, summary] = await Promise.all([
    restGet<{ cells: unknown }[]>(
      "corpus_records?select=cells:item->cells&dataset=eq.epa_echo_case_series&id=like.epa-echo-series:US:*&order=ordinal.asc&limit=200",
    ),
    datasetSummary("epa_echo_case_series", {
      fileDate: "->>file_date",
      latestFy: "->>latest_complete_fy",
    }),
  ]);
  const latestFy = integer(Number(text(summary.latestFy)));
  return buildEpaCases({
    years: parseEpaYears(rows.rows.map((r) => r.cells)),
    latestCompleteFy: latestFy,
    fileDate: isoDate(summary.fileDate),
  });
});

const readOshaInspections = memoAsync(READ_TTL_MS, async () => {
  const [profile, summary] = await Promise.all([
    restGet<{ p: unknown }[]>(
      "corpus_records?select=p:item->profile&dataset=eq.osha_inspections_national&id=eq.osha-national:summary&limit=1",
    ),
    datasetSummary("osha_inspections_national", { snapshot: "->>snapshot" }),
  ]);
  const parsed = parseOshaEnforcement({
    summary: profile.rows[0]?.p,
    year: undefined,
    sir: undefined,
    employers: [],
  });
  if (!parsed) return null;
  return buildOshaInspections({
    years: parsed.series.map((y) => ({
      fy: y.fy,
      inspections: y.inspections,
      statePlan: y.statePlan,
      partial: y.partial,
    })),
    snapshot: isoDate(summary.snapshot),
  });
});

// ------------------------------------------------------------------------------------------------ safety

const readCpscRecalls = memoAsync(READ_TTL_MS, async () => {
  const cpsc = await readCpsc();
  if (!cpsc) return null;
  return buildCpscRecalls({
    years: cpsc.years.map((y) => ({ year: y.year, recalls: y.recalls, partial: y.partial })),
    asOf: isoDate(cpsc.asOf),
  });
});

const readNhtsaRecalls = memoAsync(LONG_TTL_MS, async () => {
  const [rows, latest] = await Promise.all([
    readAllRows<{ y: unknown }>(
      "corpus_records?select=y:filters->year->>0&dataset=eq.agency_safety_nhtsa_recalls&item->>kind=eq.recall&order=ordinal.asc,id.asc",
    ),
    latestDate("agency_safety_nhtsa_recalls", "filters->date", "filters->>date"),
  ]);
  return buildNhtsaRecalls({ byYear: tallyYears(rows), latestDate: latest, today: today() });
});

const readFsisRecalls = memoAsync(READ_TTL_MS, async () => {
  const [summary, latest] = await Promise.all([
    datasetSummary("fsis_recalls", { byYear: "->by_year" }),
    latestDate("fsis_recalls", "item->cells->date", "item->cells->>date"),
  ]);
  return buildFsisRecalls({
    years: parseFsisByYear(summary.byYear),
    latestDate: latest,
    today: today(),
  });
});

const FDA_DATASETS = [
  { key: "drug", dataset: "agency_safety_openfda_drug_enforcement" },
  { key: "device", dataset: "agency_safety_openfda_device_enforcement" },
  { key: "food", dataset: "agency_safety_openfda_food_enforcement" },
] as const;

const readFdaRecalls = memoAsync(LONG_TTL_MS, async () => {
  const date = jsonPath("filters->>report_date");
  const bounds = await Promise.all(
    FDA_DATASETS.map(async ({ dataset }) => {
      const [min, max] = await Promise.all([
        restGet<{ d: unknown }[]>(
          `corpus_records?select=d:filters->>report_date&dataset=eq.${dataset}&order=filters->report_date.asc.nullslast&limit=1`,
        ),
        restGet<{ d: unknown }[]>(
          `corpus_records?select=d:filters->>report_date&dataset=eq.${dataset}&order=filters->report_date.desc.nullslast&limit=1`,
        ),
      ]);
      return { min: isoDate(min.rows[0]?.d), max: isoDate(max.rows[0]?.d) };
    }),
  );
  const mins = bounds.flatMap((b) => (b.min ? [Number(b.min.slice(0, 4))] : []));
  const maxes = bounds.flatMap((b) => (b.max ? [b.max] : []));
  if (!mins.length || !maxes.length) return null;
  const first = Math.min(...mins);
  const latest = maxes.sort().at(-1)!;
  const last = Number(latest.slice(0, 4));
  const jobs: { year: number; key: (typeof FDA_DATASETS)[number]["key"]; dataset: string }[] = [];
  for (let year = first; year <= last; year += 1)
    for (const d of FDA_DATASETS) jobs.push({ year, key: d.key, dataset: d.dataset });
  const counts = await mapLimit(jobs, 6, (j) =>
    countRows(
      `corpus_records?dataset=eq.${j.dataset}&${date}=gte.${j.year}-01-01&${date}=lt.${j.year + 1}-01-01`,
    ),
  );
  const years = new Map<number, FdaYear>();
  jobs.forEach((j, i) => {
    const entry = years.get(j.year) ?? { year: j.year, drug: 0, device: 0, food: 0 };
    entry[j.key] = counts[i]!;
    years.set(j.year, entry);
  });
  return buildFdaRecalls({
    years: [...years.values()].sort((a, b) => a.year - b.year),
    latestDate: latest,
    today: today(),
  });
});

const readFaersBlock = memoAsync(READ_TTL_MS, async () => {
  const faers = await readFaers();
  if (!faers) return null;
  return buildFaers({
    years: faers.national.map((y) => ({ year: y.year, reports: y.reports, partial: y.partial })),
    dataThrough: isoDate(faers.dataThrough),
  });
});

const readCaersBlock = memoAsync(READ_TTL_MS, async () => {
  const caers = await readCaers();
  if (!caers) return null;
  return buildCaers({
    years: caers.years.map((y) => ({ year: y.year, reports: y.reports, partial: y.partial })),
    dataThrough: isoDate(caers.dataThrough),
  });
});

// ------------------------------------------------------------------------------------------------ consumer

const readCfpbComplaints = memoAsync(READ_TTL_MS, async () => {
  const cfpb = await readCfpb();
  if (!cfpb) return null;
  return buildCfpbComplaints({
    years: cfpb.years.map((y) => ({
      year: y.year,
      complaints: y.complaints,
      complete: y.complete,
      creditReporting: y.creditReporting,
    })),
    from: isoDate(cfpb.from),
    to: isoDate(cfpb.to),
  });
});

const readSentinel = memoAsync(READ_TTL_MS, async () => {
  const rows = await restGet<{ id: unknown; reports: unknown; source_url: unknown }[]>(
    "corpus_records?select=id,reports:item->reports,source_url&dataset=eq.ftc_sentinel_national&id=like.US-2*&order=id.asc&limit=60",
  );
  return buildSentinel({ years: parseSentinelYears(rows.rows) });
});

// ------------------------------------------------------------------------------------------------ rulemaking and legislation

const readFederalRegister = memoAsync(READ_TTL_MS, async () => {
  const r = await restGet<{ yearly: unknown; asOf: unknown }[]>(
    "corpus_records?select=yearly:item->trends->yearly,asOf:item->trends->>asOf&dataset=eq.fr_agency_trends&id=eq.federal-register&limit=1",
  );
  const yearly = obj(r.rows[0]?.yearly);
  if (!yearly) return null;
  return buildFederalRegister({
    rules: parseTypeYears(yearly["RULE"]),
    proposed: parseTypeYears(yearly["PRORULE"]),
    asOf: isoDate(r.rows[0]?.asOf),
  });
});

const readBills = memoAsync(LONG_TTL_MS, async () => {
  const summary = await datasetSummary("congress_bills", {
    perCongressType: "->per_congress_type",
    retrieved: "->>retrieved",
  });
  const introduced = introducedByCongress(summary.perCongressType);
  const retrieved = isoDate(summary.retrieved);
  if (!introduced.size || !retrieved) return null;
  const congresses = [...introduced.keys()].sort((a, b) => a - b);
  const counts = await mapLimit(congresses, 6, (congress) =>
    countRows(
      `corpus_records?dataset=eq.congress_bills&filters=cs.${encodeURIComponent(
        JSON.stringify({ congress: [String(congress)], status: ["became_law"] }),
      )}`,
    ),
  );
  const becameLaw = new Map(congresses.map((c, i) => [c, counts[i]!] as const));
  return buildBills({ congresses: billsFromParts(introduced, becameLaw), retrieved });
});

// ------------------------------------------------------------------------------------------------ dispatch

const READERS: Record<string, () => Promise<TrendBlockData | null>> = {
  "federal-civil": readFederalCivil,
  "federal-criminal": readFederalCriminal,
  "mdl-pending": readMdlPending,
  "securities-class-actions": readSecurities,
  "doj-press": readDojPress,
  "sec-releases": readSecReleases,
  "ftc-actions": readFtcActions,
  "epa-cases": readEpaCases,
  "osha-inspections": readOshaInspections,
  "cpsc-recalls": readCpscRecalls,
  "nhtsa-recalls": readNhtsaRecalls,
  "fsis-recalls": readFsisRecalls,
  "fda-recalls": readFdaRecalls,
  faers: readFaersBlock,
  caers: readCaersBlock,
  "cfpb-complaints": readCfpbComplaints,
  "ftc-sentinel": readSentinel,
  "federal-register": readFederalRegister,
  "congress-bills": readBills,
  "judicial-vacancies": readVacancies,
  "judicial-nominations": readNominations,
};

export const READER_IDS = Object.keys(READERS);

/** Read one block. Returns null when the dataset holds nothing usable; throws when the read fails. */
export async function readBlock(id: string): Promise<TrendBlockData | null> {
  const reader = READERS[id];
  if (!reader) throw new Error("Unknown analytics block.");
  return reader();
}
