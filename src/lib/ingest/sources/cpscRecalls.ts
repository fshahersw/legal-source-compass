/**
 * CPSC Recall REST API → agency_safety_cpsc_recalls_api (upsert, oldest first).
 *
 * Port of scripts/enrichment/enforcement/build_cpsc.py (shape() and the record loop of main()); tested equal to the
 * Python builder run on the same API records (fixtures/golden/cpsc-rows.json).
 *   - reads every recall whose LastPublishDate falls in [last stored publish date - 3 days, today] (new recalls and
 *     republished ones; CPSC republishes old recalls when it edits them), one request per run;
 *   - the manufacturer-country rule depends on every recall in the dataset (a value is "standalone" when it is recorded
 *     on its own somewhere); the set comes from the stored rows plus the new records, exactly as a full build would see it.
 *     If the new records change how an existing value is normalised, the run reports it (full rebuild advised);
 *   - the retrieval date inside the "Source" fact is capture provenance: it is masked when comparing, so a republish that
 *     changes nothing else is still an update only because LastPublishDate (item.recall.last_publish) changed;
 *   - new recalls are appended (the builder sorts by recall date, then number); one dated before the newest stored recall
 *     is counted in notes.appended_out_of_order (a full rebuild would place it earlier).
 *   The aggregates dataset (regulatory_cpsc_aggregates) is not touched: it is rebuilt by the full builder.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { cleanText, cmpTuple, pySlice } from "../py.ts";
import { corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";
import {
  HAZARD_LABELS,
  deathForeignOnly,
  deathMentionClass,
  hazardCategories,
  mentionsInjury,
  mentionsStandardViolation,
  normalizeCountry,
  parseUnits,
  recallUnits,
  reportsNone,
} from "./cpscParsing.ts";

export const DATASET = "agency_safety_cpsc_recalls_api";
export const API_ONE = (n: string) =>
  `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber=${n}`;
const API_WINDOW = (from: string, to: string) =>
  `https://www.saferproducts.gov/RestWebServices/Recall?format=json&LastPublishDateStart=${from}&LastPublishDateEnd=${to}`;
const RECHECK_DAYS = 3;
const MAX_WINDOW_DAYS = 120;

type Raw = Record<string, unknown>;
type Entry = Record<string, unknown>;

/** build_cpsc.names: cleaned, non-empty, first occurrence kept. */
export function names(entries: unknown, key = "Name"): string[] {
  const out: string[] = [];
  for (const e of (Array.isArray(entries) ? entries : []) as Entry[]) {
    const name = cleanText(e?.[key]);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const orNull = (s: string): string | null => (s ? s : null);

/** build_cpsc.shape(raw, standalone) */
export function shape(raw: Raw, standalone: Set<string>): JsonObject {
  const hazards = names(raw["Hazards"]);
  const injuries = names(raw["Injuries"]).join(" ");
  const title = cleanText(raw["Title"]);
  const hazardText = [...hazards, title].join(" ");
  const products = (Array.isArray(raw["Products"]) ? raw["Products"] : []) as Entry[];
  const date = String(raw["RecallDate"] ?? "").slice(0, 10) || null;
  const deathClass = deathMentionClass(injuries);
  const countriesRaw = names(raw["ManufacturerCountries"], "Country");
  const images = (Array.isArray(raw["Images"]) ? raw["Images"] : []) as Entry[];
  return {
    recall_id: (raw["RecallID"] ?? null) as Json,
    recall_number: cleanText(raw["RecallNumber"]),
    date,
    year: date ? Number(date.slice(0, 4)) : null,
    last_publish: String(raw["LastPublishDate"] ?? "").slice(0, 10) || null,
    title,
    url: orNull(cleanText(raw["URL"])),
    description: orNull(pySlice(cleanText(raw["Description"]), 1500)),
    products: products.slice(0, 12).map((p) => ({
      name: orNull(cleanText(p["Name"])),
      model: orNull(pySlice(cleanText(p["Model"]), 200)),
      type: orNull(cleanText(p["Type"])),
      units_text: orNull(cleanText(p["NumberOfUnits"])),
      units: parseUnits(p["NumberOfUnits"]),
    })),
    product_count: products.length,
    units: recallUnits(products),
    hazards: hazards.map((h) => pySlice(h, 1200)),
    hazard_categories: hazardCategories(hazardText),
    standard_violation: mentionsStandardViolation(hazardText),
    injuries: orNull(pySlice(injuries, 1500)),
    death_class: deathClass,
    mentions_death: deathClass === "product",
    death_background: deathClass === "background",
    death_foreign_only: deathClass === "product" && deathForeignOnly(injuries),
    mentions_injury: mentionsInjury(injuries),
    none_reported: reportsNone(injuries),
    remedies: names(raw["Remedies"])
      .map((r) => pySlice(r, 800))
      .slice(0, 4),
    remedy_options: names(raw["RemedyOptions"], "Option"),
    manufacturers: names(raw["Manufacturers"]),
    importers: names(raw["Importers"]),
    distributors: names(raw["Distributors"]),
    retailers: names(raw["Retailers"])
      .map((r) => pySlice(r, 300))
      .slice(0, 8),
    countries_raw: countriesRaw,
    countries: [...new Set(countriesRaw.flatMap((v) => normalizeCountry(v, standalone)))],
    upc_count: Array.isArray(raw["ProductUPCs"]) ? raw["ProductUPCs"].length : 0,
    image: images.map((i) => cleanText(i["URL"])).find(Boolean) ?? null,
    consumer_contact: orNull(pySlice(cleanText(raw["ConsumerContact"]), 400)),
  };
}

/** The standalone country values of a set of raw records (build_cpsc.main). */
export function standaloneOf(values: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const v of values) if (v && !v.includes("(")) out.add(v);
  return out;
}

/** The record build_cpsc.main writes for one shaped recall. */
export function recallRow(r: JsonObject, retrieved: string): CorpusRow {
  const s = r as Record<string, never>;
  const number = String(s["recall_number"]);
  const cats = s["hazard_categories"] as unknown as string[];
  const labels = cats.map((k) => HAZARD_LABELS[k]!);
  const page = (s["url"] as unknown as string | null) || API_ONE(number);
  const api = API_ONE(number);
  const manufacturers = s["manufacturers"] as unknown as string[];
  const importers = s["importers"] as unknown as string[];
  const distributors = s["distributors"] as unknown as string[];
  const firms = manufacturers.length ? manufacturers : importers.length ? importers : distributors;
  const countries = s["countries"] as unknown as string[];
  const products = s["products"] as unknown as { name: string | null; units_text: string | null }[];
  const date = s["date"] as unknown as string | null;
  const mentionsDeath = s["mentions_death"] as unknown as boolean;
  const background = s["death_background"] as unknown as boolean;
  const foreign = s["death_foreign_only"] as unknown as boolean;
  const hazards = s["hazards"] as unknown as string[];
  const year = s["year"] as unknown as number | null;
  const facts: [string, string][] = [
    ["Recall number", number],
    ["Recall date", date || "Not recorded"],
    ["Hazard", pySlice(hazards.join(" "), 600) || "Not recorded"],
    ["Hazard categories (keyword rule)", labels.join(", ")],
    ["Injuries (as stated)", (s["injuries"] as unknown as string | null) || "Not recorded"],
    [
      "Units (as stated)",
      products
        .map((p) => p.units_text)
        .filter(Boolean)
        .join("; ") || "Not recorded",
    ],
    ["Manufacturers", manufacturers.join("; ") || "Not recorded"],
    ["Importers", importers.join("; ") || "Not recorded"],
    ["Distributors", distributors.join("; ") || "Not recorded"],
    ["Manufactured in", countries.join(", ") || "Not recorded"],
    ["Remedy", (s["remedy_options"] as unknown as string[]).join(", ") || "Not recorded"],
    ["Source", `CPSC Recall REST API, retrieved ${retrieved}`],
  ];
  return corpusRecord(
    DATASET,
    `cpsc-api:${number}`,
    (s["title"] as unknown as string) || `CPSC recall ${number}`,
    {
      source_url: page,
      subtitle: `Recall ${number} · ${date || "date not recorded"} · ${labels.slice(0, 2).join(", ")}`,
      cells: {
        recall_number: number,
        date,
        hazard: labels.join(", "),
        firm: firms.slice(0, 2).join("; ") || null,
        country: countries.join(", ") || null,
        units: s["units"] as unknown as number | null,
        death_mention: mentionsDeath
          ? "Product-related" + (foreign ? " (outside U.S. only)" : "")
          : background
            ? "Background / other product"
            : "No",
      },
      facts,
      text: [
        number,
        s["title"] as unknown as string,
        (s["description"] as unknown as string | null) || "",
        hazards.join(" "),
        [...manufacturers, ...importers, ...distributors].join(" "),
        products.map((p) => p.name || "").join(" "),
        countries.join(" "),
      ].join(" "),
      filters: {
        year: [year ? String(year) : "none"],
        hazard: cats,
        country: countries.length ? countries : ["none"],
        death_mention: [mentionsDeath ? "product" : background ? "background" : "no"],
      },
      badges: [
        ...labels.slice(0, 3),
        ...(mentionsDeath
          ? ["Death mentioned" + (foreign ? " (outside U.S.)" : "")]
          : background
            ? ["Background death statistic"]
            : []),
      ],
      links: [
        { label: "CPSC recall notice", url: page },
        { label: "CPSC Recall API record", url: api },
      ],
      extra: { recall: r, dates: { date } },
    },
  );
}

/** Change detection: the retrieval date inside the "Source" fact is capture provenance and is masked. */
export function comparableCpsc(content: RowContent): Json {
  const detail = content.detail;
  const facts = (Array.isArray(detail["facts"]) ? detail["facts"] : []).map((f) =>
    Array.isArray(f) && f[0] === "Source"
      ? ["Source", String(f[1]).replace(/retrieved \d{4}-\d{2}-\d{2}$/, "retrieved <date>")]
      : f,
  );
  return { ...(content as unknown as JsonObject), detail: { ...detail, facts } };
}

/** Sort key of build_cpsc.main: (date or "", recall_number). */
const sortKey = (r: JsonObject) => [String(r["date"] ?? ""), String(r["recall_number"])] as const;

const addDays = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/** Distinct countries_raw over the stored rows: the ingest RPC when installed, else paged reads (dry runs). */
async function storedCountryValues(ctx: CollectContext): Promise<string[]> {
  try {
    return await ctx.corpus.rpc<string[]>("ingest_distinct_text_v1", {
      p_dataset: DATASET,
      p_path: ["recall", "countries_raw"],
    });
  } catch (error) {
    if (!(error instanceof Error && /HTTP 404|PGRST202/.test(error.message))) throw error;
  }
  const out = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const rows = await ctx.corpus.query(
      `corpus_records?select=c:item->recall->countries_raw&dataset=eq.${DATASET}&order=id.asc&limit=1000&offset=${offset}`,
    );
    for (const r of rows) for (const v of (r["c"] as string[] | null) ?? []) out.add(v);
    if (rows.length < 1000) break;
  }
  return [...out];
}

export const cpscRecalls: SourceAdapter = {
  source: "cpsc_recalls",
  dataset: DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-cpsc-recalls",
  limits: { maxRequests: 6, minIntervalMs: 2000 },
  secrets: [],

  async collect(ctx): Promise<Collected> {
    const newest = async (field: "last_publish" | "date") => {
      const rows = await ctx.corpus.query(
        `corpus_records?select=v:item->recall->>${field}&dataset=eq.${DATASET}&order=item->recall->>${field}.desc.nullslast&limit=1`,
      );
      return String(rows[0]?.["v"] ?? "");
    };
    const newestPublish = await newest("last_publish");
    const newestDate = await newest("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newestPublish))
      throw new Error("no stored LastPublishDate to continue from");
    const cursor = (ctx.cursor ?? {}) as JsonObject;
    const today = ctx.now.toISOString().slice(0, 10);
    const cursorThrough =
      typeof cursor["publish_through"] === "string" ? String(cursor["publish_through"]) : "";
    const base = cursorThrough > newestPublish ? cursorThrough : newestPublish;
    const from = addDays(base, -RECHECK_DAYS);
    let to = today;
    let complete = true;
    if (Date.parse(to) - Date.parse(from) > MAX_WINDOW_DAYS * 86400000) {
      to = addDays(from, MAX_WINDOW_DAYS);
      complete = false;
    }
    let raws: Raw[];
    try {
      const res = await ctx.http.getText(API_WINDOW(from, to));
      if (res.status !== 200) throw new Error(`CPSC Recall API HTTP ${res.status}`);
      const parsed = JSON.parse(res.text) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Unexpected CPSC Recall API result shape");
      raws = parsed as Raw[];
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        return {
          rows: [],
          fetched: 0,
          held: [],
          cursorAfter: ctx.cursor,
          complete: false,
          notes: { window: { from, to }, stopped: error.message },
        };
      }
      throw error;
    }
    const numbers = raws.map((r) => cleanText(r["RecallNumber"]));
    if (
      new Set(numbers).size !== numbers.length ||
      numbers.some((n) => !/^[A-Za-z0-9-]{1,20}$/.test(n))
    ) {
      throw new Error("CPSC Recall API returned duplicate or malformed recall numbers");
    }
    const storedValues = await storedCountryValues(ctx);
    const before = standaloneOf(storedValues);
    const newValues = raws.flatMap((r) =>
      (Array.isArray(r["ManufacturerCountries"])
        ? (r["ManufacturerCountries"] as Entry[])
        : []
      ).map((c) => cleanText(c["Country"])),
    );
    const standalone = standaloneOf([...storedValues, ...newValues]);
    const shifted = storedValues.filter(
      (v) =>
        JSON.stringify(normalizeCountry(v, before)) !==
        JSON.stringify(normalizeCountry(v, standalone)),
    );
    const recalls = raws
      .map((r) => shape(r, standalone))
      .sort((a, b) => cmpTuple(sortKey(a), sortKey(b)));
    const latestPublish =
      recalls
        .map((r) => String(r["last_publish"] ?? ""))
        .sort()
        .at(-1) ?? "";
    return {
      rows: recalls.map((r) => recallRow(r, today)),
      fetched: raws.length,
      held: [],
      cursorAfter: {
        publish_through: to,
        newest_last_publish: latestPublish > newestPublish ? latestPublish : newestPublish,
      },
      complete,
      notes: {
        window: { from, to },
        ...(shifted.length
          ? {
              full_rebuild_advised: { country_values_normalised_differently: shifted.slice(0, 20) },
            }
          : {}),
        appended_out_of_order_candidates: recalls.filter(
          (r) => String(r["date"] ?? "") < newestDate,
        ).length,
      },
    };
  },

  comparable: comparableCpsc,
};
