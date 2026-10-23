import { describe, expect, it } from "vitest";
import {
  amendmentRow,
  emptyKnown,
  nominationRow,
  nominationStatus,
  normalizeAmendment,
  normalizeNomination,
  reportKeyOfPackage,
} from "./congressGov";
import { gaoRow, parseFeed, unescapeTwice } from "./gaoLegal";
import { billVersionsRow, hearingJacket, parseBillPackage } from "./govinfo";

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
    expect(items[0]!.description).toBe("Reliance Test & Technology (Reliance), of Crestview, Florida, protests the award…");
    expect(items[0]!.published).toBe("2026-10-23T18:05:00Z");
    expect(items[1]!.description).toBe('GAO reviewed the rule entitled "Car Loan Interest Deduction."');
  });

  it("decodes a second time only when an entity remains", () => {
    expect(unescapeTwice("A &amp; B")).toBe("A & B");
    expect(unescapeTwice("A & B")).toBe("A & B");
    expect(unescapeTwice(null)).toBeNull();
  });

  it("builds the record with the decision id, Eastern publication date and the gao.gov link", () => {
    const [it0] = parseFeed(FEED);
    const row = gaoRow(it0!, { feed_url: "https://www.gao.gov/rss/reportslegal.xml", retrieved_at: "2026-10-23T19:00:00Z" });
    expect(row.id).toBe("gao:b-424203.3,b-424203.4");
    expect(row.source_url).toBe("https://www.gao.gov/products/b-424203.3%2Cb-424203.4");
    expect(row.filters).toMatchObject({ year: ["2026"], month: ["2026-10"] });
    expect((row.item["cells"] as Record<string, string>)["published"]).toBe("2026-10-23");
    expect(row.text).not.toContain("&amp;");
  });
});


const prov = { api_url: "https://api.congress.gov/v3/amendment/119?limit=250&offset=0", retrieved_at: "2026-10-23T19:00:00Z" };

describe("Congress.gov amendments", () => {
  const list = {
    congress: 119,
    type: "SAMDT",
    number: "6848",
    purpose: "To amend the title.",
    latestAction: { actionDate: "2026-09-30", text: "Amendment SA 6848 agreed to in Senate by Unanimous Consent." },
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
    expect(row.filters).toMatchObject({ amended_bill: ["119-hr-5349"], sponsor: ["C000880"], year: ["2026"], detail: ["yes"] });
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
    expect(nominationStatus("Received message of withdrawal of nomination from the President.")).toBe("withdrawn");
    expect(nominationStatus("Returned to the President under the provisions of Senate Rule XXXI")).toBe("returned");
    expect(nominationStatus("Received in the Senate and referred to the Committee on the Judiciary.")).toBe("other");
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
      latestAction: { actionDate: "2026-06-11", text: "Confirmed by the Senate by Yea-Nay Vote. 51 - 46." },
    })!;
    const known = emptyKnown();
    expect(JSON.stringify(nominationRow(n, known, prov).item["links"])).not.toContain("judicial_nominations");
    known.judicial.add("nom:119-PN512");
    const row = nominationRow(n, known, prov);
    expect(row.filters).toMatchObject({ judicial: ["yes"], status: ["confirmed"], kind: ["civilian"], year: ["2026"] });
    expect(JSON.stringify(row.item["links"])).toContain("/records/judicial_nominations/nom%3A119-PN512");
    expect(normalizeNomination({ congress: 119, citation: "XYZ" })).toBeNull();
  });
});

describe("GovInfo package ids", () => {
  it("parses report, bill and hearing package ids exactly", () => {
    expect(reportKeyOfPackage("CRPT-118hrpt1")).toBe("118-hrpt-1-1");
    expect(reportKeyOfPackage("CRPT-115hrpt1050-pt2")).toBe("115-hrpt-1050-2");
    expect(reportKeyOfPackage("CPRT-119HPRT64571")).toBeNull();
    expect(parseBillPackage("BILLS-119hr7730enr")).toEqual({ congress: 119, type: "hr", number: 7730, code: "enr" });
    expect(parseBillPackage("BILLS-119hrx1ih")).toBeNull();
    expect(hearingJacket("CHRG-118hhrg51658")).toBe("51658");
    expect(hearingJacket("CHRG-110shrg1")).toBeNull();
  });

  it("groups a bill's versions oldest first and flags an enrolled text", () => {
    const row = billVersionsRow(
      { congress: 119, type: "hr", number: 7730 },
      [
        { code: "enr", date: "2026-10-09", packageId: "BILLS-119hr7730enr", title: "Bankruptcy Threshold Adjustment Act of 2026", lastModified: null },
        { code: "rds", date: "2026-09-17", packageId: "BILLS-119hr7730rds", title: null, lastModified: null },
      ],
      true,
      { listing_urls: ["https://api.govinfo.gov/collections/BILLS/2026-10-01T00:00:00Z?pageSize=1000&offsetMark=*"], retrieved_at: "2026-10-23T19:00:00Z" },
    );
    expect(row.id).toBe("119-hr-7730");
    expect(row.filters).toMatchObject({ enrolled: ["yes"], held_bill: ["yes"], version: ["rds", "enr"] });
    const versions = row.item["versions"] as { code: string; pdf: string }[];
    expect(versions.map((v) => v.code)).toEqual(["rds", "enr"]);
    expect(versions[1]!.pdf).toBe("https://www.govinfo.gov/content/pkg/BILLS-119hr7730enr/pdf/BILLS-119hr7730enr.pdf");
    expect(row.source_url).toBe("https://www.govinfo.gov/app/details/BILLS-119hr7730enr");
  });
});
