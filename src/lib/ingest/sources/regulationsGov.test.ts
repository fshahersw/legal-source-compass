import { describe, expect, it } from "vitest";
import fixture from "../fixtures/regulations-gov-2026-10-23.json";
import { canonical, classify, contentOf } from "../rows.ts";
import type { CollectContext, CorpusReader, JsonObject, SourceHttp, StoredRow } from "../types.ts";
import {
  AGENCIES,
  commentBucket,
  comparableRegs,
  docketIdYear,
  docketRow,
  documentRow,
  documentsQuery,
  etDate,
  etFilterTime,
  frLinkFor,
  frUrl,
  normalizeDocket,
  normalizeDocument,
  regulationsGovDocuments,
  sortDocumentsNewestFirst,
  type CommentCount,
  type RegsDocument,
} from "./regulationsGov.ts";

const records = fixture.documents.data as unknown as JsonObject[];
const docs = records.map((r) => normalizeDocument(r)!);
const frRows = new Map(
  fixture.fr_links.map((l) => [
    frUrl(l.doc_num),
    { id: l.record_id, filters: { cfr_pair: l.cfr_pairs } as JsonObject },
  ]),
);
const prov = {
  api_url: "https://api.regulations.gov/v4/documents?x",
  retrieved_at: "2026-10-23T18:51:20Z",
};

describe("source records are kept exactly as published", () => {
  it.each(records.map((r) => [r["id"] as string, r] as const))("%s", (_id, rec) => {
    const a = rec["attributes"] as JsonObject;
    const d = normalizeDocument(rec)!;
    expect(d.id).toBe(rec["id"]);
    for (const k of [
      "agencyId",
      "docketId",
      "documentType",
      "title",
      "postedDate",
      "commentStartDate",
      "commentEndDate",
      "lastModifiedDate",
      "frDocNum",
      "objectId",
    ] as const)
      expect(d[k]).toBe((a[k] as string | null | undefined) || null);
    expect(d.withdrawn).toBe(a["withdrawn"]);
  });

  it("dockets keep their attributes", () => {
    for (const rec of fixture.dockets.data as unknown as JsonObject[]) {
      const a = rec["attributes"] as JsonObject;
      const d = normalizeDocket(rec)!;
      expect([d.id, d.agencyId, d.docketType, d.title, d.lastModifiedDate]).toEqual([
        rec["id"],
        a["agencyId"],
        a["docketType"] ?? null,
        a["title"] ?? null,
        a["lastModifiedDate"] ?? null,
      ]);
    }
  });

  it("refuses records without an id, agency or type", () => {
    expect(
      normalizeDocument({ id: "", attributes: { agencyId: "FDA", documentType: "Rule" } }),
    ).toBeNull();
    expect(
      normalizeDocument({ id: "FDA-2020-N-1-0001", attributes: { documentType: "Rule" } }),
    ).toBeNull();
    expect(
      normalizeDocument({ id: "FDA-2020-N-1-0001", attributes: { agencyId: "FDA" } }),
    ).toBeNull();
  });
});

describe("Eastern time", () => {
  it("dates of published instants", () => {
    expect(etDate("2026-10-19T04:00:00Z")).toBe("2026-10-19");
    expect(etDate("2026-11-24T04:59:59Z")).toBe("2026-11-23");
    expect(etDate("2026-01-15T05:00:00Z")).toBe("2026-01-15");
    expect(etDate(null)).toBeNull();
    expect(etDate("not a date")).toBeNull();
  });
  it("filter times as the API reads them (19:41:36 ET matched 23:41:36Z on 2026-10-23)", () => {
    expect(etFilterTime("2026-10-19T23:41:36Z")).toBe("2026-10-19 19:41:36");
    expect(etFilterTime("2026-01-05T03:00:00Z")).toBe("2026-01-04 22:00:00");
  });
});

describe("document rows", () => {
  it("link the Federal Register record only by the exact document number, with its CFR parts", () => {
    for (const d of docs) {
      const fr = frLinkFor(d, frRows);
      if (!d.frDocNum) expect(fr.status).toBe("none_stated");
      else {
        const l = fixture.fr_links.find((x) => x.doc_num === d.frDocNum);
        expect(fr.status).toBe(l ? "in_corpus" : "not_in_corpus");
        if (l) expect([fr.record_id, fr.cfr_pairs]).toEqual([l.record_id, l.cfr_pairs]);
      }
    }
    const other: RegsDocument = { ...docs[0]!, frDocNum: "1999-00001" };
    expect(frLinkFor(other, frRows)).toEqual({
      document_number: "1999-00001",
      record_id: null,
      status: "not_in_corpus",
      cfr_pairs: [],
    });
  });

  it("have the corpus shape, official links and Not recorded for unknowns", () => {
    for (const d of docs) {
      const fr = frLinkFor(d, frRows);
      const n = (fixture.counts as Record<string, number>)[d.id];
      const c: CommentCount | null =
        n === undefined
          ? null
          : { posted: n, scope: "document", read_on: "2026-10-23", api_url: "u" };
      const row = documentRow(d, fr, c, prov);
      expect(row.dataset).toBe("regulations_gov_documents");
      expect(row.category).toBe(row.dataset);
      expect(row.id).toBe(d.id);
      expect(row.source_url).toBe(`https://www.regulations.gov/document/${d.id}`);
      expect(row.filters["agency"]).toEqual([d.agencyId]);
      expect(row.filters["comments"]).toEqual([commentBucket(c)]);
      expect((row.item["cells"] as JsonObject)["comments"]).toBe(c ? String(n) : "Not recorded");
      expect(row.filters["cfr_pair"]).toEqual(fr.cfr_pairs);
      if (fr.record_id)
        expect(
          (row.item["links"] as JsonObject[]).some(
            (l) => l["url"] === `/records/federal_register_history/${fr.record_id}`,
          ),
        ).toBe(true);
      expect(JSON.stringify(row)).not.toMatch(/[?&](api[_-]?key|apikey|access_token|token|key)=/i);
      expect(row.text.startsWith(`${d.id} `)).toBe(true);
    }
  });

  it("change detection ignores read times but not counts", () => {
    const d = docs[0]!;
    const fr = frLinkFor(d, frRows);
    const a = documentRow(
      d,
      fr,
      { posted: 3, scope: "document", read_on: "2026-10-23", api_url: "u1" },
      prov,
    );
    const b = documentRow(
      d,
      fr,
      { posted: 3, scope: "document", read_on: "2026-11-02", api_url: "u2" },
      { ...prov, retrieved_at: "2026-11-02T10:00:00Z", api_url: "v" },
    );
    const c = documentRow(
      d,
      fr,
      { posted: 4, scope: "document", read_on: "2026-11-02", api_url: "u2" },
      prov,
    );
    expect(canonical(comparableRegs(contentOf(a)))).toBe(canonical(comparableRegs(contentOf(b))));
    expect(canonical(comparableRegs(contentOf(a)))).not.toBe(
      canonical(comparableRegs(contentOf(c))),
    );
    const stored = { ...a, ordinal: 0 } as StoredRow;
    expect(classify(regulationsGovDocuments, [b, c], [stored]).unchanged).toBe(1);
  });

  it("dataset order is newest posted first", () => {
    const sorted = sortDocumentsNewestFirst(docs);
    for (let i = 1; i < sorted.length; i++)
      expect((sorted[i - 1]!.postedDate ?? "") >= (sorted[i]!.postedDate ?? "")).toBe(true);
  });
});

describe("dockets", () => {
  it("year in the docket id and rows", () => {
    expect(docketIdYear("EPA-HQ-OAR-2021-0317")).toBe("2021");
    expect(docketIdYear("FDA-2019-N-4611")).toBe("2019");
    expect(docketIdYear("CPSC-1997-0001")).toBe("1997");
    expect(docketIdYear("FTC-PROPOSED")).toBeNull();
    const rec = (fixture.dockets.data as unknown as JsonObject[])[0]!;
    const d = normalizeDocket(rec)!;
    const row = docketRow(d, null, prov);
    expect(row.source_url).toBe(`https://www.regulations.gov/docket/${d.id}`);
    expect((row.item["cells"] as JsonObject)["comments"]).toBe("Not recorded");
  });
});

describe("queries", () => {
  it("documents query names agencies, types and windows; no key", () => {
    const q = documentsQuery({
      agencies: ["CPSC", "FTC"],
      postedFrom: "2024-01-01",
      postedTo: "2024-12-31",
      page: 2,
    });
    expect(q).toBe(
      "https://api.regulations.gov/v4/documents?filter[agencyId]=CPSC,FTC&filter[documentType]=Rule,Proposed%20Rule,Notice&filter[postedDate][ge]=2024-01-01&filter[postedDate][le]=2024-12-31&sort=lastModifiedDate,documentId&page[size]=250&page[number]=2",
    );
    expect(AGENCIES).toHaveLength(12);
  });
});

/* --------------------------------------------------------------------- a scheduled run against fakes */

function fakeHttp(
  route: (url: string) => unknown,
  budget = 100,
): SourceHttp & { urls: string[]; headers: Record<string, string>[] } {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  let used = 0;
  return {
    urls,
    headers,
    requests: [],
    get remaining() {
      return budget - used;
    },
    async getText(url, init) {
      used++;
      urls.push(url);
      headers.push(init?.headers ?? {});
      const body = JSON.stringify(route(url));
      return {
        status: 200,
        text: body,
        record: {
          url,
          status: 200,
          bytes: body.length,
          sha256: "x",
          retrieved_at: "2026-10-24T09:00:00Z",
        },
      };
    },
  };
}

function fakeCorpus(stored: StoredRow[]): CorpusReader {
  return {
    async rowsBy(dataset, column, values) {
      if (dataset === "federal_register_history")
        return values
          .map(
            (u) =>
              frRows.get(u) &&
              ({
                id: frRows.get(u)!.id,
                source_url: u,
                filters: frRows.get(u)!.filters,
              } as unknown as StoredRow),
          )
          .filter((x): x is StoredRow => Boolean(x));
      return stored.filter(
        (s) => s.dataset === dataset && values.includes(column === "id" ? s.id : s.source_url),
      );
    },
    async edge() {
      return [];
    },
    async query() {
      return [{ v: "2026-10-23T16:37:20Z" }];
    },
    async rpc() {
      return null as never;
    },
  };
}

describe("scheduled documents run", () => {
  it("reads modified documents and comment windows, keeps stored counts, sends the key only in a header", async () => {
    const counted = docs.find(
      (d) => (fixture.counts as Record<string, number>)[d.id] !== undefined,
    )!;
    const storedRow = {
      ...documentRow(
        counted,
        frLinkFor(counted, frRows),
        { posted: 7, scope: "document", read_on: "2026-10-01", api_url: "u" },
        prov,
      ),
      ordinal: 0,
    } as StoredRow;
    const http = fakeHttp((url) => {
      if (url.includes("/comments?")) return { data: [], meta: { totalElements: 11 } };
      if (url.includes("commentEndDate"))
        return { data: [], meta: { totalElements: 0, hasNextPage: false } };
      return fixture.documents;
    });
    const ctx: CollectContext = {
      http,
      corpus: fakeCorpus([storedRow]),
      cursor: null,
      now: new Date("2026-10-24T09:00:00Z"),
      env: (n) => (n === "DATA_GOV_API_KEY" ? "test-key-not-real" : undefined),
    };
    const out = await regulationsGovDocuments.collect(ctx);
    expect(out.complete).toBe(true);
    expect(out.rows.map((r) => r.id).sort()).toEqual(docs.map((d) => d.id).sort());
    // newest first (prepend policy)
    const posted = out.rows.map((r) =>
      String((r.item["regs_document"] as JsonObject)["postedDate"] ?? ""),
    );
    expect([...posted].sort().reverse()).toEqual(posted);
    // the stored count was kept for the document it belongs to (not re-read: it already has one)
    const kept = out.rows.find((r) => r.id === counted.id)!;
    expect((kept.item["comments"] as JsonObject)["posted"]).toBe(7);
    // proposed rules without a stored count were counted
    const pr = out.rows.find(
      (r) =>
        (r.item["regs_document"] as JsonObject)["documentType"] === "Proposed Rule" &&
        r.id !== counted.id,
    )!;
    expect((pr.item["comments"] as JsonObject)["posted"]).toBe(11);
    expect(http.urls.every((u) => !/key=/i.test(u))).toBe(true);
    expect(http.headers.every((h) => h["X-Api-Key"] === "test-key-not-real")).toBe(true);
    // the first run continued from the newest stored modification, an hour earlier, in Eastern time
    expect(http.urls[0]).toContain("filter[lastModifiedDate][ge]=2026-10-23%2011%3A37%3A20");
    expect(out.cursorAfter).toMatchObject({
      modified_from_et: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    });
  });

  it("stops without writing when the request budget runs out mid-read", async () => {
    const http = fakeHttp(
      () => ({ ...fixture.documents, meta: { totalElements: 9999, hasNextPage: true } }),
      3,
    );
    const wrapped: SourceHttp = {
      ...http,
      get remaining() {
        return http.remaining;
      },
      async getText(url, init) {
        if (http.remaining <= 0) {
          const { BudgetExhausted } = await import("../http.ts");
          throw new BudgetExhausted();
        }
        return http.getText(url, init);
      },
    };
    const out = await regulationsGovDocuments.collect({
      http: wrapped,
      corpus: fakeCorpus([]),
      cursor: { modified_from_et: "2026-10-23 10:00:00" },
      now: new Date("2026-10-24T09:00:00Z"),
      env: () => "k",
    });
    expect(out.complete).toBe(false);
    expect(out.rows).toEqual([]);
    expect(out.cursorAfter).toEqual({ modified_from_et: "2026-10-23 10:00:00" });
  });
});
