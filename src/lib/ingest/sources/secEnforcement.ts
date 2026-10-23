/**
 * SEC litigation releases and administrative proceedings → sec_enforcement_actions (upsert, newest first).
 *
 * Port of scripts/enrichment/enforcement_actions/build_sec.py (rows) and sec_parse.py (listing and release pages), with
 * the extractors of enforcementText.ts (tested equal to extract.py). A scheduled run:
 *   1. reads the SEC's two RSS feeds (litigation releases, administrative proceedings: the newest ~20 of each);
 *   2. when a feed lists a release number not held, reads page 0 of that list on sec.gov (the 100 newest rows, the
 *      builder's source of dates, respondents, release and file numbers and "see also" links), and page 1 if a new
 *      number is not on page 0;
 *   3. builds administrative-proceeding rows for every row of the pages read (no further request; a changed "see also"
 *      list updates the held row) and litigation-release rows for the new numbers, reading each new release's page for
 *      its civil action numbers, courts, dollar figures and statutes, exactly as the builder does.
 * Respondents link to /companies/<CIK> only on a unique exact normalised name (the builder's saved lookup); courts only
 * to ids in the builder's saved court list. sec.gov fair access: a declared User-Agent (http.ts) and requests 1 s apart
 * (the SEC allows 10 a second).
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { pyStrip } from "../py.ts";
import { corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";
import { COMPANY_LOOKUP, COURT_LOOKUP } from "./enforcementLookups.ts";
import {
  Companies,
  NOT_RECORDED,
  RESOLUTION_CAP_USD,
  RESOLUTION_KINDS,
  amountBucket,
  clip,
  extractAmounts,
  extractCourtCites,
  extractCourts,
  extractDockets,
  extractStatutes,
  factsList,
  headlineFigure,
  htmlToText,
  moneyLabel,
  pyStr,
  rx,
  sentenceSpans,
} from "./enforcementText.ts";
import { htmlUnescape } from "./pyHtml.ts";

export const SEC_DATASET = "sec_enforcement_actions";
const BASE = "https://www.sec.gov";
export const LR_LIST = BASE + "/enforcement-litigation/litigation-releases";
export const AP_LIST = BASE + "/enforcement-litigation/administrative-proceedings";
export const LR_RSS = LR_LIST + "/rss";
export const AP_RSS = AP_LIST + "/rss";
const SERIES: Record<string, string> = {
  "33": "Securities Act of 1933 release",
  "34": "Securities Exchange Act of 1934 release",
  IA: "Investment Advisers Act of 1940 release",
  IC: "Investment Company Act of 1940 release",
  AAE: "Accounting and Auditing Enforcement release",
  LR: "Litigation release",
};

/* ------------------------------------------------------------------ sec_parse */

const TAG = rx("<[^>]+>", "g");
const WS = rx("\\s+", "g");

/** sec_parse.clean */
export function clean(fragment: string | null | undefined): string | null {
  if (fragment === null || fragment === undefined) return null;
  const text = pyStrip(
    htmlUnescape(fragment.replace(TAG, " ")).replaceAll("\xa0", " ").replace(WS, " "),
  );
  return text || null;
}

function subfield(row: string, name: string): string | null {
  const re = rx(
    '<div class="view-table_subfield view-table_subfield_' +
      name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      '">\\s*<span class="view-table_subfield_label">.*?</span>\\s*<span class="view-table_subfield_value">(.*?)</span>\\s*</div>',
    "s",
  );
  const m = re.exec(row);
  return m ? m[1]! : null;
}

export type ListingItem = {
  date: string | null;
  datetime: string | null;
  respondents: string | null;
  url: string | null;
  release_number: string | null;
  file_number: string | null;
  see_also: { label: string | null; url: string }[];
};

/** sec_parse.parse_listing */
export function parseListing(text: string): ListingItem[] {
  const out: ListingItem[] = [];
  for (const rm of text.matchAll(rx('<tr class="pr-list-page-row">(.*?)</tr>', "gs"))) {
    const row = rm[1]!;
    const date = rx('<time datetime="([0-9T:\\-Z+]+)"').exec(row);
    const resp = rx("<div class='release-view__respondents'>(.*?)</div>", "s").exec(row);
    const links = resp
      ? [...resp[1]!.matchAll(rx("<a href='([^']+)'>(.*?)</a>", "gs"))].map((m) => [m[1]!, m[2]!])
      : [];
    let url = links.length ? (links[0]![0] ?? null) : null;
    if (url && url.startsWith("/")) url = BASE + url;
    const seeAlso: ListingItem["see_also"] = [];
    const sa = subfield(row, "see_also");
    if (sa)
      for (const m of sa.matchAll(rx('<a href="([^"]+)"[^>]*>(.*?)</a>', "gs")))
        seeAlso.push({ label: clean(m[2]), url: m[1]!.startsWith("/") ? BASE + m[1] : m[1]! });
    out.push({
      date: date ? date[1]!.slice(0, 10) : null,
      datetime: date ? date[1]! : null,
      respondents: clean(resp ? resp[1] : ""),
      url,
      release_number: clean(subfield(row, "release_number")),
      file_number: clean(subfield(row, "file_number")),
      see_also: seeAlso,
    });
  }
  return out;
}

/** sec_parse.release_body */
export function releaseBody(text: string): string | null {
  const m = rx(
    '<div class="clearfix text-formatted usa-prose field field--name-body[^"]*"[^>]*>(.*?)</div>\\s*</div>\\s*</div>\\s*</div>',
    "s",
  ).exec(text);
  if (m) return m[1]!;
  const m2 = rx("field--name-body[^>]*>(.*?)</div>", "s").exec(text);
  return m2 ? m2[1]! : null;
}

/** sec_parse.page_title */
export function pageTitle(text: string): string | null {
  const m = rx('<h1 class="page-title__heading">(.*?)</h1>', "s").exec(text);
  return m ? clean(m[1]) : null;
}

/** build_sec.release_text for an HTML release page: (page title, release text) */
export function releaseText(raw: string, url: string): [string | null, string | null] {
  if (url.toLowerCase().endsWith(".txt")) {
    const plain = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const paras = plain
      .split(rx("\\n[ \\t]*\\n"))
      .map((p) => p.replace(rx("[ \\t]*\\n[ \\t]*", "g"), " "));
    return [null, htmlToText(paras.join("</p>"))];
  }
  let body = releaseBody(raw);
  const head = raw.slice(0, 500).toLowerCase();
  if (body === null && (head.includes("<html") || head.includes("<!doctype"))) {
    const m = rx("<body[^>]*>(.*)</body>", "si").exec(raw);
    body = m ? m[1]! : raw;
  }
  return [pageTitle(raw), htmlToText(body ?? "")];
}

/** build_sec.respondent_parts */
export function respondentParts(respondents: string | null): string[] {
  if (!respondents) return [];
  return respondents
    .split(rx(";\\s|,\\s(?:and\\s)?|\\sand\\s"))
    .map((p) => (p ?? "").replace(/^[ ,.]+|[ ,.]+$/g, ""))
    .filter((p) => p);
}

/* ------------------------------------------------------------------ rows */

export type SecLookups = { companies: Companies; courts: Record<string, string> };
export const defaultLookups = (): SecLookups => ({
  companies: new Companies(COMPANY_LOOKUP.rows),
  courts: COURT_LOOKUP.courts,
});

const lrId = (n: string | null) =>
  "sec-lr:" + (n ?? "").replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
const apId = (n: string | null) =>
  "sec-ap:" + (n ?? "").replace(/[^A-Za-z0-9;.-]/g, "").toUpperCase();

/** One litigation-release row exactly as build_sec.py writes it (title/text from the release page, or null). */
export function lrRow(
  item: ListingItem,
  title: string | null,
  text: string | null,
  lk: SecLookups,
): CorpusRow {
  const number = item.release_number!;
  const rid = lrId(number);
  let civil: ReturnType<typeof extractDockets> = [];
  const courtList: { as_written: string; court_id: string | null; offset: number }[] = [];
  let amounts: ReturnType<typeof extractAmounts> = [];
  let statutes: ReturnType<typeof extractStatutes> = [];
  let excerpt: string | null = null;
  if (text) {
    civil = extractDockets(text)
      .filter((d) => d.form !== "MDL number")
      .slice(0, 6);
    const cites = extractCourtCites(text, 6);
    const names = extractCourts(text, 6);
    const seen = new Set<string>();
    for (const c of [...cites, ...names]) {
      let cid: string | null = c.court_id ?? null;
      if (cid && !(cid in lk.courts)) cid = null;
      const key = JSON.stringify([c.as_written, cid]);
      if (seen.has(key)) continue;
      seen.add(key);
      courtList.push({ as_written: c.as_written, court_id: cid, offset: c.offset });
    }
    const spans = sentenceSpans(text);
    amounts = extractAmounts(text, spans, 8);
    statutes = extractStatutes(text, 10);
    excerpt = clip(text, 900)[0];
  }
  const companyLinks: JsonObject[] = [];
  for (const part of respondentParts(item.respondents)) {
    const m = lk.companies.match(part);
    if (m) companyLinks.push({ ...m, as_written: part });
  }
  const courtIds = [
    ...new Set(courtList.map((c) => c.court_id).filter((x): x is string => Boolean(x))),
  ].sort();
  const resolution = amounts
    .filter(
      (a) =>
        a.value_usd &&
        a.keyword &&
        RESOLUTION_KINDS.has(a.keyword) &&
        a.value_usd < RESOLUTION_CAP_USD,
    )
    .map((a) => a.value_usd!);
  const maxRes = resolution.length ? Math.max(...resolution) : null;
  const headline = text ? headlineFigure(title, amounts, item.date, 6) : null;
  let noneReason: string | null = null;
  if (headline === null && maxRes !== null)
    noneReason = "only figures about an earlier or separate matter";
  if (headline)
    headline.differs_from_largest =
      maxRes !== null && Math.abs(headline.value_usd - maxRes) > 0.005;
  const year = (item.date ?? "").slice(0, 4);
  const links: Json[] = [{ url: item.url!, label: "SEC litigation release" }];
  for (const s of item.see_also.slice(0, 6))
    links.push({ url: s.url, label: s.label || "Related document" });
  for (const cid of courtIds)
    links.push({ url: `/courts/${cid}`, label: `Court: ${lk.courts[cid]}` });
  for (const c of companyLinks)
    links.push({
      url: `/companies/${c["cik"]}`,
      label: `SEC registrant: ${c["registrant"]} (exact name match)`,
    });
  const action: JsonObject = {
    type: "Litigation release",
    release_number: number,
    date: item.date,
    respondents: item.respondents,
    url: item.url,
    title,
    civil_actions: civil.map((d) => ({ as_written: d.as_written })),
    courts: courtList.map((c) => ({ as_written: c.as_written, court_id: c.court_id })),
    amounts: amounts.slice(0, 6).map((a) => {
      const o: JsonObject = {};
      for (const k of ["as_written", "value_usd", "keyword", "sentence"] as const)
        if (a[k] !== undefined) o[k] = a[k] as Json;
      return o;
    }),
    max_resolution_amount_usd: maxRes,
    headline_figure: headline as unknown as Json,
    ...(noneReason ? { headline_none_reason: noneReason } : {}),
    statutes: statutes.map((s) => s.cite),
    see_also: item.see_also.slice(0, 6) as unknown as Json,
    companies: companyLinks,
    text_read: Boolean(text),
    excerpt,
  };
  const civilText = civil.map((d) => d.as_written).join("; ");
  const headlineText = headline
    ? headline.source === "title"
      ? `${headline.as_written} (stated in the title)`
      : `${headline.as_written} (first resolution sentence: “${pyStr(headline.sentence)}”)`
    : noneReason
      ? `None of its own: ${noneReason}`
      : null;
  return corpusRecord(SEC_DATASET, rid, item.respondents || number, {
    source_url: item.url!,
    subtitle: [
      number,
      item.date,
      civil
        .slice(0, 2)
        .map((d) => d.as_written)
        .join("; ") || null,
    ]
      .filter(Boolean)
      .join(" · "),
    cells: {
      respondents: item.respondents,
      type: "Litigation release",
      release: number,
      date: item.date,
      civil_action: civilText || NOT_RECORDED,
      court:
        courtList
          .slice(0, 2)
          .map((c) => c.as_written)
          .join("; ") || NOT_RECORDED,
    },
    facts: factsList([
      ["Respondents (as listed by the SEC)", item.respondents],
      ["Release number", number],
      ["Date", item.date],
      ["Type", "Litigation release"],
      ["Civil action number (as stated)", civil.map((d) => d.as_written)],
      ["Court (as stated)", courtList.map((c) => c.as_written)],
      ["Headline figure", headlineText],
      ["Largest resolution figure stated", maxRes !== null ? moneyLabel(maxRes) : null],
      [
        "Dollar figures stated",
        amounts
          .slice(0, 6)
          .map((a) => `${a.as_written} (${a.keyword || "no keyword in sentence"})`),
      ],
      ["Statutes cited", statutes.map((s) => s.cite)],
      ["Release text read", text ? "yes" : "no (listing row only)"],
      ["Source", "sec.gov litigation releases"],
    ]) as unknown as Json,
    text: [item.respondents, number, title, civil.map((d) => d.as_written).join(" ")]
      .filter(Boolean)
      .join(" "),
    filters: {
      type: ["litigation_release"],
      year: year ? [year] : [],
      court: courtIds,
      amount: [amountBucket(maxRes)],
      has_civil_action: [civil.length ? "yes" : "no"],
      company: companyLinks.map((c) => c["cik"] as string),
    },
    links,
    extra: { sec_action: action },
  });
}

/** One administrative-proceeding row exactly as build_sec.py writes it. */
export function apRow(item: ListingItem, lk: SecLookups): CorpusRow {
  const number = item.release_number!;
  const rid = apId(number);
  const prefix = number.split(/[-;]/)[0]!.toUpperCase();
  const series = SERIES[prefix] ?? null;
  const companyLinks: JsonObject[] = [];
  for (const part of respondentParts(item.respondents)) {
    const m = lk.companies.match(part);
    if (m) companyLinks.push({ ...m, as_written: part });
  }
  const year = (item.date ?? "").slice(0, 4);
  const links: Json[] = [{ url: item.url!, label: "SEC administrative proceeding document" }];
  for (const s of item.see_also.slice(0, 6))
    links.push({ url: s.url, label: s.label || "Related document" });
  for (const c of companyLinks)
    links.push({
      url: `/companies/${c["cik"]}`,
      label: `SEC registrant: ${c["registrant"]} (exact name match)`,
    });
  return corpusRecord(SEC_DATASET, rid, item.respondents || number, {
    source_url: item.url!,
    subtitle: [number, item.date, item.file_number ? `File No. ${item.file_number}` : null]
      .filter(Boolean)
      .join(" · "),
    cells: {
      respondents: item.respondents,
      type: "Administrative proceeding",
      release: number,
      date: item.date,
      civil_action: "Not applicable (administrative)",
      court: "Not applicable (administrative)",
    },
    facts: factsList([
      ["Respondents (as listed by the SEC)", item.respondents],
      ["Release number", number],
      ["Release series", series],
      ["Date", item.date],
      ["Type", "Administrative proceeding"],
      ["Administrative file number", item.file_number],
      ["Source", "sec.gov administrative proceedings list"],
    ]) as unknown as Json,
    text: [item.respondents, number, item.file_number].filter(Boolean).join(" "),
    filters: {
      type: ["administrative_proceeding"],
      year: year ? [year] : [],
      series: series ? [prefix] : [],
      company: companyLinks.map((c) => c["cik"] as string),
    },
    links,
    extra: {
      sec_action: {
        type: "Administrative proceeding",
        release_number: number,
        series,
        date: item.date,
        respondents: item.respondents,
        file_number: item.file_number,
        url: item.url,
        see_also: item.see_also.slice(0, 6) as unknown as Json,
        companies: companyLinks,
      },
    },
  });
}

/** Release numbers (dc:creator) of an SEC RSS feed, in feed order. */
export function feedNumbers(xml: string): string[] {
  return [...xml.matchAll(/<dc:creator>([^<]{1,40})<\/dc:creator>/g)]
    .map((m) => clean(m[1]) ?? "")
    .filter(Boolean);
}

/** The first release number of a listing row ("34-106633, AAER-4605" → "34-106633"): what the feed names. */
export const firstNumber = (n: string | null) => (n ?? "").split(/[,;]\s*/)[0]!.trim();

async function heldFor(ctx: CollectContext, ids: string[]): Promise<string[]> {
  const exact = (await ctx.corpus.rowsBy(SEC_DATASET, "id", ids, "id")).map((r) => r.id);
  const missing = ids.filter((id) => !exact.includes(id));
  if (!missing.length) return exact;
  const like = missing.map((id) => `id.like.${encodeURIComponent(id)}*`).join(",");
  const rows = await ctx.corpus.query(
    `corpus_records?select=id&dataset=eq.${SEC_DATASET}&or=(${like})`,
  );
  return [...exact, ...rows.map((r) => String(r["id"]))];
}

const listUrl = (base: string, page: number) => (page === 0 ? base : `${base}?page=${page}`);

/** Newest first, as the builder sorts (date descending; litigation releases before proceedings on the same date). */
export function sortNewestFirst(rows: CorpusRow[]): CorpusRow[] {
  const date = (r: CorpusRow) => String(((r.item["sec_action"] ?? {}) as JsonObject)["date"] ?? "");
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (date(b.r) < date(a.r) ? -1 : date(b.r) > date(a.r) ? 1 : a.i - b.i))
    .map((x) => x.r);
}

export const secEnforcement: SourceAdapter = {
  source: "sec_enforcement",
  dataset: SEC_DATASET,
  mode: "upsert",
  ordinalPolicy: "prepend",
  functionName: "ingest-sec-enforcement",
  limits: { maxRequests: 30, minIntervalMs: 1000 },
  secrets: [],

  async collect(ctx: CollectContext): Promise<Collected> {
    const lk = defaultLookups();
    const held: HeldRecord[] = [];
    const notes: JsonObject = {};
    let fetched = 0;
    let complete = true;
    const rows: CorpusRow[] = [];
    try {
      const get = async (url: string) => {
        const r = await ctx.http.getText(url, {
          headers: { Accept: "text/html,application/rss+xml,application/xml" },
        });
        if (r.status !== 200) throw new Error(`sec.gov HTTP ${r.status}`);
        return r.text;
      };
      const lrFeed = feedNumbers(await get(LR_RSS));
      const apFeed = feedNumbers(await get(AP_RSS));
      // a feed names only the first number of a multi-number release ("34-106633" for "34-106633, AAER-4605"), so a
      // held row is found by its exact id or by an id that continues that number with a non-digit
      const heldIds = await heldFor(ctx, [...lrFeed.map(lrId), ...apFeed.map(apId)]);
      const isHeld = (id: string) =>
        heldIds.some((h) => h === id || (h.startsWith(id) && !/\d/.test(h.charAt(id.length))));
      const newLr = new Set(lrFeed.filter((n) => !isHeld(lrId(n))));
      const newAp = new Set(apFeed.filter((n) => !isHeld(apId(n))));
      notes["feed"] = {
        litigation_releases: lrFeed.length,
        proceedings: apFeed.length,
        new_lr: [...newLr],
        new_ap: [...newAp],
      };
      for (const [kind, base, wanted] of [
        ["lr", LR_LIST, newLr],
        ["ap", AP_LIST, newAp],
      ] as const) {
        if (!wanted.size) continue;
        const items: ListingItem[] = [];
        for (let page = 0; page < 2; page++) {
          items.push(...parseListing(await get(listUrl(base, page))));
          if ([...wanted].every((n) => items.some((i) => firstNumber(i.release_number) === n)))
            break;
        }
        const seen = new Set<string>();
        for (const item of items) {
          fetched++;
          if (!item.release_number || !item.url) {
            held.push({
              key: `${kind}:${item.date ?? "?"}`,
              reason: "listing row without a release number or link",
            });
            continue;
          }
          const rid = kind === "lr" ? lrId(item.release_number) : apId(item.release_number);
          if (seen.has(rid)) continue;
          seen.add(rid);
          if (kind === "ap") rows.push(apRow(item, lk));
          else if (wanted.has(firstNumber(item.release_number))) {
            const raw = await get(item.url);
            const [title, text] = releaseText(raw, item.url);
            rows.push(lrRow(item, title, text, lk));
          }
        }
        for (const n of wanted)
          if (!items.some((i) => firstNumber(i.release_number) === n))
            held.push({ key: n, reason: "in the feed but not on the first two listing pages yet" });
      }
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        complete = false;
        notes["stopped"] = error.message;
      } else throw error;
    }
    return { rows: sortNewestFirst(rows), fetched, held, cursorAfter: null, complete, notes };
  },

  comparable: (c: RowContent) => c as unknown as Json,
};
