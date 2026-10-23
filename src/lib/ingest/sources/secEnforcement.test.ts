import { describe, expect, it } from "vitest";
import fixture from "../fixtures/sec-enforcement-2026-10-23.json";
import { canonical } from "../rows.ts";
import type { CollectContext, CorpusReader, JsonObject, SourceHttp, StoredRow } from "../types.ts";
import {
  AP_LIST,
  AP_RSS,
  LR_LIST,
  LR_RSS,
  apRow,
  defaultLookups,
  feedNumbers,
  lrRow,
  parseListing,
  releaseText,
  respondentParts,
  secEnforcement,
} from "./secEnforcement.ts";

const stored = new Map((fixture.stored as unknown as StoredRow[]).map((r) => [r.id, r]));
const content = (r: Partial<StoredRow>) => ({
  category: r.category,
  state: r.state ?? "",
  title: r.title,
  source_url: r.source_url,
  item: r.item,
  detail: r.detail,
  text: r.text,
  filters: r.filters,
});
const lk = defaultLookups();

describe("SEC rows equal the rows build_sec.py stored", () => {
  const lr = parseListing(fixture.lr_listing);
  const ap = parseListing(fixture.ap_listing);

  it("parses the listing rows", () => {
    expect(lr).toHaveLength(4);
    expect(ap).toHaveLength(4);
    expect(lr[0]).toMatchObject({
      release_number: "LR-26677",
      date: "2026-10-21",
      respondents: "Benjamin Conde",
    });
  });

  it.each(lr.map((i) => [i.release_number!, i] as const))("litigation release %s", (n, item) => {
    const raw = (fixture.pages as Record<string, string>)[n.toLowerCase()]!;
    const [title, text] = releaseText(raw, item.url!);
    const row = lrRow(item, title, text, lk);
    const want = stored.get(row.id);
    expect(want, row.id).toBeDefined();
    expect(canonical(content(row))).toBe(canonical(content(want!)));
  });

  it.each(ap.map((i) => [i.release_number!, i] as const))(
    "administrative proceeding %s",
    (_n, item) => {
      const row = apRow(item, lk);
      const want = stored.get(row.id);
      if (!want) return; // newer than the held build
      expect(canonical(content(row))).toBe(canonical(content(want)));
    },
  );

  it("splits respondents as the builder does", () => {
    expect(respondentParts("A Corp., B LLC, and C; D and E")).toEqual([
      "A Corp",
      "B LLC",
      "C",
      "D",
      "E",
    ]);
  });
});

describe("scheduled SEC run", () => {
  it("reads the feeds, then only the listing and pages of numbers not held", async () => {
    const urls: string[] = [];
    const http: SourceHttp = {
      requests: [],
      remaining: 30,
      async getText(url) {
        urls.push(url);
        const text =
          url === LR_RSS
            ? fixture.lr_rss
            : url === AP_RSS
              ? fixture.ap_rss
              : url === LR_LIST
                ? fixture.lr_listing
                : url === AP_LIST
                  ? fixture.ap_listing
                  : ((fixture.pages as Record<string, string>)[url.split("/").pop()!] ?? "");
        return {
          status: 200,
          text,
          record: {
            url,
            status: 200,
            bytes: text.length,
            sha256: "x",
            retrieved_at: "2026-10-24T09:00:00Z",
          },
        };
      },
    };
    // pretend LR-26677 is not held yet
    const held = [...stored.values()].filter((r) => r.id !== "sec-lr:LR-26677");
    const corpus: CorpusReader = {
      async rowsBy(_d, _c, values) {
        return held.filter((r) => values.includes(r.id));
      },
      async edge() {
        return [];
      },
      async query() {
        return [];
      },
      async rpc() {
        return null as never;
      },
    };
    const ctx: CollectContext = {
      http,
      corpus,
      cursor: null,
      now: new Date("2026-10-24T09:00:00Z"),
      env: () => undefined,
    };
    const out = await secEnforcement.collect(ctx);
    expect(out.complete).toBe(true);
    const lrRows = out.rows.filter((r) => r.id.startsWith("sec-lr:"));
    expect(lrRows.map((r) => r.id)).toEqual(["sec-lr:LR-26677"]);
    expect(canonical(content(lrRows[0]!))).toBe(canonical(content(stored.get("sec-lr:LR-26677")!)));
    // the release page of the new number was read, no other release page
    expect(urls.filter((u) => /\/lr-\d+$/.test(u))).toEqual([
      "https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26677",
    ]);
    const order = out.rows.map((r) => String(((r.item["sec_action"] ?? {}) as JsonObject)["date"]));
    expect([...order].sort().reverse()).toEqual(order);
  });

  it("feed numbers come from dc:creator", () => {
    expect(feedNumbers(fixture.lr_rss).slice(0, 2)).toEqual(["LR-26677", "LR-26676"]);
  });
});
