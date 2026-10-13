import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RegulatoryReviewEditor, RegulatoryWorkspacePanel } from "./RegulatoryWorkspace";
import type { RegulatoryWorkspaceState } from "./useRegulatoryWorkspace";
import type { RegulatoryEvent } from "@/lib/regulatory/types";

vi.mock("@/lib/regulatory/localWorkspace", () => ({
  MAX_REGULATORY_BACKUP_BYTES: 40_000_000,
  recheckLocalRegulatoryReviews: vi.fn(),
  saveLocalRegulatoryInvestigation: vi.fn(),
  saveLocalRegulatoryWatchlist: vi.fn(),
  saveLocalRegulatoryReview: vi.fn(),
  saveLocalRegulatoryBrief: vi.fn(),
  getLocalRegulatoryBrief: vi.fn(),
  exportLocalRegulatoryWorkspace: vi.fn(),
  importLocalRegulatoryWorkspace: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isPending: true }),
}));

function workspace(data: object | null, isError = false): RegulatoryWorkspaceState {
  return {
    data,
    canWrite: !!data,
    work: { isError, isPending: !data && !isError, refetch: vi.fn() },
  } as unknown as RegulatoryWorkspaceState;
}
const empty = {
  mode: "browser-local",
  storeVersion: 1,
  revision: 0,
  updatedAt: "2026-10-12T00:00:00Z",
  investigations: [],
  watchlists: [],
  reviews: [],
  briefs: [],
  history: [],
  listsCapped: false,
};
function render(state: RegulatoryWorkspaceState) {
  return renderToStaticMarkup(
    createElement(RegulatoryWorkspacePanel, {
      workspace: state,
      query: { dateBasis: "detected" },
      selectedEvents: [],
      onApply() {},
      onOpen() {},
    }),
  );
}

describe("browser-saved investigation interface", () => {
  it("shows earlier exact-record reviews on a newer event with checked-at status and a recheck action", () => {
    const review = {
      id: "prior",
      eventId: "old-event",
      status: "needs_evidence",
      source: "federal_register",
      nativeId: "EXACT-001",
      payloadSha256: "old-hash",
      note: "Prior exact-record reasoning",
      createdAt: "2026-10-01T00:00:00Z",
      reviewedBy: "This browser",
      sourceVerification: "server_snapshot",
      sourceCheckedAt: "2026-10-02T00:00:00Z",
      sourceCheckStatus: "current",
      needsReconsideration: false,
    };
    const html = renderToStaticMarkup(
      createElement(RegulatoryReviewEditor, {
        workspace: workspace({
          ...empty,
          reviews: [
            review,
            { ...review, id: "other", source: "cpsc_recalls", note: "Do not merge this review" },
          ],
        }),
        event: {
          id: "new-event",
          source: "federal_register",
          nativeId: "EXACT-001",
          payloadSha256: "new-hash",
        } as RegulatoryEvent,
      }),
    );
    expect(html).toContain("Prior exact-record reasoning");
    expect(html).toContain("another retained version");
    expect(html).toContain("Last successful source check: 2026-10-02T00:00:00Z");
    expect(html).toContain("Same source version at last check");
    expect(html).toContain("Recheck this source record");
    expect(html).not.toContain("Do not merge this review");
  });
  it("makes the complete local workflow available without identity or organization metadata", () => {
    const html = render(workspace(empty));
    expect(html).toContain("Saved in this browser");
    expect(html).toContain("Create investigation");
    expect(html).toContain("Save current inquiry");
    expect(html).toContain("Export backup");
    expect(html).toContain("Import &amp; merge backup");
    expect(html).not.toMatch(/Sign in|membership|organization access|authorized work product/i);
  });
  it("does not turn an imported manifest or review into a verified source assertion", () => {
    const html = render(
      workspace({
        ...empty,
        briefs: [
          {
            id: "synthetic-brief",
            title: "Imported synthetic brief",
            createdAt: "2026-10-12T00:00:00Z",
            createdBy: "Imported work product",
            manifestSha256: "a".repeat(64),
            investigationId: null,
            sourceVerification: "imported_unverified",
          },
        ],
        reviews: [
          {
            id: "synthetic-review",
            status: "relevant",
            source: "federal_register",
            nativeId: "synthetic-id",
            note: "<script>literal imported note</script>",
            createdAt: "2026-10-12T00:00:00Z",
            reviewedBy: "Imported work product",
            sourceVerification: "imported_unverified",
            needsReconsideration: true,
          },
        ],
      }),
    );
    expect(html).toContain("imported evidence, not reverified");
    expect(html).toContain("Imported evidence, not reverified against the server.");
    expect(html).not.toContain("server-verified at save");
    expect(html).toContain("&lt;script&gt;literal imported note&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("shows a storage failure as recoverable failure rather than an empty workspace", () => {
    const html = render(workspace(null, true));
    expect(html).toContain("Browser storage could not be opened");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No investigations saved");
    expect(html).not.toContain("Create investigation");
  });
});
