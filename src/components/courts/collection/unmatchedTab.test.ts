import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import type { UnmatchedRow } from "@/lib/external/clbCitationExtras.functions";
import { normalizeCollectionSearch } from "./collectionSearch";
import { unmatchedRows } from "./unmatchedRows";

const row = (
  id: string,
  name: string,
  citations: number,
  unresolvedPct: number | null,
): UnmatchedRow => ({
  id,
  kind: id.startsWith("court:") ? "court" : "reporter",
  name,
  citations,
  distinct: null,
  opinions: citations,
  unresolvedPct,
  type: null,
  inCitationTable: null,
});
const ROWS = [
  row("reporter:wl", "WL", 300, 100),
  row("reporter:u-s", "U.S.", 200, 80),
  row("reporter:f-3d", "F.3d", 100, null),
  row("court:ca9", "Court of Appeals for the Ninth Circuit", 50, 90),
];

describe("unresolved citations tab", () => {
  it("keeps the tab's own parameters and a valid selected row only", () => {
    expect(
      normalizeCollectionSearch({
        tab: "unmatched",
        sel: "reporter:wl",
        group: "court",
        q: "ninth",
        court: "ca9",
      }),
    ).toEqual({
      tab: "unmatched",
      sel: "reporter:wl",
      group: "court",
      q: "ninth",
    });
    expect(normalizeCollectionSearch({ tab: "unmatched", sel: "reporter:F. 3d" })).toEqual({
      tab: "unmatched",
    });
  });

  it("filters by kind and words and sorts with unknown values last", () => {
    const desc = unmatchedRows(ROWS, undefined, undefined, { key: "unresolved", desc: true });
    expect(desc.map((r) => r.id)).toEqual(["reporter:wl", "reporter:u-s", "reporter:f-3d"]);
    expect(
      unmatchedRows(ROWS, "court", "ninth", { key: "citations", desc: true }).map((r) => r.id),
    ).toEqual(["court:ca9"]);
    expect(
      unmatchedRows(ROWS, undefined, "u.s", { key: "name", desc: false }).map((r) => r.id),
    ).toEqual(["reporter:u-s"]);
  });
});
