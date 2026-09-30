import { describe, expect, it } from "vitest";
import { formatLawText, markerDepth } from "./formatLawText";

// Opening of the stored text of Cal. R. Ct. 10.1 (corpus record oul:15cb3fd9…).
const RULE = "(a) The Judicial Council (1) The Judicial Council of California is a state entity established by the California Constitution and chaired by the Chief Justice of California. The Judicial Council sets the direction. (2) The council establishes policies and sets priorities for the judicial branch of government. (3) The Judicial Council Governance Policies are located in Appendix D of these rules of court.";

describe("formatLawText", () => {
  it("splits at subsection markers without losing text", () => {
    const p = formatLawText(RULE);
    expect(p.length).toBe(4);
    expect(p[0]).toBe("(a) The Judicial Council");
    expect(p[1]!.startsWith("(1) The Judicial Council of California")).toBe(true);
    expect(p.join(" ")).toBe(RULE.replace(/\s+/g, " ").trim());
  });
  it("leaves in-sentence references alone and handles empty text", () => {
    expect(formatLawText("as provided in subdivision (b) of this rule.")).toHaveLength(1);
    expect(formatLawText("   ")).toEqual([]);
  });
  it("indents by marker type", () => {
    expect([markerDepth("(a) x"), markerDepth("(1) x"), markerDepth("(A) x"), markerDepth("(iv) x"), markerDepth("x")]).toEqual([0, 1, 2, 3, 0]);
  });
});
