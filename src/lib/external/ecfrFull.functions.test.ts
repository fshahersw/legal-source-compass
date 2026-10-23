import { beforeEach, describe, expect, it, vi } from "vitest";

const { rest } = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("./rest.server", () => ({ restGet: rest }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { getCfrCollection, getCfrPart, getCfrSection, readAsOf } from "./ecfrFull.functions";

type Fn<I, O> = (a: { data: I }) => Promise<O>;
const call = <I, O>(fn: unknown, data: I) => (fn as Fn<I, O>)({ data });

const sectionRow = {
  id: "cfr:21:314.70",
  title: "21 CFR 314.70 Supplements.",
  source_url: "https://www.govinfo.gov/bulkdata/ECFR/title-21/ECFR-title21.xml",
  text: "(a) First.",
  detail: {
    kind: "section",
    title_number: "21",
    identifier: "314.70",
    as_of: "2026-10-21",
    layout: [["p", 0]],
    notes: [],
  },
};
const versionsRow = {
  id: "cfr:21:314.70",
  detail: { kind: "section", versions: [{ date: "2024-03-13", substantive: true }] },
};

beforeEach(() => rest.mockReset());

describe("getCfrSection", () => {
  it("reads the full-text row and its history", async () => {
    rest.mockImplementation(async (p?: string) => ({
      rows: String(p).includes("ecfr_section_versions")
        ? [versionsRow]
        : String(p).includes("ecfr_sections_full")
          ? [sectionRow]
          : [],
      total: null,
    }));
    const r = await call<object, { status: string; history: { versions: unknown[] } | null }>(
      getCfrSection,
      {
        title: "21",
        identifier: "314.70",
        part: null,
      },
    );
    expect(r.status).toBe("ok");
    expect(r.history!.versions).toHaveLength(1);
    expect(rest.mock.calls[0]![0]).toContain("id=eq.cfr%3A21%3A314.70");
  });
  it("tries the part-qualified id first for appendices printed in several parts", async () => {
    rest.mockResolvedValue({ rows: [], total: null });
    await call(getCfrSection, {
      title: "14",
      identifier: "Special Federal Aviation Regulation No. 97",
      part: "91",
    });
    const paths = rest.mock.calls.map((c) => c[0] as string);
    expect(
      paths.some((p) =>
        p.includes(encodeURIComponent("cfr:14:Special Federal Aviation Regulation No. 97@part-91")),
      ),
    ).toBe(true);
  });
  it("falls back to the older partial text, then reports not found", async () => {
    rest.mockImplementation(async (p?: string) => ({
      rows: String(p).includes("dataset=eq.ecfr_section_text")
        ? [
            {
              title: "§ 314.70",
              text: "Old text",
              detail: { facts: [["Text as of", "2026-10-02"]] },
            },
          ]
        : [],
      total: null,
    }));
    const r = await call<object, { status: string; fallback: { dataset: string; asOf: string } }>(
      getCfrSection,
      {
        title: "21",
        identifier: "314.70",
        part: null,
      },
    );
    expect(r.status).toBe("fallback");
    expect(r.fallback).toMatchObject({ dataset: "ecfr_section_text", asOf: "2026-10-02" });
    rest.mockResolvedValue({ rows: [], total: null });
    const nf = await call<object, { status: string }>(getCfrSection, {
      title: "21",
      identifier: "314.70",
      part: null,
    });
    expect(nf.status).toBe("not_found");
  });
});

describe("getCfrPart", () => {
  it("pages through the part's rows in printed order and drops malformed ones", async () => {
    const item = (n: number) => ({
      id: `cfr:40:60.${n}`,
      title: `40 CFR 60.${n} X.`,
      c: { kind: "section", identifier: `60.${n}`, part: "60" },
    });
    rest.mockImplementation(async (p?: string, opts?: { range?: [number, number] }) => {
      if (String(p).includes("id=eq.")) return { rows: [], total: null };
      const start = opts?.range?.[0] ?? 0;
      const rows =
        start === 0 ? Array.from({ length: 1000 }, (_, k) => item(k)) : [item(1000), { id: "bad" }];
      return { rows, total: null };
    });
    const r = await call<
      object,
      { items: unknown[]; dropped: number; truncated: boolean; part: unknown }
    >(getCfrPart, {
      title: "40",
      part: "60",
    });
    expect(r.items).toHaveLength(1001);
    expect(r.dropped).toBe(1);
    expect(r.truncated).toBe(false);
    expect(r.part).toBeNull();
    expect(rest.mock.calls.find((c) => !(c[0] as string).includes("id=eq."))![0]).toContain(
      "order=ordinal.asc",
    );
  });
});

describe("getCfrCollection", () => {
  it("reads the catalog listing's title options", async () => {
    rest.mockResolvedValue({
      rows: [
        {
          ready: true,
          metadata: {
            listing: {
              filters: [
                {
                  name: "title",
                  options: [
                    { value: "21", label: "Title 21 — Food and Drugs", count: 8707 },
                    { value: "x", label: "bad" },
                  ],
                },
              ],
            },
            summary: { up_to_date_as_of: ["2026-10-21"] },
          },
        },
      ],
      total: null,
    });
    const r = await (
      getCfrCollection as unknown as () => Promise<{
        titles: { name: string }[];
        upToDateAsOf: string[];
      }>
    )();
    expect(r.titles).toEqual([{ title: "21", name: "Food and Drugs", rows: 8707 }]);
    expect(r.upToDateAsOf).toEqual(["2026-10-21"]);
  });
});

describe("readAsOf (live eCFR)", () => {
  const args = {
    title: "21",
    identifier: "314.70",
    kind: "section" as const,
    part: "314",
    date: "2020-01-01",
  };
  const xml = `<?xml version="1.0"?><ECFR><DIV5 N="314" TYPE="PART"><AUTH><HED>Authority:</HED><PSPACE>21 U.S.C. 355.</PSPACE></AUTH><DIV8 N="314.70" TYPE="SECTION"><HEAD>§ 314.70 Supplements.</HEAD><P>(a) Old text.</P><CITA TYPE="N">[50 FR 7493]</CITA></DIV8></DIV5></ECFR>`;
  const fetcher = (status: number, body = "", headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch;

  it("parses the text, notes and part notes", async () => {
    const f = fetcher(200, xml);
    const r = await readAsOf(args, f);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.blocks).toEqual([{ kind: "p", depth: 0, flag: "", text: "(a) Old text." }]);
    expect(r.notes.map((n) => n.kind)).toEqual(["source"]);
    expect(r.partNotes.map((n) => n.text)).toEqual(["Authority: 21 U.S.C. 355."]);
    expect((f as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0]).toBe(
      "https://www.ecfr.gov/api/versioner/v1/full/2020-01-01/title-21.xml?part=314&section=314.70",
    );
  });
  it("reports not found, unavailable, too large and network failure", async () => {
    expect((await readAsOf(args, fetcher(404))).status).toBe("not_found");
    expect((await readAsOf(args, fetcher(503))).status).toBe("unavailable");
    expect(
      (await readAsOf(args, fetcher(200, "x", { "content-length": String(30 * 1024 * 1024) })))
        .status,
    ).toBe("too_large");
    expect((await readAsOf(args, fetcher(200, "<ECFR></ECFR>"))).status).toBe("not_found");
    const broken = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect((await readAsOf(args, broken)).status).toBe("unavailable");
  });
});
