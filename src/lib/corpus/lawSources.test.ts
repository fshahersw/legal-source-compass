import { describe, expect, it } from "vitest";
import { buildStateLawDirectory, stateCodeLink } from "./lawSources";

describe("law source directory", () => {
  it("prefers an official code link over a generic legislature link", () => {
    expect(
      stateCodeLink([
        {
          section: "Legislature and Laws",
          label: "Legislature",
          url: "https://example.gov/",
        },
        {
          section: "Legislature and Laws",
          label: "Revised Statutes",
          url: "https://codes.example.gov/",
        },
        {
          section: "Legislature and Laws",
          label: "Revised Code",
          url: "https://lexis.example.com/",
        },
      ]),
    ).toEqual({ label: "Revised Statutes", url: "https://codes.example.gov/" });
  });

  it("deduplicates jurisdiction and source rows while retaining distinct authorities", () => {
    const result = buildStateLawDirectory(
      {
        retrievedAt: "2026-10-02T06:00:00Z",
        states: [
          {
            code: "NC",
            name: "North Carolina",
            sourceUrl: "https://www.justice.gov/state/nc",
            links: [
              {
                section: "Legislature and Laws",
                label: "General Statutes",
                url: "https://www.ncleg.gov/EnactedLegislation/Statutes/",
              },
            ],
          },
          {
            code: "nc",
            name: "Duplicate North Carolina",
            sourceUrl: "https://www.justice.gov/state/nc",
            links: [],
          },
        ],
      },
      {
        sources: [
          {
            id: "nc-1-52",
            state: "NC",
            title: "G.S. § 1-52",
            url: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_1/GS_1-52.html",
            textPath: "/data/limitations/text/nc-1-52.txt",
            capturedAt: "2026-10-02T08:30:41Z",
            authorityKind: "statute",
          },
          {
            id: "nc-1-52",
            state: "NC",
            title: "G.S. § 1-52",
            url: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_1/GS_1-52.html",
            textPath: "/data/limitations/text/nc-1-52.txt",
            capturedAt: "2026-10-02T08:30:41Z",
            authorityKind: "statute",
          },
          {
            id: "nc-act-2024",
            state: "NC",
            title: "Session law amendment",
            url: "https://www.ncleg.gov/EnactedLegislation/SessionLaws/HTML/2024-100.html",
            textPath: "/data/limitations/text/nc-act-2024.txt",
            capturedAt: "2026-10-02T08:30:41Z",
            authorityKind: "statute",
          },
          {
            id: "nc-rule",
            state: "NC",
            title: "Rule 1",
            url: "https://www.ncleg.gov/rules",
            textPath: "/data/limitations/text/nc-rule.txt",
            capturedAt: "2026-10-02T08:30:41Z",
            authorityKind: "court_rule",
          },
        ],
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.codeLink?.label).toBe("General Statutes");
    expect(result[0]?.capturedSources).toHaveLength(2);
    expect(result[0]?.capturedSources[0]?.id).toBe("nc-1-52");
    expect(result[0]?.capturedSources[1]?.id).toBe("nc-act-2024");
  });
});
