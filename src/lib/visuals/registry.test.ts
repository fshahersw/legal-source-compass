import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import registry from "./registry.json";
import { STATES } from "@/lib/corpus/geo";
import { agencyArtwork, communityCourtArtwork, stateArtwork, stateFlag } from "./registry";

describe("source-bound local atlas artwork", () => {
  it("contains exactly the canonical 50 states and District of Columbia", () => {
    expect(Object.keys(registry.states).sort()).toEqual(STATES.map((s) => s.usps).sort());
    for (const state of STATES) {
      const image = (registry.states as Record<string, { name: string; kind: string }>)[
        state.usps
      ]!;
      expect(image.name).toBe(state.name);
      expect(image.kind).toBe("geographic-outline");
    }
  });
  it("ships only locally verified bytes, with provenance and licensing", () => {
    for (const asset of [
      ...Object.values(registry.states),
      ...Object.values(registry.agencies),
      ...Object.values(registry.courts),
      ...Object.values(registry.stateCourts),
      ...Object.values(registry.flags),
    ]) {
      expect(asset.path).toMatch(/^\/visuals\/[a-z-]+\/[A-Za-z0-9_-]+\.(svg|png)$/);
      expect(asset.source).toMatch(/^https:\/\//);
      expect(asset.license.length).toBeGreaterThan(10);
      const body = readFileSync(resolve("public", asset.path.slice(1)));
      expect(createHash("sha256").update(body).digest("hex")).toBe(asset.sha256);
      if (asset.path.endsWith(".svg"))
        expect(body.toString("utf8")).not.toMatch(
          /<script|foreignObject|\son[a-z]+\s*=|javascript:/i,
        );
    }
  });
  it("never substitutes Nevada artwork for Nebraska", () => {
    expect(stateArtwork("Nebraska")?.path).toBe(registry.states.NE.path);
    expect(stateArtwork("Nevada")?.path).toBe(registry.states.NV.path);
    expect(stateArtwork("unknown")).toBeNull();
    expect(registry.states.NE.sha256).not.toBe(registry.states.NV.sha256);
    expect(readFileSync(resolve("public", registry.states.NE.path.slice(1)), "utf8")).toContain(
      "Nebraska geographic outline",
    );
  });
  it("does not fuzzy-match an agency name or lend a federal mark to a state court", () => {
    expect(agencyArtwork(" Food and Drug Administration ")?.name).toBe(
      "Food and Drug Administration",
    );
    expect(agencyArtwork("Food and Drug Administration Advisory Panel")).toBeNull();
    expect(communityCourtArtwork(Object.keys(registry.courts)[0]!, "State")).toBeNull();
    expect(communityCourtArtwork("unrecorded", "Federal")).toBeNull();
    const stateCourt = Object.keys(registry.stateCourts)[0]!;
    expect(communityCourtArtwork(stateCourt, "State")?.path).toBe(
      (registry.stateCourts as Record<string, { path: string }>)[stateCourt]!.path,
    );
    expect(communityCourtArtwork(stateCourt, "Federal")).toBeNull();
  });
  it("has one flag per state and DC, keyed to that exact state", () => {
    expect(Object.keys(registry.flags).sort()).toEqual(STATES.map((s) => s.usps).sort());
    expect(stateFlag("Nebraska")?.name).toBe("Nebraska");
    expect(stateFlag("Nevada")?.name).toBe("Nevada");
    expect(stateFlag("Georgia")?.name).toBe("Georgia");
    expect(stateFlag("unknown")).toBeNull();
  });
});
