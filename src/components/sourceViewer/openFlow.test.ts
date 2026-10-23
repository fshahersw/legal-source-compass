import { describe, expect, it, vi } from "vitest";
import { runOpenFlow, type OpenFlowHandlers } from "./openFlow";
import type { CheckOutcome } from "./sourceClient";
import type { CheckResult } from "./sourceLinks";

const data = (over: Partial<CheckResult> = {}): CheckResult => ({
  url: "https://a.gov/x",
  finalUrl: "https://a.gov/x",
  embeddable: true,
  reason: null,
  contentType: "text/html",
  kind: "page",
  fileName: null,
  size: null,
  remoteBrowser: true,
  reader: true,
  ...over,
});

function harness(url: string) {
  const log: string[] = [];
  let resolveCheck!: (o: CheckOutcome) => void;
  const checkPromise = new Promise<CheckOutcome>((r) => (resolveCheck = r));
  const handlers: OpenFlowHandlers = {
    optimistic: (v) => log.push(`optimistic:${v}`),
    checked: (o) => log.push(`checked:${o.ok ? o.data.kind : o.code}`),
  };
  const deps = {
    client: {
      check: vi.fn((u: string) => {
        log.push(`check:${u}`);
        return checkPromise;
      }),
    },
    refreshSession: vi.fn(async () => {
      log.push("session");
    }),
  };
  const cancel = runOpenFlow(deps, url, handlers);
  return { log, deps, resolveCheck, cancel };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runOpenFlow", () => {
  it("starts the check and the session refresh together, before either answers", () => {
    const h = harness("https://www.sec.gov/about");
    // Synchronously, on the click: nothing waited for anything else.
    expect(h.log).toEqual(["check:https://www.sec.gov/about", "session"]);
  });

  it("starts a plain document view at once, without waiting for the check", () => {
    const url = "https://www.govinfo.gov/content/pkg/X/pdf/X.pdf?download=1";
    const h = harness(url);
    expect(h.log).toEqual([`check:${url}`, "session", "optimistic:document"]);
  });

  it("does not start a document view for an address that is not plainly one", () => {
    expect(harness("https://a.gov/opinions/22-451").log).not.toContain("optimistic:document");
    expect(harness("https://a.gov/file.pdf.html").log).not.toContain("optimistic:document");
  });

  it("reports the outcome once it arrives, after the optimistic start", async () => {
    const h = harness("https://a.gov/doc.pdf");
    h.resolveCheck({ ok: true, data: data({ kind: "pdf" }) });
    await flush();
    expect(h.log).toEqual([
      "check:https://a.gov/doc.pdf",
      "session",
      "optimistic:document",
      "checked:pdf",
    ]);
  });

  it("passes a failed check on as an outcome, not an exception", async () => {
    const h = harness("https://a.gov/x");
    h.resolveCheck({
      ok: false,
      message: "down",
      code: "unreachable",
      remoteBrowser: true,
      reader: false,
    });
    await flush();
    expect(h.log.at(-1)).toBe("checked:unreachable");
  });

  it("is silent after cancel, even when the check answers later", async () => {
    const h = harness("https://a.gov/x");
    h.cancel();
    h.resolveCheck({ ok: true, data: data() });
    await flush();
    expect(h.log.some((l) => l.startsWith("checked"))).toBe(false);
  });
});
