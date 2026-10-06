import { stateByUsps } from "@/lib/corpus/geo";

/**
 * How a full state code becomes browsable without another app change.
 *
 * 1. Snapshot bundle. A hash-verified manifest entry
 *    `state-codes/<usps lowercase>/browse-v1/codes.json`.
 *    Texas keeps schema `texas-code-browse-release/1`. Every other state uses
 *    `state-code-browse-release/1` with the same codes → chapters → section shards
 *    layout, text files at `state-codes/<usps>/text/<sha256>.txt` (or `text_root`
 *    on the root file), and section ids `${code}:${chapter}:${anchor}:${occurrence}`.
 *    Optional root fields: `edition`, `currency`, `text_root`.
 *    Optional section fields: `history`, `source_note`.
 *
 * 2. Published dataset. `corpus_datasets.ready = true` and `metadata.full_code`:
 *    `{ state, code_name?, edition?, currency?, source_url?, grain?: "section",
 *       title_filter?: "title", chapter_field?: "chapter" }`.
 *    Section rows put the official citation and heading in `title` (that is what
 *    search matches), the title-filter value on `filters`, the chapter label on
 *    `item.cells[chapter_field]`, citation / history / edition / currency in
 *    `detail.facts`, and the published body in `detail.sections[].text`.
 *
 * A ready dataset that already has a listing column `section`, is not described
 * as structure-only, and whose label exactly matches one `state_codes` title
 * (Indiana today) is recognized until it grows a `full_code` block. A capture
 * that says it has no section text (South Dakota today) is not a full code.
 */

export const BROWSE_SCHEMAS = [
  "texas-code-browse-release/1",
  "state-code-browse-release/1",
] as const;
export type BrowseSchema = (typeof BROWSE_SCHEMAS)[number];

const CODE_ID = /^[A-Z0-9][A-Z0-9_-]{0,32}$/;
const FIELD = /^[a-z0-9_]{1,40}$/;
const STRUCTURE_ONLY =
  /title-level only|full section text is not present|structural index|not the statute language/i;

export type BrowseSummary = {
  schema: BrowseSchema;
  sectionCount: number;
  codeCount: number;
  edition: string | null;
  currency: string | null;
  note: string | null;
  textRoot: string | null;
};

export type ListingShape = {
  columns: { key: string; label: string }[];
  filters: {
    name: string;
    type: string;
    label?: string;
    options?: { value: string; label: string; count?: number }[];
  }[];
  qualification: string | null;
  total: number | null;
};

export type FullCodeMeta = {
  state: string;
  codeName: string | null;
  edition: string | null;
  currency: string | null;
  sourceUrl: string | null;
  grain: "section" | "structure" | null;
  titleFilter: string;
  chapterField: string;
};

export type CodeIndexRow = {
  title: string | null;
  state: string | null;
  edition: string | null;
  currency: string | null;
};

export type DatasetCandidate = {
  id: string;
  label: string | null;
  ready: boolean | null;
  importedRecords: number | null;
  fullCode: unknown;
  listing: unknown;
  qualification: unknown;
};

export type ClassifiedDataset = {
  state: string;
  codeName: string;
  sectionCount: number | null;
  edition: string | null;
  currency: string | null;
  sourceUrl: string | null;
  note: string | null;
  datasetId: string;
  titleFilter: string;
  chapterField: string;
};

export type SectionFields = {
  citation: string | null;
  heading: string | null;
  text: string | null;
  history: string | null;
  edition: string | null;
  currency: string | null;
  sourceUrl: string | null;
  status: string | null;
};

export function isUsps(value: string): boolean {
  return stateByUsps.has(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function publishedUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function parseListing(value: unknown): ListingShape {
  const parsed = jsonValue(value);
  const obj = asObject(parsed) ?? {};
  const columns = Array.isArray(obj["columns"])
    ? obj["columns"]
        .map((column) => {
          const row = asObject(column);
          const key = row ? asString(row["key"]) : null;
          if (!row || !key) return null;
          return { key, label: asString(row["label"]) ?? key };
        })
        .filter((column): column is { key: string; label: string } => !!column)
    : [];
  const filters = Array.isArray(obj["filters"])
    ? obj["filters"].flatMap((filter) => {
        const row = asObject(filter);
        const name = row ? asString(row["name"]) : null;
        const type = row ? asString(row["type"]) : null;
        if (!row || !name || !type) return [];
        const options = Array.isArray(row["options"])
          ? row["options"].flatMap((option) => {
              const item = asObject(option);
              const valueText = item
                ? (asString(item["value"]) ??
                  (typeof item?.["value"] === "number" ? String(item["value"]) : null))
                : null;
              if (!item || !valueText) return [];
              const count =
                typeof item["count"] === "number" && Number.isSafeInteger(item["count"])
                  ? item["count"]
                  : undefined;
              return [
                {
                  value: valueText,
                  label: asString(item["label"]) ?? valueText,
                  ...(count !== undefined ? { count } : {}),
                },
              ];
            })
          : undefined;
        return [
          {
            name,
            type,
            ...(asString(row["label"]) ? { label: asString(row["label"])! } : {}),
            ...(options ? { options } : {}),
          },
        ];
      })
    : [];
  const total =
    typeof obj["total"] === "number" && Number.isSafeInteger(obj["total"]) ? obj["total"] : null;
  return { columns, filters, qualification: asString(obj["qualification"]), total };
}

export function parseFullCode(value: unknown): FullCodeMeta | null {
  const row = asObject(jsonValue(value));
  const state = row ? asString(row["state"])?.toUpperCase() : null;
  if (!row || !state || !isUsps(state)) return null;
  const grainRaw = asString(row["grain"]);
  const grain = grainRaw === "section" || grainRaw === "structure" ? grainRaw : null;
  const titleFilter = asString(row["title_filter"]);
  const chapterField = asString(row["chapter_field"]);
  return {
    state,
    codeName: asString(row["code_name"]),
    edition: asString(row["edition"]),
    currency: asString(row["currency"]),
    sourceUrl: publishedUrl(row["source_url"]),
    grain,
    titleFilter: titleFilter && FIELD.test(titleFilter) ? titleFilter : "title",
    chapterField: chapterField && FIELD.test(chapterField) ? chapterField : "chapter",
  };
}

export function isStructureOnly(text: string | null | undefined): boolean {
  return !!text && STRUCTURE_ONLY.test(text);
}

function blankToNull(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

/** One full-code dataset, or null when this ready dataset is not section-level code. */
export function classifyDataset(
  row: DatasetCandidate,
  index: CodeIndexRow[],
  fallbackState: Record<string, string> = {},
): ClassifiedDataset | null {
  if (row.ready !== true) return null;
  const full = parseFullCode(row.fullCode);
  const listing = parseListing(row.listing);
  const qualification = listing.qualification ?? asString(row.qualification);
  if (full?.grain === "structure") return null;
  if (isStructureOnly(qualification) && full?.grain !== "section") return null;
  if (!full && !listing.columns.some((column) => column.key === "section")) return null;
  const fromLabel = stateFromLabel(row.label, index);
  const fromFallback = fallbackState[row.id];
  const state =
    full?.state ?? fromLabel ?? (fromFallback && isUsps(fromFallback) ? fromFallback : null);
  if (!state) return null;
  const indexed = index.filter((item) => item.state === state);
  const only = indexed.length === 1 ? indexed[0] : null;
  return {
    state,
    codeName: full?.codeName ?? blankToNull(row.label) ?? row.id,
    sectionCount: typeof row.importedRecords === "number" ? row.importedRecords : listing.total,
    edition: full?.edition ?? only?.edition ?? null,
    currency: full?.currency ?? only?.currency ?? null,
    sourceUrl: full?.sourceUrl ?? null,
    note: qualification,
    datasetId: row.id,
    titleFilter: full?.titleFilter ?? "title",
    chapterField: full?.chapterField ?? "chapter",
  };
}

function stateFromLabel(label: string | null, index: CodeIndexRow[]): string | null {
  const text = blankToNull(label);
  if (!text) return null;
  const rows = index.filter(
    (row) => row.title?.trim() === text && !!row.state && isUsps(row.state),
  );
  return rows.length === 1 ? rows[0]!.state : null;
}

export function summarizeBrowseRoot(data: unknown, state: string): BrowseSummary | null {
  const row = asObject(data);
  if (!row || !isUsps(state)) return null;
  const schema = row["schema_version"];
  if (schema !== "texas-code-browse-release/1" && schema !== "state-code-browse-release/1")
    return null;
  if (schema === "texas-code-browse-release/1" && (state !== "TX" || row["jurisdiction"] !== "TX"))
    return null;
  if (schema === "state-code-browse-release/1" && row["jurisdiction"] !== state) return null;
  if (!Array.isArray(row["codes"])) return null;
  let sectionCount = 0;
  const seen = new Set<string>();
  for (const code of row["codes"]) {
    const item = asObject(code);
    const id = item ? asString(item["code"]) : null;
    if (!item || !id || !CODE_ID.test(id) || seen.has(id)) return null;
    if (!Number.isSafeInteger(item["section_count"]) || (item["section_count"] as number) < 0)
      return null;
    if (!Number.isSafeInteger(item["chapter_count"]) || (item["chapter_count"] as number) < 0)
      return null;
    seen.add(id);
    sectionCount += item["section_count"] as number;
  }
  const st = state.toLowerCase();
  const textRoot = asString(row["text_root"]);
  if (textRoot && !new RegExp(`^state-codes/${st}/[a-z0-9_-]+/$`).test(textRoot)) return null;
  const claim = asString(row["publisher_coverage_claim"]);
  return {
    schema,
    sectionCount,
    codeCount: row["codes"].length,
    edition: asString(row["edition"]) ?? claim,
    currency: asString(row["currency"]),
    note: claim,
    textRoot,
  };
}

export function snapshotReleasePaths(state: string): { root: string; textRoot: string } {
  if (!isUsps(state)) throw new Error("Invalid state code.");
  const st = state.toLowerCase();
  return { root: `state-codes/${st}/browse-v1/`, textRoot: `state-codes/${st}/text/` };
}

export function matchesCitationOrHeading(
  q: string,
  citation: string | null,
  heading: string | null,
): boolean {
  const needle = q.trim().toLowerCase().replace(/\s+/g, " ");
  if (needle.length < 2) return false;
  const hay = [citation, heading]
    .filter((part): part is string => !!part && !!part.trim())
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ");
  return hay.includes(needle);
}

function factPairs(facts: unknown): [string, string][] {
  if (!Array.isArray(facts)) return [];
  const pairs: [string, string][] = [];
  for (const fact of facts) {
    if (!Array.isArray(fact) || fact.length < 2 || typeof fact[0] !== "string") continue;
    if (typeof fact[1] !== "string" || !fact[1].trim()) continue;
    pairs.push([fact[0].trim(), fact[1].trim()]);
  }
  return pairs;
}

function factEquals(pairs: [string, string][], label: string): string | null {
  const want = label.toLowerCase();
  return pairs.find((pair) => pair[0].toLowerCase() === want)?.[1] ?? null;
}

function publishedSectionText(sections: unknown): string | null {
  if (!Array.isArray(sections)) return null;
  const rows = sections.flatMap((section) => {
    const row = asObject(section);
    if (!row || typeof row["text"] !== "string" || !row["text"].trim()) return [];
    return [{ heading: asString(row["heading"]) ?? "", text: row["text"] }];
  });
  const preferred = rows.find((row) => /^section text\b/i.test(row.heading));
  return (preferred ?? rows[0])?.text ?? null;
}

function headingFromTitle(title: string | null, citation: string | null): string | null {
  if (!title) return null;
  if (citation && (title === citation || title.startsWith(`${citation} `))) {
    const rest = title.slice(citation.length).trim();
    return rest || null;
  }
  return title;
}

function firstLink(detail: Record<string, unknown> | null): string | null {
  if (!detail || !Array.isArray(detail["links"])) return null;
  for (const link of detail["links"]) {
    const row = asObject(link);
    const url = row ? publishedUrl(row["url"]) : null;
    if (url) return url;
  }
  return null;
}

/** Fields the section page shows. Null means the source did not record that field. */
export function sectionFieldsFromRecord(row: {
  title?: string | null;
  source_url?: string | null;
  detail?: unknown;
  item?: { cells?: Record<string, unknown> } | null;
}): SectionFields {
  const detail = asObject(row.detail);
  const pairs = factPairs(detail?.["facts"]);
  const citation = factEquals(pairs, "Citation") ?? (detail ? asString(detail["citation"]) : null);
  const title = asString(row.title);
  const heading =
    factEquals(pairs, "Heading") ??
    (detail ? asString(detail["heading"]) : null) ??
    headingFromTitle(title, citation);
  const historyFact = pairs.find((pair) => /history/i.test(pair[0]));
  const sourceNote = pairs.find((pair) => /source note/i.test(pair[0]));
  let history =
    historyFact?.[1] ?? sourceNote?.[1] ?? (detail ? asString(detail["history"]) : null);
  if (historyFact && sourceNote && historyFact[1] !== sourceNote[1])
    history = `${historyFact[1]}\n${sourceNote[1]}`;
  const cells = row.item?.cells;
  const currency = detail ? asObject(detail["currency"]) : null;
  const through = currency ? asString(currency["through_date"]) : null;
  const statement = currency ? asString(currency["statement"]) : null;
  const currencyText = [statement, through].filter((part): part is string => !!part).join(" · ");
  const status =
    factEquals(pairs, "Status as printed") ??
    (detail ? asString(detail["status_note"]) : null) ??
    (cells ? asString(cells["status"]) : null);
  return {
    citation,
    heading,
    text:
      (detail ? publishedSectionText(detail["sections"]) : null) ??
      (detail ? asString(detail["text"]) : null),
    history,
    edition:
      factEquals(pairs, "Edition") ??
      (currency ? asString(currency["edition"]) : null) ??
      (detail ? asString(detail["edition"]) : null),
    currency:
      factEquals(pairs, "Currency") ??
      (detail && typeof detail["currency"] === "string" ? asString(detail["currency"]) : null) ??
      (currencyText || null),
    sourceUrl:
      publishedUrl(row.source_url) ??
      (detail ? publishedUrl(detail["source_url"]) : null) ??
      firstLink(detail),
    status,
  };
}

export function showRecorded(value: string | null | undefined): string {
  return value && value.trim() ? value : "Not recorded";
}

/** Edition labels copied from the intake currency summary. Several labels stay several labels. */
export function projectedEdition(currency: unknown): string | null {
  const row = asObject(currency);
  if (!row || !Array.isArray(row["editions"])) return null;
  const editions = row["editions"].filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return editions.length ? editions.join("; ") : null;
}

/** Publisher through-dates from the intake currency summary. A range stays a range. */
export function projectedCurrency(currency: unknown): string | null {
  const row = asObject(currency);
  if (!row) return null;
  const min = asString(row["through_min"]);
  const max = asString(row["through_max"]);
  if (min && max && min !== max) return `${min} to ${max}`;
  return max ?? min;
}

/**
 * Coverage-panel status from one corpus_publisher_code_coverage_v2 state row.
 * No row means the intake has not captured that state. A row with the projection
 * flag off is private even when sections have landed.
 */
export function coverageStatus(
  row: { public_projection_allowed?: boolean } | null | undefined,
): CodeCoverageStatus {
  if (!row) return "not yet captured";
  return row.public_projection_allowed === true ? "captured" : "landed-private";
}

export type StateCodeListing = {
  state: string;
  name: string;
  /** A reviewed public projection wins over a snapshot or an older dataset for the same state. */
  kind: "projection" | "snapshot" | "dataset";
  codeName: string;
  sectionCount: number | null;
  edition: string | null;
  currency: string | null;
  sourceUrl: string | null;
  note: string | null;
  datasetId: string | null;
  hasSnapshot: boolean;
  titleFilter: string | null;
  chapterField: string | null;
  /** Declared hierarchy levels for a projected code, ending in "section". */
  levels: string[] | null;
};

export type HierarchyStep = { level: string; number: string | null };

export type ProjectedOutline =
  | {
      available: false;
    }
  | {
      available: true;
      kind: "groups";
      level: string;
      total: number;
      truncated: boolean;
      groups: { number: string | null; heading: string | null; count: number }[];
    }
  | {
      available: true;
      kind: "sections";
      level: "section";
      total: number;
      truncated: boolean;
      sections: {
        native_id: string;
        citation: string | null;
        heading: string | null;
        status_note: string | null;
      }[];
    };

export type CodeCoverageStatus = "captured" | "landed-private" | "not yet captured";

export type StateCodeHit = {
  state: string;
  kind: "projection" | "snapshot" | "dataset";
  id: string;
  citation: string | null;
  heading: string;
  code: string | null;
  chapterId: string | null;
  titleValue: string | null;
  chapterLabel: string | null;
  datasetId: string | null;
};
