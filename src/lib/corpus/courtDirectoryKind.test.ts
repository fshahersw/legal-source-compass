import { describe, it, expect } from "vitest";
import { isJudicialCourtRecord } from "./courtDirectoryKind";
import { filterStateCourts } from "./stateHub";
import type { CourtRow } from "@/lib/external/directoryTree";
const court = (id: string, type: string, title = id): CourtRow => ({
  id,
  title,
  type,
  state: "NE",
  system: "State",
});
describe("court records versus non-court directory references", () => {
  it("does not label attorney-general reports or an umbrella judiciary directory as individual courts", () => {
    expect(isJudicialCourtRecord(court("ag", "State attorney general"))).toBe(false);
    expect(
      isJudicialCourtRecord(court("dir", "State judiciary system (local registry entry)")),
    ).toBe(false);
    expect(isJudicialCourtRecord(court("neb", "State supreme"))).toBe(true);
    expect(isJudicialCourtRecord(court("nebraskab", "Federal bankruptcy"))).toBe(true);
  });
  it("uses the recorded type, not an ambiguous title or inferred court id", () => {
    expect(
      isJudicialCourtRecord(court("neb", "State attorney general", "Nebraska Supreme Court")),
    ).toBe(false);
    expect(isJudicialCourtRecord(court("ag", "State trial", "Attorney General v. Smith"))).toBe(
      true,
    );
    expect(isJudicialCourtRecord(court("unknown", "Not recorded"))).toBe(true);
  });
  it("keeps non-court reference rows out of the state court result and leaves source rows intact", () => {
    const rows = [
      court("neb", "State supreme"),
      court("ag", "State attorney general"),
      court("directory", "State judiciary system (local registry entry)"),
    ];
    const before = JSON.stringify(rows);
    expect(filterStateCourts(rows, "NE").map((r) => r.id)).toEqual(["neb"]);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
