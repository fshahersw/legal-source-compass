import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CheckedCitation, CitationCheck } from "@/lib/assistant/protocol";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { CitationCheckLine } from "./CitationCheck";
import { citationMarks } from "./citationStatus";

const item = (patch: Partial<CheckedCitation>): CheckedCitation => ({
  citation: "576 U.S. 644",
  normalized: "576 U.S. 644",
  kind: "case",
  status: "found",
  reason: "Found in the case-law database.",
  title: "Obergefell v. Hodges",
  court: "Supreme Court of the United States",
  date: "2015-06-26",
  clusterId: 2812209,
  url: "https://www.courtlistener.com/opinion/2812209/obergefell-v-hodges/",
  links: [
    {
      label: "Decision",
      url: "https://www.courtlistener.com/opinion/2812209/obergefell-v-hodges/",
    },
  ],
  httpStatus: 200,
  matches: [],
  ...patch,
});

const fixture: CitationCheck = {
  total: 4,
  counts: { found: 2, ambiguous: 0, not_found: 1, unverified: 1 },
  more: 0,
  checkedAt: "2026-10-22T23:00:00Z",
  items: [
    item({}),
    item({
      citation: "999 F.3d 99999",
      normalized: "999 F.3d 99999",
      status: "not_found",
      reason: "No decision with this citation in the case-law database.",
      title: null,
      court: null,
      date: null,
      clusterId: null,
      url: null,
      links: [],
      httpStatus: 404,
    }),
    item({
      citation: "21 C.F.R. § 101.9(c)",
      normalized: "21 C.F.R. § 101.9",
      kind: "cfr",
      reason: "In the current eCFR and the 2025 annual edition.",
      title: "§ 101.9 Nutrition labeling of food.",
      court: null,
      date: null,
      clusterId: null,
      url: "https://www.ecfr.gov/current/title-21/section-101.9",
      links: [
        { label: "eCFR (current)", url: "https://www.ecfr.gov/current/title-21/section-101.9" },
        { label: "2025 annual edition", url: "javascript:alert(1)" },
      ],
      httpStatus: 302,
    }),
    item({
      citation: "Pub. L. No. 88-352",
      normalized: "Pub. L. No. 88-352",
      kind: "public_law",
      status: "unverified",
      reason:
        "Not checked: the official link service covers public laws from the 104th Congress (1995) on.",
      title: null,
      court: null,
      date: null,
      clusterId: null,
      url: null,
      links: [],
      httpStatus: null,
    }),
  ],
};

const render = (check: CitationCheck, open = false) =>
  renderToStaticMarkup(createElement(CitationCheckLine, { check, defaultOpen: open }));

describe("citation check line", () => {
  it("shows a compact summary under the answer, collapsed by default", () => {
    const html = render(fixture);
    expect(html).toContain("4 citations checked");
    expect(html).toContain("1 not found");
    expect(html).toContain("1 could not be checked");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Obergefell v. Hodges");
  });

  it("lists every citation when expanded, problems first, with reasons and safe links", () => {
    const html = render(fixture, true);
    const order = ["999 F.3d 99999", "Pub. L. No. 88-352", "576 U.S. 644", "21 C.F.R. § 101.9"].map(
      (t) => html.indexOf(t),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("Not found");
    expect(html).toContain("Not checked");
    expect(html).toContain("No decision with this citation in the case-law database.");
    expect(html).toContain(
      "Obergefell v. Hodges · Supreme Court of the United States · 2015-06-26",
    );
    expect(html).toContain('href="https://www.ecfr.gov/current/title-21/section-101.9"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Found means the citation exists at the source checked");
  });

  it("shows ambiguous candidates, all-found and over-limit states", () => {
    const ambiguous = render(
      {
        ...fixture,
        total: 1,
        counts: { found: 0, ambiguous: 1, not_found: 0, unverified: 0 },
        items: [
          item({
            status: "ambiguous",
            normalized: "123 F. Supp. 456",
            title: null,
            matches: [
              {
                title: "Louis v. Steamboat Buckeye",
                court: "Ohio Superior Court, Cincinnati",
                date: "1854-06-15",
                clusterId: 8535319,
                url: "https://www.courtlistener.com/opinion/8535319/louis-v-steamboat-buckeye/",
              },
              {
                title: "Fell v. Parke",
                court: "Hawaii Supreme Court",
                date: "1854-10-15",
                clusterId: 6606131,
                url: "https://www.courtlistener.com/opinion/6606131/fell-v-parke/",
              },
            ],
          }),
        ],
      },
      true,
    );
    expect(ambiguous).toContain("1 citation checked");
    expect(ambiguous).toContain("1 ambiguous");
    expect(ambiguous).toContain("Fell v. Parke · Hawaii Supreme Court · 1854-10-15");
    const allFound = render({
      ...fixture,
      total: 2,
      counts: { found: 2, ambiguous: 0, not_found: 0, unverified: 0 },
      items: [fixture.items[0]!, fixture.items[2]!],
      more: 3,
    });
    expect(allFound).toContain("2 citations checked");
    expect(allFound).toContain("all found");
    expect(allFound).toContain("3 more not checked");
    expect(
      render({
        ...fixture,
        total: 0,
        items: [],
        counts: { found: 0, ambiguous: 0, not_found: 0, unverified: 0 },
      }),
    ).toBe("");
  });
});

describe("unresolved citations in the answer", () => {
  it("are marked where they appear and never removed; found citations stay plain", () => {
    const marks = citationMarks(fixture);
    expect(marks.map((m) => m.text)).toEqual(["999 F.3d 99999", "Pub. L. No. 88-352"]);
    const html = renderToStaticMarkup(
      createElement(AssistantMarkdown, {
        text: "Obergefell v. Hodges, 576 U.S. 644 (2015), and **Smith v. Jones, 999 F.3d 99999** (2021).\n\n- Civil Rights Act, Pub. L. No. 88-352",
        marks,
      }),
    );
    expect(html).toContain('data-citation-status="not_found"');
    expect(html).toContain('data-citation-status="unverified"');
    expect(html).toContain("999 F.3d 99999");
    expect(html).toContain("(citation not found)");
    expect(html).toContain(
      'title="Not found: No decision with this citation in the case-law database."',
    );
    expect(html.match(/data-citation-status/g)).toHaveLength(2);
    expect(html).toContain("576 U.S. 644 (2015)");
  });
});
