import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig } from "./model.server";
import { buildSectionContextForTest } from "./summarize.testing";
import {
  SUMMARY_LIMIT,
  resetSummaryState,
  summarizeSectionContext,
  summarySystemPrompt,
  summaryUserPrompt,
  type SummaryDeps,
} from "./summarize.server";

const config: ModelConfig = {
  key: "test-key",
  model: "test-model",
  endpoint: "https://model.invalid/v1/messages",
  version: "1",
};

const context = buildSectionContextForTest();

function reply(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GOOD = [
  "- Cases filed reached 303,716 in FY2025.",
  "- That is up 4.4% on FY2024, when 290,980 cases were filed.",
  "- The figures do not show why filings rose.",
].join("\n");

function deps(fetchImpl: typeof fetch, extra: Partial<SummaryDeps> = {}): SummaryDeps {
  return { config, fetch: fetchImpl, clientKey: "203.0.113.9", allow: () => true, ...extra };
}

beforeEach(() => {
  resetSummaryState();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("summarizeSectionContext", () => {
  it("writes a summary from the figures and sends only the figures, with strict instructions", async () => {
    const fetchMock = vi.fn(async () => reply(GOOD));
    const out = await summarizeSectionContext(context, deps(fetchMock as unknown as typeof fetch));
    expect(out).toMatchObject({ status: "ok", omitted: 0, cached: false });
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.bullets).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBeLessThanOrEqual(400);
    expect(body.system).toContain("Use ONLY the supplied figures");
    expect(body.system).toContain("at most 90 words".replace("at most", "At most"));
    expect(body.messages[0].content).toContain("- Cases filed: 303,716 cases (FY2025)");
    expect(body.messages[0].content).toContain("Source: Federal Judicial Center");
    expect(JSON.stringify(body)).not.toContain("tools");
  });

  it("drops a sentence that states a number the figures do not hold", async () => {
    const text = `${GOOD}\n- Filings are expected to reach 320,000 next year.`;
    const out = await summarizeSectionContext(
      context,
      deps((async () => reply(text)) as unknown as typeof fetch),
    );
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.bullets.join(" ")).not.toContain("320,000");
    expect(out.omitted).toBe(1);
  });

  it("serves a repeat from the server cache without another model call", async () => {
    const fetchMock = vi.fn(async () => reply(GOOD));
    const d = deps(fetchMock as unknown as typeof fetch);
    const first = await summarizeSectionContext(context, d);
    const second = await summarizeSectionContext(context, d);
    expect(first).toMatchObject({ status: "ok", cached: false });
    expect(second).toMatchObject({ status: "ok", cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not serve a cached summary for different figures", async () => {
    const fetchMock = vi.fn(async () => reply(GOOD));
    const d = deps(fetchMock as unknown as typeof fetch);
    await summarizeSectionContext(context, d);
    const changed = buildSectionContextForTest({ cases: 310000 });
    await summarizeSectionContext(changed, d);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one model call between identical requests in flight", async () => {
    let release: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const d = deps(fetchMock as unknown as typeof fetch);
    const a = summarizeSectionContext(context, d);
    const b = summarizeSectionContext(context, d);
    await new Promise((r) => setTimeout(r, 5));
    release(reply(GOOD));
    const [x, y] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(x.status).toBe("ok");
    expect(y.status).toBe("ok");
  });

  it("says AI is not configured without calling anything", async () => {
    const fetchMock = vi.fn();
    const out = await summarizeSectionContext(
      context,
      deps(fetchMock as unknown as typeof fetch, { config: null }),
    );
    expect(out).toMatchObject({ status: "unavailable", reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an invalid or oversized payload before anything is sent", async () => {
    const fetchMock = vi.fn();
    const d = deps(fetchMock as unknown as typeof fetch);
    for (const bad of [
      null,
      "text",
      { ...context, extra: "key" },
      { ...context, figures: [{ label: "A", value: "1", sneaky: true }] },
      { ...context, title: "" },
      {
        ...context,
        figures: Array.from({ length: 40 }, (_, i) => ({
          label: `L${i}`,
          value: "1",
          note: "n".repeat(140),
          unit: "u".repeat(40),
          period: "p".repeat(48),
        })),
        source: "s".repeat(200),
        scope: "s".repeat(120),
        title: "t".repeat(140),
        total: 99999,
      },
    ])
      expect(await summarizeSectionContext(bad, d)).toMatchObject({ reason: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a section with too few recorded figures without a model call", async () => {
    const fetchMock = vi.fn();
    const thin = {
      id: "t",
      title: "Thin",
      figures: [
        { label: "A", value: "5" },
        { label: "B", value: "Not recorded" },
      ],
    };
    const out = await summarizeSectionContext(thin, deps(fetchMock as unknown as typeof fetch));
    expect(out).toEqual({ status: "thin", message: "Not enough figures here to summarize." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on the model's own too-thin answer and remembers it", async () => {
    const fetchMock = vi.fn(async () => reply("Not enough figures here to summarize."));
    const d = deps(fetchMock as unknown as typeof fetch);
    expect((await summarizeSectionContext(context, d)).status).toBe("thin");
    expect((await summarizeSectionContext(context, d)).status).toBe("thin");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("limits each client, and a cache hit does not count against the limit", async () => {
    const seen: number[] = [];
    const fetchMock = vi.fn(async () => reply(GOOD));
    const limited = deps(fetchMock as unknown as typeof fetch, {
      allow: (_key, max) => {
        seen.push(max);
        return false;
      },
      retryAfter: () => 125,
    });
    const out = await summarizeSectionContext(context, limited);
    expect(out).toMatchObject({
      status: "unavailable",
      reason: "rate_limited",
      retryAfterSec: 125,
    });
    if (out.status !== "unavailable") throw new Error("expected unavailable");
    expect(out.message).toContain("3 minutes");
    expect(seen).toEqual([SUMMARY_LIMIT]);
    expect(fetchMock).not.toHaveBeenCalled();

    await summarizeSectionContext(context, deps(fetchMock as unknown as typeof fetch));
    const allowSpy = vi.fn(() => false);
    const hit = await summarizeSectionContext(
      context,
      deps(fetchMock as unknown as typeof fetch, { allow: allowSpy }),
    );
    expect(hit).toMatchObject({ status: "ok", cached: true });
    expect(allowSpy).not.toHaveBeenCalled();
  });

  it("keeps each client's limit in its own bucket", async () => {
    const buckets: string[] = [];
    const fetchMock = vi.fn(async () => reply(GOOD));
    await summarizeSectionContext(
      context,
      deps(fetchMock as unknown as typeof fetch, {
        allow: (key) => {
          buckets.push(key);
          return true;
        },
      }),
    );
    expect(buckets).toEqual(["summary:203.0.113.9"]);
  });

  it("maps provider busy, failure and timeout to clear states, and never logs the figures", async () => {
    const busy = await summarizeSectionContext(
      context,
      deps((async () => new Response("", { status: 529 })) as unknown as typeof fetch),
    );
    expect(busy).toMatchObject({ status: "unavailable", reason: "busy" });
    resetSummaryState();
    const failed = await summarizeSectionContext(
      context,
      deps((async () => new Response("", { status: 400 })) as unknown as typeof fetch),
    );
    expect(failed).toMatchObject({ status: "unavailable", reason: "error" });
    resetSummaryState();
    const slow = await summarizeSectionContext(
      context,
      deps(
        ((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })) as unknown as typeof fetch,
        { timeoutMs: 30 },
      ),
    );
    expect(slow).toMatchObject({ status: "unavailable", reason: "timeout" });
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    );
    expect(logged).not.toContain("303,716");
  });

  it("retries once on a transient provider error", async () => {
    let calls = 0;
    const out = await summarizeSectionContext(
      context,
      deps((async () =>
        ++calls === 1
          ? new Response("", { status: 503 })
          : reply(GOOD)) as unknown as typeof fetch),
    );
    expect(out.status).toBe("ok");
    expect(calls).toBe(2);
  });

  it("shows nothing when no sentence survives the number check", async () => {
    const out = await summarizeSectionContext(
      context,
      deps((async () =>
        reply("- Filings hit 999,999.\n- Filings hit 888,888.")) as unknown as typeof fetch),
    );
    expect(out).toMatchObject({ status: "unavailable", reason: "error" });
  });
});

describe("summary prompts", () => {
  it("name no model, provider or vendor", () => {
    const text = [summarySystemPrompt(), summaryUserPrompt(context)].join(" ").toLowerCase();
    for (const name of ["claude", "anthropic", "openai", "gpt", "gemini", "sonnet", "model"])
      expect(text, name).not.toContain(name);
  });
  it("tell the model to use only the figures and to keep to the word and number limits", () => {
    const p = summarySystemPrompt();
    expect(p).toContain("Use ONLY the supplied figures");
    expect(p).toContain("Never state a number that is not written in the figures");
    expect(p).toContain("At most 90 words");
    expect(p).toContain("Not enough figures here to summarize.");
    expect(p).toContain("No legal advice");
  });
});
