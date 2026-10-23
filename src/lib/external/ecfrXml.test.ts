import { describe, expect, it } from "vitest";
import fixtures from "./ecfrXml.fixtures.json";
import {
  assignDepths,
  collapse,
  decodeEntities,
  inline,
  letterNext,
  parseEcfrDocument,
  parseXml,
  romanValue,
  toRoman,
  type XmlNode,
} from "./ecfrXml";

const first = (xml: string): XmlNode =>
  parseXml(xml).children.find((c): c is XmlNode => typeof c !== "string")!;

describe("same output as the Python parser that built ecfr_sections_full", () => {
  for (const f of fixtures.fixtures) {
    it(f.name, () => {
      const got = parseEcfrDocument(f.xml).items;
      expect(got.map((i) => ({ ...i, n: i.n }))).toEqual(f.items);
    });
  }
});

describe("XML reader", () => {
  it("decodes character references and keeps unknown entities as written", () => {
    expect(decodeEntities("a &amp; b &#167; &#xA7; &thnsp; &lt;x&gt;")).toBe(
      "a & b § § &thnsp; <x>",
    );
  });
  it("reads attributes, self-closing tags, CDATA, comments and unclosed elements", () => {
    const root = parseXml(
      `<?xml version="1.0"?><!-- c --><A x="1" y='2'><B/>t<![CDATA[<raw>]]><C>u`,
    );
    const a = root.children[0] as XmlNode;
    expect(a.attrs).toEqual({ x: "1", y: "2" });
    expect(a.children.map((c) => (typeof c === "string" ? c : c.tag))).toEqual([
      "B",
      "t",
      "<raw>",
      "C",
    ]);
  });
  it("collapses whitespace like Python str.split", () => {
    expect(collapse("  a    b\n")).toBe("a b");
  });
});

describe("inline text", () => {
  it("maps super/subscripts, fractions and accents", () => {
    expect(
      inline(
        first(
          "<P>x<E T='51'>2</E> CO<E T='52'>2</E> V<E T='52'>CO</E> 8<FR>1/2</FR> 1<FR>1/16</FR></P>",
        ),
      ),
    ).toBe("x² CO₂ V_(CO) 8½ 1 1/16");
    expect(inline(first("<P><I>x\n<AC T='8'/></I> and <I>m\n<AC T='i'/></I></P>"))).toBe("x̄ and ṁ̅");
    expect(inline(first("<P>10<sup>−</sup>\n<sup>6</sup> i<E T='51'>th</E></P>"))).toBe("10⁻⁶ iᵗʰ");
    expect(inline(first("<P>Coliform (\n<sup>2</sup>) and KNO<E T='0732'>3</E></P>"))).toBe(
      "Coliform (²) and KNO₃",
    );
    expect(inline(first("<P>applicable\n<SU>1</SU> and V\n<SU>2</SU></P>"))).toBe(
      "applicable ¹ and V ²",
    );
  });
  it("collects graphics without adding text", () => {
    const images: string[] = [];
    expect(inline(first("<P>See <img src='/graphics/a.gif'/> here</P>"), images)).toBe("See here");
    expect(images).toEqual(["/graphics/a.gif"]);
  });
});

describe("paragraph depth", () => {
  const m = (...t: string[]) => t.map((x) => [[x, false] as [string, boolean]]);
  it("resolves letter or roman by context and lookahead", () => {
    expect(assignDepths(m("a", "1", "i", "ii"))).toEqual([0, 1, 2, 2]);
    expect(assignDepths(m("h", "1", "i", "j"))).toEqual([0, 1, 0, 0]);
    expect(assignDepths(m("1", "i", "ii", "iii", "iv", "v"))).toEqual([0, 1, 1, 1, 1, 1]);
    expect(assignDepths([[], [["1", false]]])).toEqual([null, 0]);
  });
  it("counts roman numerals and doubled letters", () => {
    expect(toRoman(14)).toBe("xiv");
    expect(romanValue("xiv")).toBe(14);
    expect(romanValue("iiii")).toBeNull();
    expect(letterNext("z")).toBe("aa");
    expect(letterNext("bb")).toBe("cc");
  });
});

describe("documents", () => {
  it("returns part notes and joins nothing across sections", () => {
    const xml = fixtures.fixtures.find((f) => f.name === "reserved_notes.xml")!.xml;
    const doc = parseEcfrDocument(xml);
    expect(doc.items.map((i) => i.n)).toEqual(["§ 99.11", "§ 99.12"]);
    expect(doc.partNotes.map((n) => n[0])).toEqual(["authority", "source", "source"]);
  });
  it("tolerates an empty or non-eCFR document", () => {
    expect(parseEcfrDocument("").items).toEqual([]);
    expect(parseEcfrDocument("<html><body>blocked</body></html>").items).toEqual([]);
  });
});
