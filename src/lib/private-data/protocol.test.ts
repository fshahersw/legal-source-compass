import { describe, expect, it } from "vitest";
import { MAX_SNAPSHOT_BYTES, SNAPSHOT_PAGE_BYTES, snapshotName, snapshotPage, snapshotPageBounds } from "./protocol";

describe("private snapshot request boundaries", () => {
  it("accepts a known-style nested snapshot without allowing filesystem paths", () => {
    expect(snapshotName("/data/catalog/nj.json")).toBe("catalog/nj.json");
    for (const unsafe of ["../secret.json", "catalog/../secret.json", "catalog//nj.json", "C:/private/a.json", "%2e%2e/secret.json", "/data/.env", "https://example.com/a.json", "a\\b.json"]) {
      expect(() => snapshotName(unsafe)).toThrow();
    }
  });
  it("rejects fractional, negative, oversized and ambiguous page inputs", () => {
    for (const unsafe of ["-1", "1.5", "1e2", "01", " 0", "100000", "Infinity"]) expect(() => snapshotPage(unsafe)).toThrow();
    expect(snapshotPage(null)).toBe(0);
  });
  it("bounds the last page and refuses oversized snapshots", () => {
    expect(snapshotPageBounds(SNAPSHOT_PAGE_BYTES + 7, 1)).toEqual({ start: SNAPSHOT_PAGE_BYTES, end: SNAPSHOT_PAGE_BYTES + 7, pages: 2 });
    expect(() => snapshotPageBounds(SNAPSHOT_PAGE_BYTES + 7, 2)).toThrow();
    expect(() => snapshotPageBounds(MAX_SNAPSHOT_BYTES + 1, 0)).toThrow();
  });
});
