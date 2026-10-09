import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { SectionReadout } from "./SectionReadout";
import type { SectionFields } from "@/lib/law/stateCodeContract";
const fields = {
  citation: "Example § 12",
  heading: "Limitation of actions",
  history: "Amended in the source edition.",
  edition: "Example edition",
  currency: null,
  sourceUrl: "https://example.gov/section/12",
  text: "(a) The first paragraph.\n\n(b) The second paragraph.",
  status: null,
} as SectionFields;
const render = (patch: Partial<SectionFields> = {}) =>
  renderToStaticMarkup(createElement(SectionReadout, { fields: { ...fields, ...patch } }));
describe("text-first statute reader", () => {
  it("places the actual provision before optional source-version details", () => {
    const html = render();
    expect(html.indexOf("The first paragraph")).toBeLessThan(html.indexOf("Example edition"));
    expect(html).toContain("Source &amp; version");
  });
  it("preserves paragraphs without removing repeated statutory words", () => {
    const html = render({ text: "A repeated clause.\n\nA repeated clause." });
    expect(html.match(/A repeated clause\./g)).toHaveLength(2);
  });
  it("keeps the publisher's repeal or other status visible", () => {
    expect(render({ status: "Repealed" })).toContain("Repealed");
  });
  it("does not turn a source URI into executable navigation", () => {
    expect(render({ sourceUrl: "javascript:alert(1)" })).not.toContain('href="javascript:');
  });
  it("does not fabricate missing history, heading or edition", () => {
    const html = render({ heading: null, history: null, edition: null, currency: null });
    expect(html).toContain("Example § 12");
    expect(html).not.toContain("Amended in");
    expect(html).not.toContain("History / source note");
  });
});
