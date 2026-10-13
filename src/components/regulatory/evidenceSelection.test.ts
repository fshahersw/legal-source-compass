import { describe, expect, it } from "vitest";
import { selectEvidence } from "./evidenceSelection";

const detail = {
  payloadSha256: "latest",
  versions: [
    { payloadSha256: "first", text: "Original source" },
    { payloadSha256: "revised", text: "Revised source" },
    { payloadSha256: "latest", text: "Later source" },
  ],
  events: [
    { id: "earlier-change", payloadSha256: "revised", previousPayloadSha256: "first" },
    { id: "later-change", payloadSha256: "latest", previousPayloadSha256: "revised" },
  ],
};
describe("pinned regulatory evidence selection", () => {
  it("compares the selected event to its actual predecessor, not the latest record", () => {
    const result = selectEvidence(detail, "earlier-change", null);
    expect(result.version?.text).toBe("Revised source");
    expect(result.previous?.text).toBe("Original source");
  });
  it("withholds content when a linked historical event was capped out", () => {
    const result = selectEvidence(detail, "unavailable-event", null);
    expect(result.hash).toBeUndefined();
    expect(result.version).toBeUndefined();
    expect(result.event).toBeUndefined();
  });
  it("does not substitute latest when the selected event's exact version is missing", () => {
    const result = selectEvidence(
      { ...detail, versions: detail.versions.filter((v) => v.payloadSha256 !== "revised") },
      "earlier-change",
      null,
    );
    expect(result.version).toBeUndefined();
    expect(result.previous?.text).toBe("Original source");
  });
  it("allows an explicit version choice and uses its associated change", () => {
    const result = selectEvidence(detail, "earlier-change", "latest");
    expect(result.event?.id).toBe("later-change");
    expect(result.previous?.text).toBe("Revised source");
  });
});
