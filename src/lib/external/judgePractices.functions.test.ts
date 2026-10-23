import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  bodyOf,
  courtUrl,
  coveragePath,
  documentSearchPath,
  ftsQuery,
  getCourtJudgeRoster,
  getJudgePractices,
  judgePagesPath,
  parseCoverage,
  parseDoc,
  parseHit,
  parseJudgePage,
  parseRosterJudge,
  rosterPath,
  searchJudgePracticeDocuments,
  snippet,
} from "./judgePractices.functions";

const PROFILE = "92939c72ebb7637b84f050e9ea0a4ab2";
const DOC = {
  id: "jpd-0123456789abcdef",
  title: "Individual Practices in Civil Cases",
  url: "https://www.nysd.uscourts.gov/sites/default/files/practice_documents/LJL%20Liman%20Individual%20Practices.pdf",
  date_text: "April 7th, 2025",
  date: "2025-04-07",
  file_type: "pdf",
  retrieved: true,
  attached_via: null,
};
// Shape of item.judge_page in a published judge_court_pages record.
const PAGE = {
  id: "nysd-lewis-j-liman",
  court_id: "nysd",
  court: "District Court, S.D. New York",
  level: "district",
  name: "Lewis J. Liman",
  name_as_published: "Hon. Lewis J. Liman",
  title_as_published: "United States District Judges",
  title_class: "district_judge",
  title_basis: "listing",
  page_url: "https://www.nysd.uscourts.gov/hon-lewis-j-liman",
  page_kind: "judge_page",
  retrieved_at: "2026-10-23T04:39:12Z",
  profile: { status: "linked", judge_id: PROFILE },
  documents: [DOC],
};

describe("courtUrl", () => {
  it("keeps addresses on a federal court's own site and drops everything else", () => {
    expect(courtUrl("https://www.nysd.uscourts.gov/hon-lewis-j-liman")).toContain(
      "nysd.uscourts.gov",
    );
    expect(courtUrl("https://apps.cacd.uscourts.gov/Jps/")).not.toBeNull();
    expect(courtUrl("https://uscourts.gov.evil.example/x")).toBeNull();
    expect(courtUrl("https://example.com/uscourts.gov/")).toBeNull();
    expect(courtUrl("javascript:alert(1)")).toBeNull();
    expect(courtUrl("https://user:pw@www.nysd.uscourts.gov/")).toBeNull();
  });
});

describe("parseDoc", () => {
  it("keeps the printed title and date and drops a bad id, address or ISO date", () => {
    const d = parseDoc(DOC)!;
    expect(d.title).toBe("Individual Practices in Civil Cases");
    expect(d.dateText).toBe("April 7th, 2025");
    expect(d.date).toBe("2025-04-07");
    expect(parseDoc({ ...DOC, id: "x" })).toBeNull();
    expect(parseDoc({ ...DOC, url: "https://example.com/a.pdf" })).toBeNull();
    expect(parseDoc({ ...DOC, date: "April 2025" })!.date).toBeNull();
  });
});

describe("parseJudgePage", () => {
  it("reads a judge's court page with its documents and profile link", () => {
    const p = parseJudgePage(PAGE)!;
    expect(p.name).toBe("Lewis J. Liman");
    expect(p.titleClass).toBe("district_judge");
    expect(p.profileId).toBe(PROFILE);
    expect(p.documents).toHaveLength(1);
  });

  it("never links a profile that is not a 32-character id, and never invents a title class", () => {
    expect(
      parseJudgePage({ ...PAGE, profile: { status: "linked", judge_id: "../../etc" } })!.profileId,
    ).toBeNull();
    expect(
      parseJudgePage({ ...PAGE, profile: { status: "linked", judge_id: "../../etc" } })!
        .profileStatus,
    ).toBe("unmatched");
    expect(parseJudgePage({ ...PAGE, title_class: "supreme_judge" })!.titleClass).toBe(
      "unclassified",
    );
    expect(
      parseJudgePage({ ...PAGE, profile: { status: "ambiguous", candidates: 2 } })!.profileStatus,
    ).toBe("ambiguous");
  });

  it("drops a record without a court-site page address, a known level or a valid id", () => {
    expect(parseJudgePage({ ...PAGE, page_url: "https://example.com/" })).toBeNull();
    expect(parseJudgePage({ ...PAGE, level: "appeals" })).toBeNull();
    expect(parseJudgePage({ ...PAGE, id: "Bad Id" })).toBeNull();
    expect(parseJudgePage(null)).toBeNull();
  });

  it("drops malformed documents but keeps the page", () => {
    const p = parseJudgePage({ ...PAGE, documents: [DOC, { ...DOC, id: "bad" }, 7, null] })!;
    expect(p.documents).toHaveLength(1);
  });
});

describe("parseRosterJudge and parseCoverage", () => {
  const R = {
    id: "nysd-katharine-h-parker",
    name: "Katharine H. Parker",
    name_as_published: "Hon. Katharine H. Parker",
    title: null,
    title_class: "magistrate_judge",
    documents: 13,
    documents_retrieved: 13,
    profile_id: null,
    profile_status: "unmatched",
    page_url: "https://www.nysd.uscourts.gov/hon-katharine-h-parker",
    page_kind: "judge_page",
  };
  it("keeps a magistrate judge with no profile and no printed title", () => {
    const j = parseRosterJudge(R)!;
    expect(j.title).toBeNull();
    expect(j.profileId).toBeNull();
    expect(j.documents).toBe(13);
    expect(parseRosterJudge({ ...R, page_url: "http://evil.example/x" })).toBeNull();
  });

  it("keeps where the title words were read", () => {
    expect(parseRosterJudge(R)!.titleSource).toBeNull();
    const listed = parseRosterJudge({
      ...R,
      title: "United States District Judges",
      title_source: "listing heading",
    })!;
    expect(listed.title).toBe("United States District Judges");
    expect(listed.titleSource).toBe("listing heading");
  });

  it("reads a coverage record and refuses one for another court", () => {
    const C = {
      court_id: "nysd",
      court: "District Court, S.D. New York",
      level: "district",
      site: "https://www.nysd.uscourts.gov/",
      status: "ok",
      note: null,
      judges: 65,
      judge_pages: 65,
      listing_entries: 0,
      documents: 322,
      profiles_linked: 42,
      profiles_not_linked: 23,
      listing_pages: [
        { url: "https://www.nysd.uscourts.gov/judges", status: 200, judges_found: 2 },
      ],
    };
    const c = parseCoverage(C, "nysd")!;
    expect(c.judges).toBe(65);
    expect(c.listingPages[0]!.judgesFound).toBe(2);
    expect(parseCoverage(C, "cand")).toBeNull();
  });
});

describe("queries", () => {
  it("scopes every read to the profile, court or judge pages asked for", () => {
    expect(judgePagesPath(PROFILE)).toContain("dataset=eq.judge_court_pages");
    expect(decodeURIComponent(judgePagesPath(PROFILE))).toContain(`{"judge":["${PROFILE}"]}`);
    expect(decodeURIComponent(rosterPath("nysd"))).toContain('{"court":["nysd"]}');
    expect(coveragePath("nysd")).toContain("id=eq.nysd");
  });

  it("builds a document search limited to the given judge pages with prefix terms", () => {
    const p = documentSearchPath(["nysd-lewis-j-liman"], "page limit reply")!;
    expect(p).toContain("dataset=eq.judge_practice_documents");
    expect(decodeURIComponent(p)).toContain('{"judge_page":["nysd-lewis-j-liman"]}');
    expect(decodeURIComponent(p)).toContain("page:*&limit:*&reply:*");
    expect(documentSearchPath([], "page")).toBeNull();
    expect(documentSearchPath(["a-bc"], "!!")).toBeNull();
    expect(ftsQuery("a b c d e f g h i j")!.split("&")).toHaveLength(8);
  });

  it("makes a one-line snippet around the first matching word", () => {
    const text =
      "Intro.\n\n" + "x ".repeat(100) + "Replies shall not exceed ten pages. " + "y ".repeat(100);
    const s = snippet(text, "replies pages");
    expect(s).toContain("Replies shall not exceed ten pages");
    expect(s).not.toContain("\n");
    expect(snippet("short text", "zzz")).toBe("short text");
  });

  it("parses a search hit and drops one without text or a court-site address", () => {
    const row = {
      id: DOC.id,
      title: DOC.title,
      text: "Reply memoranda shall not exceed ten pages.",
      d: {
        url: DOC.url,
        file_type: "pdf",
        judges: [{ id: PAGE.id, date_text: "April 7th, 2025" }],
      },
    };
    const h = parseHit(row, "reply pages")!;
    // the stored text starts with the record's id, title and subtitle: the snippet is taken from the document's own text
    const stored = parseHit(
      {
        ...row,
        sub: "Individual practices · PDF · nysd",
        text: `${DOC.id} ${DOC.title} Individual practices · PDF · nysd Reply memoranda shall not exceed ten pages.`,
      },
      "reply",
    )!;
    expect(stored.snippet).toBe("Reply memoranda shall not exceed ten pages.");
    expect(bodyOf("abc def", "abc", "def", null)).toBe("");
    expect(bodyOf("other text", "abc", "def", null)).toBe("other text");
    expect(bodyOf("abc def ghi", "abc", "def", null)).toBe("ghi");
    expect(h.judgePageIds).toEqual([PAGE.id]);
    expect(h.dateText).toBe("April 7th, 2025");
    expect(parseHit({ ...row, text: null }, "x")).toBeNull();
    expect(parseHit({ ...row, d: { ...row.d, url: "https://example.com/x" } }, "x")).toBeNull();
  });
});

describe("server functions", () => {
  it("returns only pages that name the requested profile", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({
      rows: [
        { id: PAGE.id, p: PAGE },
        {
          id: "nysd-other",
          p: { ...PAGE, id: "nysd-other", profile: { status: "linked", judge_id: "f".repeat(32) } },
        },
      ],
      total: null,
    });
    const r = await (
      getJudgePractices as unknown as (a: {
        data: { id: string };
      }) => Promise<{ pages: { id: string }[]; dropped: number }>
    )({ data: { id: PROFILE } });
    expect(r.pages.map((p) => p.id)).toEqual([PAGE.id]);
    expect(r.dropped).toBe(1);
  });

  it("returns the roster with its coverage and counts the entries it could not read", async () => {
    vi.mocked(restGet)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "a",
            r: {
              id: "nysd-a-b",
              name: "A B",
              title_class: "district_judge",
              page_url: "https://www.nysd.uscourts.gov/x",
              documents: 2,
            },
          },
          { id: "b", r: { id: "bad id" } },
        ],
        total: null,
      })
      .mockResolvedValueOnce({ rows: [], total: null });
    const r = await (
      getCourtJudgeRoster as unknown as (a: {
        data: { id: string };
      }) => Promise<{ judges: unknown[]; coverage: unknown; dropped: number }>
    )({ data: { id: "nysd" } });
    expect(r.judges).toHaveLength(1);
    expect(r.coverage).toBeNull();
    expect(r.dropped).toBe(1);
  });

  it("searches only the judge pages asked for", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [], total: 0 });
    const r = await (
      searchJudgePracticeDocuments as unknown as (a: {
        data: { pages: string[]; q: string; offset: number };
      }) => Promise<{ hits: unknown[] }>
    )({
      data: { pages: [PAGE.id], q: "page limit", offset: 0 },
    });
    expect(r.hits).toEqual([]);
    const path = vi.mocked(restGet).mock.calls.at(-1)![0];
    expect(decodeURIComponent(path)).toContain(`{"judge_page":["${PAGE.id}"]}`);
  });
});
