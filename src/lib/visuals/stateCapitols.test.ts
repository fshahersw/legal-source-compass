import { describe, expect, it } from "vitest";
import { state_capitol_images } from "./fixtures/rows";
import { capitolCaption, parseStateCapitol } from "./stateCapitols";

const photo = state_capitol_images[0]!.item["photo"] as Record<string, unknown>;

describe("parseStateCapitol", () => {
  it("keeps the fixture photograph and builds the caption from what is recorded", () => {
    const p = parseStateCapitol("AL", photo)!;
    expect(p.building).toBe("Alabama State Capitol");
    expect(p.author).toBe("DXR");
    expect(capitolCaption(p, "Alabama")).toBe("Alabama State Capitol");
    expect(capitolCaption({ ...p, city: "Montgomery" }, "Alabama")).toBe(
      "Alabama State Capitol · Montgomery, Alabama",
    );
  });

  it("drops a lowercase or unknown-shape state id, a missing building and a malformed city", () => {
    expect(parseStateCapitol("al", photo)).toBeNull();
    expect(parseStateCapitol("ALA", photo)).toBeNull();
    expect(parseStateCapitol("AL", { ...photo, building: null })).toBeNull();
    expect(parseStateCapitol("AL", { ...photo, city: 3 })).toBeNull();
  });
});
