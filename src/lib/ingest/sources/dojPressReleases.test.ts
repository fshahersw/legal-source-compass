import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/doj-press-releases-2026-10-23.json";
import { canonical } from "../rows.ts";
import type { CollectContext, CorpusReader, JsonObject, SourceHttp, StoredRow } from "../types.ts";
import {
  buildRelease,
  defaultDojLookups,
  dojPageUrl,
  dojPressReleases,
  epochDate,
  sentenceKey,
  sha1Hex,
  sortReleases,
  usaoState,
} from "./dojPressReleases.ts";

const results = fixture.results as unknown as JsonObject[];
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
const lk = defaultDojLookups();

describe("DOJ rows equal the rows build_doj.py stored", () => {
  it.each(results.map((r) => [String(r["uuid"]), r] as const))("%s", async (_u, r) => {
    const [year, row] = await buildRelease(r, lk);
    expect(year).toBe("2026");
    const want = stored.get(row.id)!;
    expect(want).toBeDefined();
    expect(canonical(content(row))).toBe(canonical(content(want)));
  });
});

describe("helpers", () => {
  it("sha1 and sentence keys", () => {
    for (const s of ["", "abc", "x".repeat(1000), "Settlement of $5 million “quoted”"])
      expect(sha1Hex(s)).toBe(createHash("sha1").update(s, "utf8").digest("hex"));
    expect(sentenceKey("  The  Department\nRECOVERED $1  ")).toBe(
      createHash("sha1").update("the department recovered $1", "utf8").digest("hex").slice(0, 16),
    );
  });
  it("dates and office states", () => {
    expect(epochDate("1792670400")).toBe("2026-10-22");
    expect(epochDate("")).toBeNull();
    expect(usaoState(["Department of Justice", "USAO - Pennsylvania, Eastern"])).toBe("PA");
    expect(usaoState(["USAO - District of Columbia"])).toBe("DC");
    expect(usaoState(["USAO - Northern Mariana Islands"])).toBeNull();
  });
  it("boilerplate keys of the base build are loaded", () => {
    expect(lk.boilerplate.size).toBeGreaterThan(50);
  });
});

describe("scheduled DOJ run", () => {
  it("builds every release changed since the cursor (a day of overlap) and holds other years", async () => {
    const [, sample] = await buildRelease(results[0]!, lk);
    const changed = String((sample.item["release"] as JsonObject)["changed"]);
    const other = {
      ...results[1]!,
      uuid: "00000000-0000-0000-0000-000000000000",
      date: "1735732800",
    }; // 2025-01-01
    const urls: string[] = [];
    const http: SourceHttp = {
      requests: [],
      remaining: 6,
      async getText(url) {
        urls.push(url);
        const body = JSON.stringify({ results: url === dojPageUrl(0) ? [...results, other] : [] });
        return {
          status: 200,
          text: body,
          record: {
            url,
            status: 200,
            bytes: body.length,
            sha256: "x",
            retrieved_at: "2026-10-24T00:00:00Z",
          },
        };
      },
    };
    const corpus: CorpusReader = {
      async rowsBy() {
        return [];
      },
      async edge() {
        return [];
      },
      async query() {
        return [{ v: changed }];
      },
      async rpc() {
        return null as never;
      },
    };
    const ctx: CollectContext = {
      http,
      corpus,
      cursor: null,
      now: new Date("2026-10-24T00:00:00Z"),
      env: () => undefined,
    };
    const out = await dojPressReleases(2026).collect(ctx);
    expect(out.held.map((h) => h.reason)).toContain(
      "release year 2025: belongs to doj_press_releases_2025, not this source's partition",
    );
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.rows.every((r) => r.dataset === "doj_press_releases_2026")).toBe(true);
    expect(sortReleases(out.rows).map((r) => r.id)).toEqual(out.rows.map((r) => r.id));
    expect(urls[0]).toBe(dojPageUrl(0));
  });
});
