import { describe, expect, it } from "vitest";
import { buildEntityView } from "./entityView";

describe("source attribution", () => {
  it("preserves nested source-version evidence as inert JSON on permanent record pages", () => {
    const provenance = {
      projection_schema: "courtlistener-docket-metadata-view/1",
      selection_source: { payload_sha256: "a".repeat(64), retrieved_at: "2026-10-02T08:38:15Z" },
      metadata_source: {
        payload_sha256: "b".repeat(64),
        source_url: "https://www.courtlistener.com/api/rest/v4/dockets/123/",
      },
      source_note: '<a href="javascript:alert(1)">Untrusted source text</a>',
    };
    const raw = { id: "cl:dockets:123", title: "Docket 123", provenance };
    const view = buildEntityView(raw);
    expect(JSON.parse(view.provenanceJson!)).toEqual(provenance);
    expect(view.links).toEqual([]);
    expect(view.sections).toEqual([]);
    expect(view.technical).toEqual([]);
    expect(raw.provenance).toEqual(provenance);
  });
  it("keeps absent provenance absent and retains legacy scalar evidence", () => {
    expect(buildEntityView({ id: "x" }).provenanceJson).toBeNull();
    const view = buildEntityView({ id: "x", provenance: "Original publisher note" });
    expect(view.provenanceJson).toBeNull();
    expect(view.technical).toContainEqual(["Provenance", "Original publisher note"]);
  });
  it("does not call an arbitrary stored source URL official", () => {
    const raw = {
      id: "x",
      title: "Third-party report",
      source_url: "https://example.com/report",
      qualification: "Secondary summary; not an adjudicated finding.",
    };
    const view = buildEntityView(raw);
    expect(view.links).toContainEqual({ url: raw.source_url, label: "Original source" });
    expect(view.technical).toContainEqual(["Qualification", raw.qualification]);
    expect(raw.source_url).toBe("https://example.com/report");
  });
});
