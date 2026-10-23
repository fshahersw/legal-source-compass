import { describe, expect, it } from "vitest";
import type { CollectContext, CorpusReader, JsonObject, SourceHttp, StoredRow } from "../types.ts";
import {
  amendmentRow,
  congressAmendments,
  emptyKnown,
  nominationRow,
  nominationStatus,
  normalizeAmendment,
  normalizeNomination,
  reportKeyOfPackage,
} from "./congressGov";
import { gaoRow, parseFeed, unescapeTwice } from "./gaoLegal";
import { billVersionsRow, govinfoHearings, hearingJacket, parseBillPackage } from "./govinfo";

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>GAO Legal Products</title>
<item>
  <title>Reliance Test &amp; Technology</title>
  <link>https://www.gao.gov/products/b-424203.3%2Cb-424203.4</link>
  <description>Reliance Test &amp;amp; Technology (Reliance), of Crestview, Florida, protests the award…</description>
  <pubDate>Thu, 23 Oct 2026 14:05:00 -0400</pubDate>
</item>
<item>
  <title>Department of the Treasury: Car Loan Interest Deduction</title>
  <link>https://www.gao.gov/products/b-338735</link>
  <description>GAO reviewed the rule entitled "Car Loan Interest Deduction."</description>
  <pubDate>Thu, 09 Oct 2026 10:00:00 -0400</pubDate>
</item>
<item><title>Not a decision</title><link>https://www.gao.gov/reports-testimonies</link></item>
</channel></rss>`;

describe("GAO legal products feed", () => {
  it("keeps decisions only, decodes comma-joined numbers and the doubly escaped descriptions", () => {
    const items = parseFeed(FEED);
    expect(items.map((i) => i.bNumber)).toEqual(["B-424203.3, B-424203.4", "B-338735"]);
    expect(items[0]!.title).toBe("Reliance Test & Technology");
    expect(items[0]!.description).toBe(
      "Reliance Test & Technology (Reliance), of Crestview, Florida, protests the award…",
    );
    expect(items[0]!.published).toBe("2026-10-23T18:05:00Z");
    expect(items[1]!.description).toBe(
      'GAO reviewed the rule entitled "Car Loan Interest Deduction."',
    );
  });

  it("decodes a second time only when an entity remains", () => {
    expect(unescapeTwice("A &amp; B")).toBe("A & B");
    expect(unescapeTwice("A & B")).toBe("A & B");
    expect(unescapeTwice(null)).toBeNull();
  });

  it("builds the record with the decision id, Eastern publication date and the gao.gov link", () => {
    const [it0] = parseFeed(FEED);
    const row = gaoRow(it0!, {
      feed_url: "https://www.gao.gov/rss/reportslegal.xml",
      retrieved_at: "2026-10-23T19:00:00Z",
    });
    expect(row.id).toBe("gao:b-424203.3,b-424203.4");
    expect(row.source_url).toBe("https://www.gao.gov/products/b-424203.3%2Cb-424203.4");
    expect(row.filters).toMatchObject({ year: ["2026"], month: ["2026-10"] });
    expect((row.item["cells"] as Record<string, string>)["published"]).toBe("2026-10-23");
    expect(row.text).not.toContain("&amp;");
  });
});

const prov = {
  api_url: "https://api.congress.gov/v3/amendment/119?limit=250&offset=0",
  retrieved_at: "2026-10-23T19:00:00Z",
};

describe("Congress.gov amendments", () => {
  const list = {
    congress: 119,
    type: "SAMDT",
    number: "6848",
    purpose: "To amend the title.",
    latestAction: {
      actionDate: "2026-09-30",
      text: "Amendment SA 6848 agreed to in Senate by Unanimous Consent.",
    },
    updateDate: "2026-10-03T11:08:21Z",
  };
  const detail = {
    amendment: {
      congress: 119,
      type: "SAMDT",
      number: "6848",
      chamber: "Senate",
      submittedDate: "2026-09-29T04:00:00Z",
      sponsors: [{ bioguideId: "C000880", fullName: "Sen. Crapo, Mike [R-ID]" }],
      amendedBill: { congress: 119, type: "HR", number: "5349", title: "A bill" },
      actions: { count: 2 },
    },
  };

  it("links the amended bill only when the atlas holds it, and records what the list alone cannot say", () => {
    const known = emptyKnown();
    known.bills.add("119-hr-5349");
    const a = normalizeAmendment(list, detail)!;
    const row = amendmentRow(a, known, prov);
    expect(row.id).toBe("amdt:119-samdt-6848");
    expect(row.filters).toMatchObject({
      amended_bill: ["119-hr-5349"],
      sponsor: ["C000880"],
      year: ["2026"],
      detail: ["yes"],
    });
    expect(JSON.stringify(row.item["links"])).toContain("/law/legislation/federal/119/hr/5349");

    const listOnly = amendmentRow(normalizeAmendment(list, null)!, emptyKnown(), prov);
    expect(listOnly.filters).toMatchObject({ detail: ["no"], sponsor: [], amended_bill: [] });
    expect(JSON.stringify(listOnly.item["links"])).not.toContain("/law/legislation/federal/");
    expect(JSON.stringify(listOnly.detail)).toContain("Not recorded");
  });

  it("rejects a record without a usable number", () => {
    expect(normalizeAmendment({ congress: 119, type: "SAMDT", number: "x" }, null)).toBeNull();
  });
});

describe("Congress.gov nominations", () => {
  it("reads the status from the latest action text only", () => {
    expect(nominationStatus("Confirmed by the Senate by Voice Vote.")).toBe("confirmed");
    expect(
      nominationStatus("Received message of withdrawal of nomination from the President."),
    ).toBe("withdrawn");
    expect(
      nominationStatus("Returned to the President under the provisions of Senate Rule XXXI"),
    ).toBe("returned");
    expect(
      nominationStatus("Received in the Senate and referred to the Committee on the Judiciary."),
    ).toBe("other");
    expect(nominationStatus(null)).toBe("not_recorded");
  });

  it("links a judicial nomination record only on the same Congress and PN citation", () => {
    const n = normalizeNomination({
      congress: 119,
      citation: "PN512",
      number: 512,
      organization: "The Judiciary",
      receivedDate: "2026-03-02",
      nominationType: { isCivilian: true },
      latestAction: {
        actionDate: "2026-06-11",
        text: "Confirmed by the Senate by Yea-Nay Vote. 51 - 46.",
      },
    })!;
    const known = emptyKnown();
    expect(JSON.stringify(nominationRow(n, known, prov).item["links"])).not.toContain(
      "judicial_nominations",
    );
    known.judicial.add("nom:119-PN512");
    const row = nominationRow(n, known, prov);
    expect(row.filters).toMatchObject({
      judicial: ["yes"],
      status: ["confirmed"],
      kind: ["civilian"],
      year: ["2026"],
    });
    expect(JSON.stringify(row.item["links"])).toContain(
      "/records/judicial_nominations/nom%3A119-PN512",
    );
    expect(normalizeNomination({ congress: 119, citation: "XYZ" })).toBeNull();
  });
});

describe("GovInfo package ids", () => {
  it("parses report, bill and hearing package ids exactly", () => {
    expect(reportKeyOfPackage("CRPT-118hrpt1")).toBe("118-hrpt-1-1");
    expect(reportKeyOfPackage("CRPT-115hrpt1050-pt2")).toBe("115-hrpt-1050-2");
    expect(reportKeyOfPackage("CPRT-119HPRT64571")).toBeNull();
    expect(parseBillPackage("BILLS-119hr7730enr")).toEqual({
      congress: 119,
      type: "hr",
      number: 7730,
      code: "enr",
    });
    expect(parseBillPackage("BILLS-119hrx1ih")).toBeNull();
    expect(hearingJacket("CHRG-118hhrg51658")).toBe("51658");
    expect(hearingJacket("CHRG-110shrg1")).toBeNull();
  });

  it("groups a bill's versions oldest first and flags an enrolled text", () => {
    const row = billVersionsRow(
      { congress: 119, type: "hr", number: 7730 },
      [
        {
          code: "enr",
          date: "2026-10-09",
          packageId: "BILLS-119hr7730enr",
          title: "Bankruptcy Threshold Adjustment Act of 2026",
          lastModified: null,
        },
        {
          code: "rds",
          date: "2026-09-17",
          packageId: "BILLS-119hr7730rds",
          title: null,
          lastModified: null,
        },
      ],
      true,
      {
        listing_urls: [
          "https://api.govinfo.gov/collections/BILLS/2026-10-01T00:00:00Z?pageSize=1000&offsetMark=*",
        ],
        retrieved_at: "2026-10-23T19:00:00Z",
      },
    );
    expect(row.id).toBe("119-hr-7730");
    expect(row.filters).toMatchObject({
      enrolled: ["yes"],
      held_bill: ["yes"],
      version: ["rds", "enr"],
    });
    const versions = row.item["versions"] as { code: string; pdf: string }[];
    expect(versions.map((v) => v.code)).toEqual(["rds", "enr"]);
    expect(versions[1]!.pdf).toBe(
      "https://www.govinfo.gov/content/pkg/BILLS-119hr7730enr/pdf/BILLS-119hr7730enr.pdf",
    );
    expect(row.source_url).toBe("https://www.govinfo.gov/app/details/BILLS-119hr7730enr");
  });
});

describe("record pages of the api-law datasets sit in the Law section", () => {
  it("places each dataset under its tab", async () => {
    const { recordPlacement } = await import("@/lib/atlas/navigation");
    for (const d of ["regulations_gov_documents", "regulations_gov_dockets"])
      expect(recordPlacement(d)).toEqual({ section: "law", tab: "rulemaking" });
    for (const d of [
      "congress_amendments",
      "congress_nominations",
      "congress_treaties",
      "congress_committee_reports",
      "govinfo_hearings",
      "govinfo_committee_prints",
      "govinfo_bill_versions",
      "govinfo_gao_reports",
      "gao_legal_decisions",
    ])
      expect(recordPlacement(d)).toEqual({ section: "law", tab: "legislation" });
    expect(recordPlacement("company_sec_legal_proceedings")).toEqual({
      section: "companies",
      tab: "directory",
    });
  });
});

/* --------------------------------------------------------------------- scheduled runs against fakes */

function fakeHttp(route: (url: string) => unknown, budget = 100) {
  const urls: string[] = [];
  let used = 0;
  const http: SourceHttp & { urls: string[] } = {
    urls,
    requests: [],
    get remaining() {
      return budget - used;
    },
    async getText(url) {
      used++;
      urls.push(url);
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
  return http;
}
const corpusOf = (stored: StoredRow[]): CorpusReader => ({
  async rowsBy(dataset, column, values) {
    return stored.filter(
      (r) =>
        r.dataset === dataset && values.includes(column === "id" ? r.id : (r.source_url ?? "")),
    );
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
});
const ctxOf = (
  http: SourceHttp,
  stored: StoredRow[],
  cursor: JsonObject | null,
): CollectContext => ({
  http,
  corpus: corpusOf(stored),
  cursor,
  now: new Date("2026-10-24T09:00:00Z"),
  env: (n) => (n === "DATA_GOV_API_KEY" ? "test-key-not-real" : undefined),
});

const amdtList = (n: number, update: string) => ({
  congress: 119,
  type: "SAMDT",
  number: String(n),
  updateDate: update,
  url: `https://api.congress.gov/v3/amendment/119/samdt/${n}?format=json`,
  latestAction: { actionDate: "2026-10-20", text: "Submitted in the Senate." },
});
const amdtDetail = (n: number, update: string) => ({
  amendment: {
    congress: 119,
    type: "SAMDT",
    number: String(n),
    updateDate: update,
    chamber: "Senate",
    submittedDate: "2026-10-20T04:00:00Z",
  },
});

describe("Congress.gov scheduled runs", () => {
  it("halves a window Congress.gov counts as too large, and resumes at its end", async () => {
    const http = fakeHttp((url) => {
      if (url.includes("/samdt/")) {
        const n = Number(/samdt\/(\d+)/.exec(url)![1]);
        return amdtDetail(n, `2026-10-21T0${n}:00:00Z`);
      }
      const to = /toDateTime=([^&]+)/.exec(url)![1]!;
      // 5,000 updates in the whole window, 3 before 2026-10-22: it must shrink below 1,000 (4 pages of 250)
      const count = to > "2026-10-22T00:00:00Z" ? 5000 : 3;
      if (/limit=1&/.test(url)) return { pagination: { count }, amendments: [] };
      return {
        pagination: { count },
        amendments: count === 3 ? [3, 1, 2].map((n) => amdtList(n, `2026-10-21T0${n}:00:00Z`)) : [],
      };
    });
    const out = await congressAmendments.collect(ctxOf(http, [], { from: "2026-10-20T00:00:00Z" }));
    const to = (out.notes as JsonObject)["to"] as string;
    expect(to <= "2026-10-22T00:00:00Z").toBe(true);
    expect(out.complete).toBe(true);
    expect(out.cursorAfter).toEqual({ from: to });
    expect(out.rows.map((r) => r.id).sort()).toEqual([
      "amdt:119-samdt-1",
      "amdt:119-samdt-2",
      "amdt:119-samdt-3",
    ]);
    expect(http.urls.every((u) => !/key=/i.test(u))).toBe(true);
  });

  it("skips current details, stops at the budget and never replaces a detailed row with a list-only one", async () => {
    const updates = [
      "2026-10-21T01:00:00Z",
      "2026-10-21T02:00:00Z",
      "2026-10-21T03:00:00Z",
      "2026-10-21T04:00:00Z",
    ];
    const stored = (n: number, update: string): StoredRow =>
      ({
        dataset: "congress_amendments",
        id: `amdt:119-samdt-${n}`,
        ordinal: 0,
        item: { id: `amdt:119-samdt-${n}`, amendment: { detail: true, updateDate: update } },
      }) as unknown as StoredRow;
    const http = fakeHttp((url) => {
      if (url.includes("/samdt/")) {
        const n = Number(/samdt\/(\d+)/.exec(url)![1]);
        return amdtDetail(n, updates[n - 1]!);
      }
      return {
        pagination: { count: 4 },
        amendments: [4, 3, 2, 1].map((n) => amdtList(n, updates[n - 1]!)),
      };
    }, 3); // the list page + 2 details
    // #1 is current; #4 is stored with an older detail and must not be overwritten by a list-only row
    const out = await congressAmendments.collect(
      ctxOf(http, [stored(1, updates[0]!), stored(4, "2026-10-01T00:00:00Z")], {
        from: "2026-10-21T00:00:00Z",
      }),
    );
    expect(
      http.urls.filter((u) => u.includes("/samdt/")).map((u) => /samdt\/(\d+)/.exec(u)![1]),
    ).toEqual(["2", "3"]);
    expect(out.rows.map((r) => r.id).sort()).toEqual(["amdt:119-samdt-2", "amdt:119-samdt-3"]);
    expect(out.complete).toBe(false);
    expect(out.cursorAfter).toEqual({ from: updates[2] });
    expect((out.notes as JsonObject)["already_current"]).toBe(1);
  });
});

describe("GovInfo scheduled runs", () => {
  const listed = (id: string, modified: string) => ({
    packageId: id,
    title: `Hearing ${id}`,
    dateIssued: "2026-06-10",
    congress: "119",
    docClass: "HHRG",
    lastModified: modified,
    packageLink: `https://api.govinfo.gov/packages/${id}/summary`,
  });
  it("reads only the summaries that are not current, and resumes the window exactly after halving it", async () => {
    const http = fakeHttp((url) => {
      if (url.includes("/summary"))
        return {
          title: "HEARING",
          dateIssued: "2026-06-10",
          heldDates: ["2026-06-10"],
          committees: [],
        };
      const until = /CHRG\/[^/]+\/([^?]+)\?/.exec(url)?.[1] ?? "";
      const dense = decodeURIComponent(until) > "2026-10-23T00:00:00Z";
      if (/pageSize=10&/.test(url)) return { count: dense ? 9000 : 2, packages: [] };
      return {
        count: dense ? 9000 : 2,
        packages: dense
          ? []
          : [
              listed("CHRG-119hhrg1", "2026-10-22T10:00:00Z"),
              listed("CHRG-119hhrg2", "2026-10-22T11:00:00Z"),
            ],
      };
    });
    const current = {
      dataset: "govinfo_hearings",
      id: "CHRG-119hhrg1",
      ordinal: 0,
      item: {
        id: "CHRG-119hhrg1",
        summary: { title: "HEARING" },
        provenance: { summary_retrieved_at: "2026-10-23T00:00:00Z" },
      },
    } as unknown as StoredRow;
    const out = await govinfoHearings.collect(
      ctxOf(http, [current], { since: "2026-10-22T00:00:00Z", exact: true }),
    );
    expect(http.urls.filter((u) => u.includes("/summary"))).toEqual([
      "https://api.govinfo.gov/packages/CHRG-119hhrg2/summary",
    ]);
    expect(out.complete).toBe(true);
    const until = (out.notes as JsonObject)["until"] as string;
    expect(until <= "2026-10-23T00:00:00Z").toBe(true);
    expect(out.cursorAfter).toEqual({ since: until, exact: true });
    expect(http.urls[0]).toContain("/collections/CHRG/2026-10-22T00:00:00Z/");
  });
});
