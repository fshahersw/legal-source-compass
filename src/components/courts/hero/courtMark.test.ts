import { describe, expect, it } from "vitest";
import { recordedSystemAndType, resolveCourtMark } from "./courtMark";

describe("resolveCourtMark", () => {
  it("uses the verified official artwork for its exact federal court id", () => {
    const mark = resolveCourtMark("cand", "Federal", "Federal district");
    expect(mark.kind).toBe("verified");
    if (mark.kind === "verified") {
      expect(mark.src).toBe("/court-marks/cand.svg");
      expect(mark.sourcePage).toBe("https://cand.uscourts.gov/");
    }
  });

  it("never gives a state court the federal registration of a colliding id", () => {
    expect(resolveCourtMark("cand", "State", "State trial").kind).not.toBe("verified");
  });

  it("falls back to a labelled court-type emblem, never a seal, when nothing is registered", () => {
    const mark = resolveCourtMark("no-such-court", "State", "State trial (ST)");
    expect(mark.kind).toBe("type");
    expect(mark.group).toBe("state-trial");
    expect(mark.description).toBe("State trial court");
  });

  it("uses a stored court image only from a recorded seal or image link", () => {
    const mark = resolveCourtMark("no-such-court", "State", "State trial", [
      { url: "/files/seal.png", label: "Court seal" },
    ]);
    expect(mark.kind).toBe("recorded");
  });

  it("describes a stored identity-mark image without the earlier permission note", () => {
    const mark = resolveCourtMark("no-such-court", "Federal", "Federal district", [
      {
        url: "/supplement-files/court_spine/logo_0285f97dee8bc066",
        label: "Identity mark image (reuse permission not established)",
      },
    ]);
    expect(mark.kind).toBe("recorded");
    expect(mark.description).toBe("Identity mark image");
  });
});

describe("recordedSystemAndType", () => {
  it("reads system and type the way the court page does", () => {
    expect(
      recordedSystemAndType({
        cells: { system: "Federal" },
        subtitle: "Federal district · N.D. Cal.",
      }),
    ).toEqual({ system: "Federal", type: "Federal district" });
    expect(recordedSystemAndType(null)).toEqual({ system: "Unknown system", type: "Court" });
  });
});
