/**
 * Readers for the depth pages (Enforcement trends and Safety trends). Same contract as overview.server.ts: a reader
 * returns null when its dataset holds nothing usable and throws when a read fails; results are cached. Server-only.
 */
import { restGet } from "@/lib/external/rest.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { readCpsc, readFaers } from "@/lib/insights/readers/safety";
import {
  buildCpscDeaths,
  buildCpscHazards,
  buildDojAmounts,
  buildDojDivisions,
  buildEpaPenalties,
  buildFaersOutcomes,
  buildFdaClassI,
  buildOshaPenalties,
  buildSaferProducts,
  buildSecAmounts,
  type DojDivisionYear,
  type FdaClassIYear,
} from "./blocks/depth";
import { findCoverageBreak } from "./blocks/enforcement";
import { isoDate } from "./parse";
import {
  divisionNames,
  dojAmountYears,
  parseEpaPenalties,
  parseSaferProductsYears,
  parseWindow,
  tallySecAmounts,
} from "./parseDepth";
import {
  FDA_DATASETS,
  LONG_TTL_MS,
  datasetSummary,
  fdaYearCount,
  readDojIndex,
  readEpaSeries,
  readFdaBounds,
  readOshaSeries,
  readSecRows,
  today,
  type FdaKey,
} from "./shared.server";
import { countRows, mapLimit } from "./tally.server";
import type { TrendBlockData } from "./trend";

const readDojDivisions = memoAsync(LONG_TTL_MS, async () => {
  const index = await readDojIndex();
  if (!index) return null;
  const { overview, latest } = index;
  const names = divisionNames(overview.components, 4);
  if (!names.length) return null;
  // Start at the year the dataset's coverage changes (the overview chart marks it), so every plotted year is comparable.
  const jump = findCoverageBreak(
    overview.byYear.map((y) => ({ year: Number(y.year), count: y.count })),
  );
  const partitions = overview.partitions.filter((p) => Number(p.year) >= (jump?.year ?? 0));
  const jobs = partitions.flatMap((p) => names.map((name) => ({ p, name })));
  const counts = await mapLimit(jobs, 6, ({ p, name }) =>
    countRows(
      `corpus_records?dataset=eq.${p.dataset}&filters=cs.${encodeURIComponent(
        JSON.stringify({ component: [name] }),
      )}`,
    ),
  );
  const years = new Map<number, DojDivisionYear>();
  jobs.forEach(({ p, name }, i) => {
    const year = Number(p.year);
    const entry = years.get(year) ?? { year, counts: {} };
    entry.counts[name] = counts[i]!;
    years.set(year, entry);
  });
  return buildDojDivisions({
    years: [...years.values()].sort((a, b) => a.year - b.year),
    names,
    latestDate: latest,
    today: today(),
  });
});

const readDojAmounts = memoAsync(LONG_TTL_MS, async () => {
  const index = await readDojIndex();
  if (!index) return null;
  return buildDojAmounts({
    years: dojAmountYears(index.overview.byYear),
    latestDate: index.latest,
    today: today(),
  });
});

const readSecAmounts = memoAsync(LONG_TTL_MS, async () => {
  const { rows, latest } = await readSecRows();
  return buildSecAmounts({ years: tallySecAmounts(rows), latestDate: latest, today: today() });
});

const readEpaPenalties = memoAsync(READ_TTL_MS, async () => {
  const series = await readEpaSeries();
  return buildEpaPenalties({
    years: parseEpaPenalties(series.cells),
    latestCompleteFy: series.latestCompleteFy,
    fileDate: series.fileDate,
  });
});

const readOshaPenalties = memoAsync(READ_TTL_MS, async () => {
  const { parsed, snapshot } = await readOshaSeries();
  if (!parsed) return null;
  return buildOshaPenalties({
    years: parsed.series.map((y) => ({ fy: y.fy, penalty: y.currentPenalty, partial: y.partial })),
    snapshot,
  });
});

const readFaersOutcomes = memoAsync(READ_TTL_MS, async () => {
  const faers = await readFaers();
  if (!faers) return null;
  return buildFaersOutcomes({
    years: faers.national.map((y) => ({
      year: y.year,
      partial: y.partial,
      serious: y.serious ?? null,
      deaths: y.deaths ?? null,
      lawyer: y.lawyer ?? null,
    })),
    dataThrough: isoDate(faers.dataThrough),
  });
});

const readSaferProducts = memoAsync(READ_TTL_MS, async () => {
  const [rows, summary] = await Promise.all([
    restGet<{ s: unknown }[]>(
      "corpus_records?select=s:item->safer&dataset=eq.saferproducts_reports_series&id=like.sp-pub-*&order=ordinal.asc&limit=100",
    ),
    datasetSummary("saferproducts_reports_series", { window: "->publication_window" }),
  ]);
  return buildSaferProducts({
    years: parseSaferProductsYears(rows.rows.map((r) => r.s)),
    window: parseWindow(summary.window),
  });
});

const cpscYears = async () => {
  const cpsc = await readCpsc();
  if (!cpsc) return null;
  return {
    asOf: isoDate(cpsc.asOf),
    labels: cpsc.hazardLabels,
    years: cpsc.years.map((y) => ({
      year: y.year,
      partial: y.partial,
      hazards: y.hazards,
      deathMentions: y.deathMentions,
    })),
  };
};

const readCpscHazards = memoAsync(READ_TTL_MS, async () => {
  const c = await cpscYears();
  return c ? buildCpscHazards({ years: c.years, labels: c.labels, asOf: c.asOf }) : null;
});

const readCpscDeaths = memoAsync(READ_TTL_MS, async () => {
  const c = await cpscYears();
  return c ? buildCpscDeaths({ years: c.years, asOf: c.asOf }) : null;
});

const readFdaClassI = memoAsync(LONG_TTL_MS, async () => {
  const bounds = await readFdaBounds();
  if (!bounds) return null;
  const jobs: { year: number; key: FdaKey; dataset: string }[] = [];
  for (let year = bounds.first; year <= bounds.last; year += 1)
    for (const d of FDA_DATASETS) jobs.push({ year, key: d.key, dataset: d.dataset });
  const counts = await mapLimit(jobs, 6, (j) => fdaYearCount(j.dataset, j.year, "class i"));
  const years = new Map<number, FdaClassIYear>();
  jobs.forEach((j, i) => {
    const entry = years.get(j.year) ?? { year: j.year, drug: 0, device: 0, food: 0 };
    entry[j.key] = counts[i]!;
    years.set(j.year, entry);
  });
  return buildFdaClassI({
    years: [...years.values()].sort((a, b) => a.year - b.year),
    latestDate: bounds.latest,
    today: today(),
  });
});

export const DEPTH_READERS: Record<string, () => Promise<TrendBlockData | null>> = {
  "doj-divisions": readDojDivisions,
  "doj-amounts": readDojAmounts,
  "sec-amounts": readSecAmounts,
  "epa-penalties": readEpaPenalties,
  "osha-penalties": readOshaPenalties,
  "faers-outcomes": readFaersOutcomes,
  "saferproducts-reports": readSaferProducts,
  "cpsc-hazards": readCpscHazards,
  "cpsc-deaths": readCpscDeaths,
  "fda-class-i": readFdaClassI,
};
