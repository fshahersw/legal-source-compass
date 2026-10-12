import { describe, expect, it } from "vitest";
import { captureReceiptDetails, captureResponseAccepted } from "./captureProvenance";
import type { CaptureMeta } from "./entries";

const meta = (extra: Partial<CaptureMeta>) => ({ status: 200, ...extra }) as CaptureMeta;
describe("capture receipt method and observed status", () => {
  it("does not invent network status or anonymous access for an authorized browser DOM", () => {
    const details = captureReceiptDetails(
      meta({ status: null, rendered: true, representation: "browser_dom" }),
    );
    expect(details).not.toHaveProperty("httpStatus");
    expect(details.method).toContain("authorized browser session");
    expect(details.method).toContain("not the original HTTP response");
    expect(details.method).not.toContain("without login");
  });
  it("retains the ordinary response status and intermediary qualification", () => {
    expect(captureReceiptDetails(meta({})).httpStatus).toBe(200);
    const details = captureReceiptDetails(
      meta({ intermediary: true, extraction: "Firecrawl extraction" }),
    );
    expect(details.method).toContain("extraction intermediary");
    expect(details.method).toContain("Firecrawl");
  });
  it("does not infer authentication history from a legacy rendered marker", () => {
    expect(captureReceiptDetails(meta({ rendered: true })).method).toContain("state not recorded");
  });
  it("rejects failed responses even when a rendered marker is present", () => {
    expect(
      captureResponseAccepted(meta({ status: 403, rendered: true, representation: "browser_dom" })),
    ).toBe(false);
    expect(captureResponseAccepted(meta({ status: null, rendered: true }))).toBe(false);
    expect(captureResponseAccepted(meta({ status: null, representation: "browser_dom" }))).toBe(
      false,
    );
  });
});
