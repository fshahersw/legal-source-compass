/**
 * FTC HSR early termination notices (api.ftc.gov) → ftc_hsr_early_terminations (upsert, oldest first).
 *
 * Port of scripts/enrichment/ftc_data/hsr_parse.py (normalize_notice, composed_title, title_status, fiscal_year,
 * assign_ids, counts_by_year) and build_hsr.build_notices; tested equal to the Python builder on the same API pages
 * (fixtures/golden/hsr-rows.json).
 *   - reads the newest notices (sort: created desc, title, id — the builder's stable order), 50 a page, until a page is
 *     older than the last run's newest `created` minus two days, at most 4 pages; the api.data.gov key is sent in the
 *     X-Api-Key header only and never recorded;
 *   - row ids follow assign_ids: the transaction number, or <txn>-<n> when several notices share one. A new notice whose
 *     transaction number is already held under its plain id (a rebuild would renumber both) is held, as is one that would
 *     not sort after the held notices of its transaction; both are reported;
 *   - the unlisted "series-by-year" row is the count of notices by calendar and fiscal year: it is moved by exactly the
 *     notices written (insert +1, a changed date -1/+1), from the stored row.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { cleanText, cmpTuple, fmtThousands } from "../py.ts";
import { corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  SourceAdapter,
  StoredRow,
} from "../types.ts";

export const DATASET = "ftc_hsr_early_terminations";
export const API_DOCS =
  "https://www.ftc.gov/developer/api/v0/endpoints/hsr-early-termination-notices";
export const API_BASE = "https://api.ftc.gov/v0/hsr-early-termination-notices";
export const NOTICE_PAGE = "https://www.ftc.gov/legal-library/browse/early-termination-notices/";
const STABLE_SORT =
  "&sort[sort-created][path]=created&sort[sort-created][direction]=DESC" +
  "&sort[sort-title][path]=title&sort[sort-title][direction]=ASC" +
  "&sort[sort-id][path]=id&sort[sort-id][direction]=ASC";
const NOT_RECORDED = "Not recorded";
const TXN = /^\d{8}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGES = 4;
export const FORMULAS = {
  notices_by_calendar_year:
    "count of notices whose published `date` (the date early termination was granted) falls in the calendar year",
  notices_by_fiscal_year:
    "count of notices whose published `date` falls in the federal fiscal year (October of the previous calendar year to September); labelled by the year it ends",
};

export const apiUrl = (apiId: string) => `${API_BASE}?filter[id][value]=${apiId}`;
export const pageUrl = (offset: number, limit = 50) =>
  `${API_BASE}?page[offset]=${offset}&page[limit]=${limit}${STABLE_SORT}`;

export type Notice = {
  api_id: string | null;
  transaction_number: string | null;
  acquiring_party: string | null;
  acquired_party: string | null;
  acquired_entities: string[];
  date: string | null;
  title_published: string | null;
  created: string | null;
  updated: string | null;
};

/** hsr_parse.clean: published string, edge whitespace removed, runs collapsed; null for blank or absent. */
function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = cleanText(typeof v === "string" ? v : String(v));
  return s || null;
}

export function fiscalYear(date: string | null): number | null {
  if (!ISO_DATE.test(date ?? "")) return null;
  const year = Number(date!.slice(0, 4));
  const month = Number(date!.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return month >= 10 ? year + 1 : year;
}

export function normalizeNotice(rec: JsonObject): Notice | null {
  const a = (rec["attributes"] ?? {}) as JsonObject;
  let entities = a["acquired-entities"] as Json;
  if (typeof entities === "string") entities = [entities];
  const n: Notice = {
    api_id: (rec["id"] as string | undefined) ?? null,
    transaction_number: clean(a["transaction-number"]),
    acquiring_party: clean(a["acquiring-party"]),
    acquired_party: clean(a["acquired-party"]),
    acquired_entities: (Array.isArray(entities) ? entities : [])
      .map(clean)
      .filter((e): e is string => Boolean(e)),
    date: clean(a["date"]),
    title_published: clean(a["title"]),
    created: clean(a["created"]),
    updated: clean(a["updated"]),
  };
  if (!(n.transaction_number || n.acquiring_party || n.acquired_party || n.date)) return null;
  return n;
}

export function composedTitle(n: Notice): string | null {
  if (!(n.transaction_number && n.acquiring_party && n.acquired_party)) return null;
  return `${n.transaction_number}: ${n.acquiring_party}; ${n.acquired_party}`;
}

export function titleStatus(n: Notice): "matches" | "differs" | "unavailable" {
  const composed = composedTitle(n);
  if (composed === null || n.title_published === null) return "unavailable";
  return composed === n.title_published ? "matches" : "differs";
}

export function dateProblems(n: Notice): string[] {
  if (!n.date) return ["no date published"];
  if (fiscalYear(n.date) === null) return ["date is not YYYY-MM-DD"];
  return [];
}

const groupKey = (n: Notice) => [n.date ?? "", n.created ?? "", n.api_id ?? ""] as const;

/** hsr_parse.assign_ids over a complete set of notices. */
export function assignIds(notices: Notice[]): Map<string, string> {
  const groups = new Map<string | null, Notice[]>();
  for (const n of notices) {
    const g = groups.get(n.transaction_number) ?? [];
    g.push(n);
    groups.set(n.transaction_number, g);
  }
  const ids = new Map<string, string>();
  for (const [txn, group] of groups) {
    group.sort((a, b) => cmpTuple(groupKey(a), groupKey(b)));
    group.forEach((n, i) => {
      if (!txn) ids.set(n.api_id ?? "", "api-" + (n.api_id ?? "").slice(0, 8));
      else ids.set(n.api_id ?? "", group.length === 1 ? txn : `${txn}-${i + 1}`);
    });
  }
  return ids;
}

/** build_hsr.build_notices: the row of one notice. */
export function noticeRow(n: Notice, rid: string): CorpusRow {
  const status = titleStatus(n);
  const title =
    composedTitle(n) ??
    n.title_published ??
    `Transaction ${n.transaction_number ?? "not recorded"}`;
  const f = fiscalYear(n.date);
  const year = f ? n.date!.slice(0, 4) : null;
  const facts: [string, string | null][] = [
    ["Transaction number", n.transaction_number],
    ["Early termination granted", n.date],
    ["Acquiring party", n.acquiring_party],
    ["Acquired party", n.acquired_party],
    ["Acquired entities", n.acquired_entities.length ? n.acquired_entities.join("; ") : null],
    ["Federal fiscal year", f ? `FY${f} (derived from the date; October to September)` : null],
    [
      "Notice created / last updated",
      `${n.created ?? NOT_RECORDED} / ${n.updated ?? NOT_RECORDED}`,
    ],
  ];
  if (status === "differs") facts.push(["Title as published", n.title_published]);
  facts.push(["Source", `FTC HSR Early Termination Notices API, record ${n.api_id} (${API_DOCS})`]);
  const links =
    n.transaction_number && TXN.test(n.transaction_number)
      ? [{ url: NOTICE_PAGE + n.transaction_number, label: "Notice on ftc.gov" }]
      : [];
  return corpusRecord(DATASET, rid, title, {
    source_url: apiUrl(n.api_id ?? ""),
    subtitle: n.date
      ? `Early termination granted ${n.date}`
      : "Early termination notice (date not recorded)",
    cells: {
      transaction_number: n.transaction_number ?? NOT_RECORDED,
      date: n.date ?? NOT_RECORDED,
      acquiring_party: n.acquiring_party ?? NOT_RECORDED,
      acquired_party: n.acquired_party ?? NOT_RECORDED,
      fiscal_year: f ? `FY${f}` : NOT_RECORDED,
    },
    facts: facts.map(([label, value]) => [label, value === null ? NOT_RECORDED : value]),
    links,
    text: [n.acquiring_party ?? "", n.acquired_party ?? "", ...n.acquired_entities].join(" "),
    filters: { kind: ["notice"], year: year ? [year] : [], fiscal_year: f ? [`FY${f}`] : [] },
    extra: {
      kind: "notice",
      notice: {
        transaction_number: n.transaction_number,
        date: n.date,
        fiscal_year: f,
        acquiring_party: n.acquiring_party,
        acquired_party: n.acquired_party,
        acquired_entities: n.acquired_entities,
        api_id: n.api_id,
        title_published: n.title_published,
        title_status: status,
        created: n.created,
        updated: n.updated,
      },
    },
  });
}

export type Series = {
  calendar_year: Record<string, number>;
  fiscal_year: Record<string, number>;
  undated: number;
  notices: number;
};

/** counts_by_year as the series payload, with the usable date range. */
export function seriesOf(notices: Notice[]): {
  series: Series;
  first: string | null;
  last: string | null;
} {
  const cal: Record<string, number> = {};
  const fy: Record<string, number> = {};
  let undated = 0;
  const dates: string[] = [];
  for (const n of notices) {
    if (dateProblems(n).length) {
      undated++;
      continue;
    }
    cal[n.date!.slice(0, 4)] = (cal[n.date!.slice(0, 4)] ?? 0) + 1;
    const f = String(fiscalYear(n.date));
    fy[f] = (fy[f] ?? 0) + 1;
    dates.push(n.date!);
  }
  dates.sort();
  return {
    series: { calendar_year: cal, fiscal_year: fy, undated, notices: notices.length },
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
  };
}

const sortedNumericKeys = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).sort((a, b) => Number(a[0]) - Number(b[0])));

/** The unlisted series row (build_hsr.build_notices, last row). */
export function seriesRow(
  series: Series,
  firstDate: string | null,
  lastDate: string | null,
): CorpusRow {
  const s = {
    ...series,
    calendar_year: sortedNumericKeys(series.calendar_year),
    fiscal_year: sortedNumericKeys(series.fiscal_year),
  };
  // Python formats a missing date as "None"
  const first = firstDate ?? "None";
  const last = lastDate ?? "None";
  return corpusRecord(DATASET, "series-by-year", "Early termination notices granted, by year", {
    source_url: API_DOCS,
    subtitle: `Counts of the notices in this dataset by the date early termination was granted (${first} to ${last})`,
    cells: { period: `${first} to ${last}`, notices: fmtThousands(s.notices) },
    facts: [
      [
        "What is counted",
        "Notices the FTC API publishes, by the published date early termination was granted. Each notice names one transaction; one transaction can have more than one notice.",
      ],
      ["Period", `${first} to ${last}`],
      ["Notices", fmtThousands(s.notices)],
      ["Notices without a usable date", fmtThousands(s.undated)],
    ],
    text: "early termination notices by year HSR Hart-Scott-Rodino series",
    filters: { _listing: ["no"], kind: ["series"] },
    extra: { kind: "series", series: s, formulas: FORMULAS },
  });
}

/** build_hsr.build_notices for a complete set of API pages (merge by API id, the later copy kept): rows + series row. */
export function buildNotices(pages: { data?: JsonObject[] }[]): CorpusRow[] {
  const merged = new Map<string, JsonObject>();
  for (const doc of pages) for (const rec of doc.data ?? []) merged.set(String(rec["id"]), rec);
  const notices = [...merged.values()].map(normalizeNotice).filter((n): n is Notice => n !== null);
  const ids = assignIds(notices);
  const rows = notices
    .slice()
    .sort((a, b) =>
      cmpTuple([a.date ?? "", ids.get(a.api_id ?? "")!], [b.date ?? "", ids.get(b.api_id ?? "")!]),
    )
    .map((n) => noticeRow(n, ids.get(n.api_id ?? "")!));
  const { series, first, last } = seriesOf(notices);
  return [...rows, seriesRow(series, first, last)];
}

/** The notice a stored row was built from (item.notice). */
export function storedNotice(row: StoredRow): Notice | null {
  const n = row.item["notice"] as JsonObject | undefined;
  if (!n) return null;
  return {
    api_id: (n["api_id"] as string) ?? null,
    transaction_number: (n["transaction_number"] as string) ?? null,
    acquiring_party: (n["acquiring_party"] as string) ?? null,
    acquired_party: (n["acquired_party"] as string) ?? null,
    acquired_entities: (n["acquired_entities"] as string[]) ?? [],
    date: (n["date"] as string) ?? null,
    title_published: (n["title_published"] as string) ?? null,
    created: (n["created"] as string) ?? null,
    updated: (n["updated"] as string) ?? null,
  };
}

/** Move a stored series by the notices written (inserted: old null; updated: old and new). Pure. */
export function moveSeries(
  stored: { series: Series; first: string | null; last: string | null },
  changes: { before: Notice | null; after: Notice }[],
): { series: Series; first: string | null; last: string | null } | { held: string } {
  const s: Series = {
    calendar_year: { ...stored.series.calendar_year },
    fiscal_year: { ...stored.series.fiscal_year },
    undated: stored.series.undated,
    notices: stored.series.notices,
  };
  let first = stored.first;
  let last = stored.last;
  const bump = (n: Notice, by: number) => {
    if (dateProblems(n).length) {
      s.undated += by;
      return;
    }
    const y = n.date!.slice(0, 4);
    const f = String(fiscalYear(n.date));
    s.calendar_year[y] = (s.calendar_year[y] ?? 0) + by;
    s.fiscal_year[f] = (s.fiscal_year[f] ?? 0) + by;
    if (s.calendar_year[y] === 0) delete s.calendar_year[y];
    if (s.fiscal_year[f] === 0) delete s.fiscal_year[f];
  };
  for (const { before, after } of changes) {
    if (before && before.date === after.date) continue;
    if (before) {
      if (!dateProblems(before).length && (before.date === first || before.date === last)) {
        return {
          held: "an edited notice moved the first or last date of the series; a full rebuild recomputes it",
        };
      }
      bump(before, -1);
    } else s.notices += 1;
    bump(after, 1);
    if (!dateProblems(after).length) {
      if (first === null || after.date! < first) first = after.date;
      if (last === null || after.date! > last) last = after.date;
    }
  }
  return { series: s, first, last };
}

export const ftcHsr: SourceAdapter = {
  source: "ftc_hsr",
  dataset: DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-ftc-hsr",
  limits: { maxRequests: MAX_PAGES, minIntervalMs: 2000 },
  secrets: ["DATA_GOV_API_KEY"],

  async collect(ctx: CollectContext): Promise<Collected> {
    const key = ctx.env("DATA_GOV_API_KEY");
    if (!key) throw new Error("DATA_GOV_API_KEY is not set for this function");
    const cursor = (ctx.cursor ?? {}) as JsonObject;
    const newestRows = await ctx.corpus.query(
      `corpus_records?select=c:item->notice->>created&dataset=eq.${DATASET}&id=neq.series-by-year&order=item->notice->>created.desc.nullslast&limit=1`,
    );
    const storedNewest = String(newestRows[0]?.["c"] ?? "");
    const since =
      typeof cursor["created_through"] === "string" &&
      String(cursor["created_through"]) > storedNewest
        ? String(cursor["created_through"])
        : storedNewest;
    const stopBefore = since
      ? new Date(Date.parse(since) - 2 * 86400000).toISOString().slice(0, 19)
      : "";
    const records: JsonObject[] = [];
    let complete = true;
    let stopped: string | null = null;
    let metaCount: number | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const res = await ctx.http.getText(pageUrl(page * 50), { headers: { "X-Api-Key": key } });
        if (res.status !== 200) throw new Error(`FTC API HTTP ${res.status}`);
        const doc = JSON.parse(res.text) as {
          data?: JsonObject[];
          meta?: { count?: number | string };
        };
        if (!Array.isArray(doc.data)) throw new Error("Unexpected FTC API result shape");
        metaCount = doc.meta?.count === undefined ? metaCount : Number(doc.meta.count);
        records.push(...doc.data);
        const oldest =
          doc.data
            .map((r) => String(((r["attributes"] ?? {}) as JsonObject)["created"] ?? ""))
            .sort()[0] ?? "";
        if (doc.data.length < 50 || (stopBefore && oldest && oldest.slice(0, 19) < stopBefore))
          break;
        if (page === MAX_PAGES - 1) complete = false;
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          complete = false;
          stopped = error.message;
          break;
        }
        throw error;
      }
    }
    // the same notice can appear on two pages when notices are created during the read: keep the last copy (merge_pages)
    const byApiId = new Map<string, JsonObject>();
    for (const r of records) byApiId.set(String(r["id"]), r);
    const held: HeldRecord[] = [];
    const notices: Notice[] = [];
    for (const r of byApiId.values()) {
      const n = normalizeNotice(r);
      if (!n)
        held.push({
          key: String(r["id"]),
          reason: "empty record (no transaction number, parties or date): excluded by the builder",
        });
      else notices.push(n);
    }

    // stored rows of these notices (by api id) and of their transaction numbers
    const apiIds = notices.map((n) => n.api_id ?? "");
    const storedByApi = new Map<string, StoredRow>();
    for (let i = 0; i < apiIds.length; i += 40) {
      const chunk = apiIds.slice(i, i + 40);
      const rows = (await ctx.corpus.query(
        `corpus_records?select=id,ordinal,item&dataset=eq.${DATASET}&item->notice->>api_id=in.(${chunk.map((x) => `"${x}"`).join(",")})`,
      )) as unknown as StoredRow[];
      for (const row of rows)
        storedByApi.set(String((row.item["notice"] as JsonObject)["api_id"]), row);
    }
    const txns = [
      ...new Set(
        notices
          .filter((n) => !storedByApi.has(n.api_id ?? "") && n.transaction_number)
          .map((n) => n.transaction_number!),
      ),
    ];
    const storedByTxn = new Map<string, StoredRow[]>();
    for (const txn of txns) {
      const rows = (await ctx.corpus.query(
        `corpus_records?select=id,ordinal,item&dataset=eq.${DATASET}&or=(id.eq.${txn},id.like.${txn}-*)`,
      )) as unknown as StoredRow[];
      if (rows.length) storedByTxn.set(txn, rows);
    }

    const rows: CorpusRow[] = [];
    const changes: { before: Notice | null; after: Notice }[] = [];
    const fresh = notices.filter((n) => !storedByApi.has(n.api_id ?? ""));
    const freshIds = assignIds(fresh);
    for (const n of notices) {
      const stored = storedByApi.get(n.api_id ?? "");
      if (stored) {
        const before = storedNotice(stored);
        const sameTxn = before?.transaction_number === n.transaction_number;
        const grouped = /-\d+$/.test(stored.id);
        const orderMoved = grouped && (before?.date !== n.date || before?.created !== n.created);
        if (!sameTxn || orderMoved) {
          held.push({
            key: stored.id,
            reason: "an edited notice would change its row id; a full rebuild renumbers it",
          });
          continue;
        }
        rows.push(noticeRow(n, stored.id));
        changes.push({ before, after: n });
        continue;
      }
      let id = freshIds.get(n.api_id ?? "")!;
      const txn = n.transaction_number;
      const group = txn ? (storedByTxn.get(txn) ?? []) : [];
      if (!txn) {
        // api-<first 8 of the api id>: never reuse a held id
        const exists = await ctx.corpus.query(
          `corpus_records?select=id&dataset=eq.${DATASET}&id=eq.${encodeURIComponent(id)}`,
        );
        if (exists.length) {
          held.push({
            key: n.api_id ?? "",
            reason: "row id derived from the API id is already held",
          });
          continue;
        }
      } else if (group.length) {
        if (group.some((g) => g.id === txn)) {
          held.push({
            key: n.api_id ?? "",
            reason:
              "transaction number already held under its plain id; a full rebuild renumbers both notices",
          });
          continue;
        }
        const storedNotices = group.map(storedNotice).filter((x): x is Notice => Boolean(x));
        const sameTxnFresh = fresh
          .filter((f) => f.transaction_number === txn)
          .sort((a, b) => cmpTuple(groupKey(a), groupKey(b)));
        const lastStored = storedNotices.map(groupKey).sort(cmpTuple).at(-1)!;
        if (cmpTuple(groupKey(sameTxnFresh[0]!), lastStored) <= 0) {
          held.push({
            key: n.api_id ?? "",
            reason:
              "would sort before a held notice of the same transaction; a full rebuild renumbers them",
          });
          continue;
        }
        id = `${txn}-${group.length + sameTxnFresh.indexOf(n) + 1}`;
      }
      rows.push(noticeRow(n, id));
      changes.push({ before: null, after: n });
    }

    // Python order: (date or "", id)
    rows.sort((a, b) =>
      cmpTuple(
        [String((a.item["notice"] as JsonObject)["date"] ?? ""), a.id],
        [String((b.item["notice"] as JsonObject)["date"] ?? ""), b.id],
      ),
    );

    // the series row, moved by the notices written (a no-op change is dropped by change detection)
    const [seriesStored] = await ctx.corpus.rowsBy(DATASET, "id", ["series-by-year"]);
    const notes: JsonObject = {
      pages_read: Math.ceil(records.length / 50),
      meta_count: metaCount,
      since: since || null,
    };
    if (seriesStored) {
      const ss = seriesStored.item["series"] as unknown as Series;
      const period = String((seriesStored.item["cells"] as JsonObject)["period"] ?? "");
      const m = period.match(/^(\d{4}-\d{2}-\d{2}|None) to (\d{4}-\d{2}-\d{2}|None)$/);
      const moved = moveSeries(
        {
          series: ss,
          first: m?.[1] === "None" ? null : (m?.[1] ?? null),
          last: m?.[2] === "None" ? null : (m?.[2] ?? null),
        },
        changes,
      );
      if ("held" in moved) held.push({ key: "series-by-year", reason: moved.held });
      else rows.push(seriesRow(moved.series, moved.first, moved.last));
    } else notes["series_row"] = "not held; written by the full builder";

    const newestCreated =
      notices
        .map((n) => n.created ?? "")
        .sort()
        .at(-1) ?? "";
    return {
      rows,
      fetched: byApiId.size,
      held,
      cursorAfter: { created_through: newestCreated > since ? newestCreated : since || null },
      complete,
      notes: { ...notes, ...(stopped ? { stopped } : {}) },
    };
  },

  comparable(content) {
    return content as unknown as Json;
  },
};
