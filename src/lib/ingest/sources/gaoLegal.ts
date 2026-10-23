/**
 * GAO legal decisions (bid protests and Comptroller General decisions and opinions) → gao_legal_decisions (upsert,
 * newest first), from GAO's "Legal Products" RSS feed (https://www.gao.gov/rss/reportslegal.xml; listed on
 * https://www.gao.gov/about/stay-connected). The feed holds the latest ~25 decisions; a run reads it once.
 *
 * gao.gov's robots.txt asks every crawler for 420 seconds between requests, so the decision history is not copied (it
 * would take weeks); this dataset grows from its first run forward. GovInfo's GAOREPORTS collection (govinfo_gao_reports)
 * holds the 1994-2008 reports and decisions. Each record keeps the feed's own words: title, B-number from the link, the
 * summary exactly as published (GAO shortens it with "…"), and the publication time.
 */
import { pyStrip } from "../py.ts";
import { corpusRecord } from "../rows.ts";
import type { CollectContext, Collected, CorpusRow, HeldRecord, Json, JsonObject, RowContent, SourceAdapter } from "../types.ts";
import { htmlUnescape } from "./pyHtml.ts";
import { etDate } from "./regulationsGov.ts";

export const GAO_DATASET = "gao_legal_decisions";
export const GAO_FEED = "https://www.gao.gov/rss/reportslegal.xml";
export const GAO_FEEDS_PAGE = "https://www.gao.gov/about/stay-connected";

export type GaoItem = { title: string; link: string; bNumber: string; description: string | null; pubDate: string | null; published: string | null };

const tag = (x: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(x);
  if (!m) return null;
  const v = m[1]!.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
  return pyStrip(htmlUnescape(v)) || null;
};

/**
 * The feed escapes descriptions twice ("Test &amp;amp; Technology" for "Test & Technology", while the title of the same
 * item reads "Test &amp; Technology"): a description that still holds an entity after one decoding is decoded once more.
 */
export function unescapeTwice(v: string | null): string | null {
  if (v === null) return null;
  return /&(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/.test(v) ? htmlUnescape(v) : v;
}

/** Items of the feed, values as published (entities decoded, edge whitespace trimmed). */
export function parseFeed(xml: string): GaoItem[] {
  const out: GaoItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1]!;
    const title = tag(x, "title");
    const link = tag(x, "link");
    // several decision numbers are joined by a comma, which the link writes as %2C
    let path = "";
    try {
      path = link ? decodeURIComponent(link) : "";
    } catch {
      path = link ?? "";
    }
    const b = /\/products\/(b-[0-9]+(?:\.[0-9]+)?(?:,b-[0-9]+(?:\.[0-9]+)?)*)$/i.exec(path);
    if (!title || !link || !b) continue;
    const pubDate = tag(x, "pubDate");
    const t = pubDate ? Date.parse(pubDate) : NaN;
    out.push({
      title,
      link,
      bNumber: b[1]!.toUpperCase().replaceAll(",", ", "),
      description: unescapeTwice(tag(x, "description")),
      pubDate,
      published: Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") : null,
    });
  }
  return out;
}

export function gaoRow(it: GaoItem, prov: { feed_url: string; retrieved_at: string }): CorpusRow {
  const date = etDate(it.published);
  return corpusRecord(GAO_DATASET, `gao:${it.bNumber.toLowerCase().replaceAll(", ", ",")}`, it.title, {
    source_url: it.link,
    subtitle: [it.bNumber, date ? `published ${date}` : null].filter(Boolean).join(" · "),
    cells: { b_number: it.bNumber, published: date ?? "Not recorded", summary: it.description ?? "Not recorded" },
    facts: [
      ["Decision number (from the link)", it.bNumber],
      ["Title (as published)", it.title],
      ["Summary (as published in the feed; GAO shortens it)", it.description ?? "Not recorded"],
      ["Published", it.pubDate ?? "Not recorded"],
      ["Decision page", it.link],
      ["Source", `GAO Legal Products RSS feed (${GAO_FEED}), listed on ${GAO_FEEDS_PAGE}`],
    ] as unknown as Json,
    badges: ["GAO legal decision"],
    links: [{ url: it.link, label: "Decision on gao.gov" }],
    text: [it.bNumber, it.description].filter(Boolean).join(" "),
    filters: { year: date ? [date.slice(0, 4)] : [], month: date ? [date.slice(0, 7)] : [] },
    extra: { kind: "gao_legal_decision", decision: it as unknown as JsonObject, provenance: prov as unknown as JsonObject },
  });
}

export const gaoLegalDecisions: SourceAdapter = {
  source: "gao_legal_decisions",
  dataset: GAO_DATASET,
  mode: "upsert",
  ordinalPolicy: "prepend",
  functionName: "ingest-gao-legal",
  // one request a run: gao.gov's robots.txt asks for 420 s between requests
  limits: { maxRequests: 1, minIntervalMs: 420_000 },
  secrets: [],
  async collect(ctx: CollectContext): Promise<Collected> {
    const res = await ctx.http.getText(GAO_FEED, { headers: { Accept: "application/rss+xml, application/xml" } });
    if (res.status !== 200) throw new Error(`gao.gov HTTP ${res.status}`);
    const items = parseFeed(res.text);
    const held: HeldRecord[] = [];
    const rows = new Map<string, CorpusRow>();
    for (const it of items) {
      const row = gaoRow(it, { feed_url: res.record.url, retrieved_at: res.record.retrieved_at });
      if (!rows.has(row.id)) rows.set(row.id, row);
    }
    const ordered = [...rows.values()].sort((a, b) => {
      const x = String(((a.item["decision"] ?? {}) as JsonObject)["published"] ?? "");
      const y = String(((b.item["decision"] ?? {}) as JsonObject)["published"] ?? "");
      return x !== y ? (x < y ? 1 : -1) : a.id < b.id ? 1 : -1;
    });
    return { rows: ordered, fetched: items.length, held, cursorAfter: null, complete: true, notes: { items: items.length } };
  },
  comparable: (c: RowContent) => {
    const item = { ...(c.item as JsonObject) };
    delete item["provenance"];
    return { ...(c as unknown as JsonObject), item } as Json;
  },
};
