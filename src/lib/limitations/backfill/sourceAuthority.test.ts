import { describe, expect, it } from "vitest";
import { reuseSourceAuthority } from "./sourceAuthority";

describe("reused source classification", () => {
  it("preserves an explicit judicial classification on repeat references", () => {
    const source = { id: "opinion", authorityKind: "judicial_opinion" as const };
    expect(reuseSourceAuthority(source, "opinion", "judicial_opinion")).toBe("opinion");
    expect(() => reuseSourceAuthority(source, "opinion", "statute")).toThrow(/kind conflict/);
    expect(source.authorityKind).toBe("judicial_opinion");
  });
  it("rejects missing seeded sources and contradictory declarations", () => {
    expect(() => reuseSourceAuthority(undefined, "missing-seed", "statute")).toThrow(
      /not present in the base bundle/,
    );
    expect(() =>
      reuseSourceAuthority(
        { id: "statute", authorityKind: "statute" },
        "statute",
        "judicial_opinion",
      ),
    ).toThrow(/kind conflict/);
  });
});
