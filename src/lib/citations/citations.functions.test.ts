import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ rpcPostOptional: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: (v: (d: unknown) => unknown) => ({
      handler: (handler: (a: { data: unknown }) => unknown) => (a: { data: unknown }) =>
        handler({ data: v(a.data) }),
    }),
  }),
}));

import { rpcPostOptional } from "@/lib/external/rest.server";
import {
  getAuthorityProfile,
  getCitationMap,
  getCitedBy,
  getCoCitations,
  getDocumentCitations,
  getTopAuthorities,
} from "./citations.functions";
import { parseNode, targetHref } from "./graph";

type Fn<T> = (a: { data?: unknown }) => Promise<T>;
const call = async <T>(fn: unknown, data?: unknown) => (fn as Fn<T>)({ data });
const rpc = vi.mocked(rpcPostOptional);

const DOC = {
  id: "d_0123456789abcdef01234567",
  title: "MOTION to dismiss",
  filed_date: "2024-03-01",
  doc_type: "motion",
  court_id: "njd",
  mdl: "2738",
  source_url: "https://storage.courtlistener.com/x.pdf",
};
const TWOMBLY = {
  node: "caselaw/1",
  key: "case:550:U.S.:544",
  kind: "case",
  label: "550 U.S. 544",
  resolution: "resolved",
  reason: "exact_citation",
  target: { dataset: "caselaw", id: "1", title: "Bell Atlantic Corp. v. Twombly" },
  candidates: null,
};
const S1983 = {
  node: "us_code_sections/42:1983",
  key: "usc:42:1983",
  kind: "usc",
  label: "42 U.S.C. § 1983",
  resolution: "resolved",
  reason: "exact_section",
  target: { dataset: "us_code_sections", id: "42:1983", title: "42 U.S.C. § 1983" },
  candidates: null,
};
const FLA = {
  node: "key/state-stat:FL:stat:95.11",
  key: "state-stat:FL:stat:95.11",
  kind: "state_statute",
  label: "Fla. Stat. § 95.11",
  resolution: "unresolved",
  reason: "unresolved_target_missing",
  target: null,
  candidates: null,
};

afterEach(() => rpc.mockReset());

describe("graph helpers", () => {
  it("link a resolved record to its page on the site", () => {
    expect(targetHref("us_code_sections", "42:1983")).toBe("/law/uscode/42/1983");
    expect(targetHref("state_law", "VA:VAC:8.01-243")).toBe(
      "/law/codes/VA?view=inforce&sec=VA%3AVAC%3A8.01-243",
    );
    expect(targetHref("state_law", "not a section id")).toBeNull();
    expect(targetHref("ecfr_sections_full", "cfr:21:314.50")).toBe("/law/cfr/21/314.50");
    expect(targetHref("ecfr_sections_full", "cfr:21:part-11")).toBe("/law/cfr/21/part/11");
    expect(targetHref("federal_regulations_parts", "cfr:21:314")).toBe("/law/cfr/21/part/314");
    expect(targetHref("caselaw", "1")).toBe("/cases/1");
    expect(targetHref("court_rule_sections", "us-frcp:0020")).toBe(
      "/records/court_rule_sections/us-frcp%3A0020",
    );
    expect(targetHref("caselaw", "x")).toBeNull();
  });

  it("read authority nodes and refuse malformed ones", () => {
    expect(parseNode(TWOMBLY)).toMatchObject({
      node: "caselaw/1",
      target: { href: "/cases/1", title: "Bell Atlantic Corp. v. Twombly" },
    });
    expect(parseNode(FLA)).toMatchObject({
      resolution: "unresolved",
      target: null,
      reason: "unresolved_target_missing",
    });
    expect(parseNode({ ...TWOMBLY, kind: "made_up" })).toBeNull();
    expect(parseNode(null)).toBeNull();
  });
});

describe("getCitationMap", () => {
  it("sends the MDL and limits and keeps only links between returned nodes", async () => {
    rpc.mockResolvedValueOnce({
      mdl: "2738",
      kinds: null,
      documents_total: 40,
      documents_citing: 30,
      truncated: true,
      nodes: [
        { ...TWOMBLY, id: "caselaw/1", type: "authority", documents: 12, mentions: 30 },
        { ...S1983, id: "us_code_sections/42:1983", type: "authority", documents: 3, mentions: 3 },
        { id: `documents/${DOC.id}`, type: "document", authorities: 2, document: DOC },
      ],
      links: [
        { source: `documents/${DOC.id}`, target: "caselaw/1", mentions: 4 },
        { source: `documents/${DOC.id}`, target: "us_code_sections/42:1983", mentions: 1 },
        { source: "documents/d_ffffffffffffffffffffffff", target: "caselaw/1", mentions: 1 },
      ],
    });
    const r = await call<Awaited<ReturnType<typeof getCitationMap>>>(getCitationMap, {
      mdl: "2738",
    });
    expect(rpc).toHaveBeenCalledWith("citations_map_v2", {
      p_mdl: "2738",
      p_kinds: null,
      p_authorities: 40,
      p_documents: 60,
    });
    expect(r.available).toBe(true);
    if (!r.available || !r.value) throw new Error("no map");
    expect(r.value.authorities.map((a) => [a.node, a.documents, a.target?.href])).toEqual([
      ["caselaw/1", 12, "/cases/1"],
      ["us_code_sections/42:1983", 3, "/law/uscode/42/1983"],
    ]);
    expect(r.value.documents[0]).toMatchObject({
      node: `documents/${DOC.id}`,
      authorities: 2,
      courtId: "njd",
    });
    expect(r.value.links).toHaveLength(2);
    expect(r.value.truncated).toBe(true);
  });

  it("answers available:false until the contract is applied, and rejects bad input", async () => {
    rpc.mockResolvedValue(null);
    expect(await call(getCitationMap, { mdl: "3999" })).toEqual({ available: false });
    await expect(call(getCitationMap, { mdl: "0" })).rejects.toThrow();
    await expect(call(getCitationMap, { mdl: "2738", kinds: ["mdl"] })).rejects.toThrow();
  });
});

describe("document, cited-by, profile, top, co-citation", () => {
  it("reads the citations of one filing", async () => {
    rpc.mockResolvedValueOnce({
      document: DOC,
      text_served: true,
      pages_extracted: 12,
      extractor_versions: ["citations-v2/2026-10-25.2"],
      total_authorities: 2,
      by_kind: { case: 1, state_statute: 1 },
      by_resolution: { resolved: 1, unresolved: 1 },
      short_forms_unlinked: 3,
      authorities: [
        {
          ...TWOMBLY,
          relation: "cites",
          mentions: 5,
          full_mentions: 1,
          short_mentions: 4,
          first_page: 2,
          pages: [2, 3],
          pins: ["555", "570"],
        },
        {
          ...FLA,
          relation: "cites",
          mentions: 1,
          full_mentions: 1,
          short_mentions: 0,
          first_page: 7,
          pages: [7],
          pins: [],
        },
      ],
    });
    const r = await call<Awaited<ReturnType<typeof getDocumentCitations>>>(getDocumentCitations, {
      id: DOC.id,
    });
    if (!r.available || !r.value) throw new Error("no document");
    expect(r.value.authorities[0]).toMatchObject({
      shortMentions: 4,
      pins: ["555", "570"],
      pages: [2, 3],
    });
    expect(r.value.byResolution).toEqual({ resolved: 1, unresolved: 1 });
    expect(r.value.shortFormsUnlinked).toBe(3);
  });

  it("tells a filing the layer does not serve from a missing contract", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "citations_status_v2" ? { occurrences: 0 } : null,
    );
    expect(await call(getDocumentCitations, { id: "d_aaaaaaaaaaaaaaaaaaaaaaaa" })).toEqual({
      available: true,
      value: null,
    });
  });

  it("pages the citing filings of a record and validates the target", async () => {
    rpc.mockResolvedValueOnce({
      authority: TWOMBLY,
      keys: ["case:550:U.S.:544", "case:127:S. Ct.:1955"],
      documents: 31,
      mentions: 80,
      by_mdl: [
        ["2738", 20],
        ["3166", 11],
      ],
      by_court: [["njd", 20]],
      by_year: [
        [2021, 4],
        [2022, 27],
      ],
      undated: 0,
      list: [{ ...DOC, mentions: 4, first_page: 2, pins: ["555"] }],
    });
    const r = await call<Awaited<ReturnType<typeof getCitedBy>>>(getCitedBy, {
      dataset: "caselaw",
      id: "1",
      page: 2,
      limit: 10,
    });
    expect(rpc).toHaveBeenCalledWith("citations_cited_by_v2", {
      p_key: null,
      p_dataset: "caselaw",
      p_id: "1",
      p_limit: 10,
      p_offset: 10,
    });
    if (!r.available || !r.value) throw new Error("no cited-by");
    expect(r.value.byMdl).toEqual([
      ["2738", 20],
      ["3166", 11],
    ]);
    expect(r.value.list[0]).toMatchObject({ id: DOC.id, mentions: 4, firstPage: 2 });
    await expect(
      call(getCitedBy, { key: "case:550:U.S.:544", dataset: "caselaw", id: "1" }),
    ).rejects.toThrow();
    await expect(call(getCitedBy, {})).rejects.toThrow();
  });

  it("reads a profile with co-cited authorities", async () => {
    rpc.mockResolvedValueOnce({
      authority: S1983,
      keys: ["usc:42:1983"],
      documents: 2,
      mentions: 3,
      by_mdl: [],
      by_court: [],
      by_year: [],
      undated: 1,
      list: [],
      co_cited: [{ ...TWOMBLY, documents_together: 2 }],
      occurrences: 9,
      first_filed: "2021-05-04",
      last_filed: null,
    });
    const r = await call<Awaited<ReturnType<typeof getAuthorityProfile>>>(getAuthorityProfile, {
      key: "usc:42:1983",
    });
    if (!r.available || !r.value) throw new Error("no profile");
    expect(r.value.coCited[0]).toMatchObject({ node: "caselaw/1", documentsTogether: 2 });
    expect([r.value.firstFiled, r.value.lastFiled, r.value.occurrences]).toEqual([
      "2021-05-04",
      null,
      9,
    ]);
  });

  it("reads top authorities and co-citation pairs", async () => {
    rpc.mockResolvedValueOnce({
      mdl: "2738",
      kind: "case",
      documents_with_citations: 20,
      authorities: [{ ...TWOMBLY, documents: 12, mentions: 30, first_year: 2017, last_year: 2024 }],
    });
    const top = await call<Awaited<ReturnType<typeof getTopAuthorities>>>(getTopAuthorities, {
      mdl: "2738",
      kind: "case",
    });
    if (!top.available || !top.value) throw new Error("no top");
    expect(top.value.authorities[0]).toMatchObject({
      firstYear: 2017,
      lastYear: 2024,
      documents: 12,
    });
    rpc.mockResolvedValueOnce({
      mdl: "2738",
      documents: 20,
      pairs: [{ a: TWOMBLY, b: S1983, documents_together: 5 }],
    });
    const co = await call<Awaited<ReturnType<typeof getCoCitations>>>(getCoCitations, {
      mdl: "2738",
    });
    if (!co.available || !co.value || co.value.mode !== "mdl") throw new Error("no pairs");
    expect(co.value.pairs[0]!.documentsTogether).toBe(5);
    await expect(call(getCoCitations, { mdl: "2738", key: "usc:42:1983" })).rejects.toThrow();
  });
});
