import { describe, expect, it } from "vitest";
import goldens from "../fixtures/enforcement-text-goldens.json";
import * as E from "./enforcementText.ts";
import { htmlUnescape } from "./pyHtml.ts";

type Case = {
  kind: "doj" | "sec";
  uuid?: string;
  url?: string;
  body?: string;
  raw_title?: string;
  title: string | null;
  text: string;
  date: string | null;
  out: Record<string, unknown>;
};
const cases = (goldens as unknown as { cases: Case[] }).cases;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

describe("enforcement text port equals extract.py on real releases (goldens.py)", () => {
  it.each(cases.map((c) => [c.uuid ?? c.url ?? "?", c] as const))("%s", (_id, c) => {
    if (c.kind === "doj") {
      expect(E.htmlToText(c.body)).toBe(c.text);
      expect(E.cleanTitle(c.raw_title)).toBe(c.title);
    }
    const t = c.text;
    const spans = E.sentenceSpans(t);
    expect(spans.map(([a, b]) => [E.cpIndex(t, a), E.cpIndex(t, b)])).toEqual(c.out["spans"]);
    const amounts = E.extractAmounts(t, spans);
    expect(plain(amounts)).toEqual(c.out["amounts"]);
    expect(plain(E.extractStatutes(t))).toEqual(c.out["statutes"]);
    expect(plain(E.extractDockets(t))).toEqual(c.out["dockets"]);
    expect(plain(E.extractCourts(t))).toEqual(c.out["courts"]);
    expect(plain(E.extractCourtCites(t))).toEqual(c.out["court_cites"]);
    expect(plain(E.titleParties(c.title, t))).toEqual(c.out["parties"]);
    expect(plain(E.titleFigures(c.title))).toEqual(c.out["title_figures"]);
    expect(plain(E.headlineFigure(c.title, amounts, c.date, c.kind === "sec" ? 6 : 2))).toEqual(
      c.out["headline"],
    );
    expect(E.clip(t, 1500)).toEqual(c.out["clip_1500"]);
    expect(E.clip(t, 900)).toEqual(c.out["clip_900"]);
    expect(
      amounts.filter((a) => a.value_usd !== undefined).map((a) => E.moneyLabel(a.value_usd)),
    ).toEqual(c.out["money_labels"]);
    expect(
      E.verifySpans(t, [
        ...amounts,
        ...E.extractStatutes(t),
        ...E.extractDockets(t),
        ...E.extractCourts(t),
      ]),
    ).toBe(c.out["verify"]);
  });
});

describe("Python details", () => {
  it("rounds half to even on the exact binary value", () => {
    expect(E.pyRoundStr(2.675, 2)).toBe("2.67"); // 2.67499999... in binary
    expect(E.pyRoundStr(1.125, 2)).toBe("1.12"); // exact tie → even
    expect(E.pyRoundStr(1.135, 2)).toBe("1.14");
    expect(E.pyFormatGrouped(1234567.5, 0)).toBe("1,234,568");
    expect(E.pyFormatGrouped(2500000.5, 0)).toBe("2,500,000");
    expect(E.moneyLabel(1_125_000_000)).toBe("$1.12 billion");
    expect(E.moneyLabel(425000)).toBe("$425,000");
    expect(E.moneyLabel(1234.5)).toBe("$1,234.50");
  });
  it("unescapes HTML like Python", () => {
    expect(
      htmlUnescape("AT&amp;T &ldquo;x&rdquo; &#8217; &#x2019; &copy2026 &notit; &#128; &#0;"),
    ).toBe("AT&T “x” ’ ’ ©2026 ¬it; € �");
  });
  it("reads a case-sensitive abbreviation inside a case-insensitive figure", () => {
    const a = E.extractAmounts("They paid $2.8M and $9 M, then $300 K Street, and $5 Million.");
    expect(a.map((x) => [x.as_written, x.value_usd])).toEqual([
      ["$2.8M", 2800000],
      ["$9 M", 9000000],
      ["$300", 300],
      ["$5 Million", 5000000],
    ]);
  });
  it("normalises company names to exact keys", () => {
    expect(E.normalizeCompany("SEALED AIR CORP/DE")).toBe("sealed air");
    expect(E.normalizeCompany("The Procter & Gamble Company")).toBe("procter and gamble");
    const c = new E.Companies([
      ["0000080424", "PROCTER & GAMBLE Co"],
      ["0000000001", "ACME INC"],
      ["0000000002", "Acme Corporation"],
    ]);
    expect(c.match("Procter & Gamble Co.")?.cik).toBe("0000080424");
    expect(c.match("Acme, Inc.")).toBeNull(); // two registrants share the key
  });
});
