import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeSchedule, nextRun, zonedInstant } from "./schedule";
import { markdownToHtml, parseMarkdown } from "./markdown";
import { toCsv, toDocx, toPdf, renderDocument } from "./documents.server";
import { ownerFor } from "./owner.server";
import { signedFileUrl, verifyFileLink, type Memory } from "./store.server";
import { cleanActions } from "./browse.server";
import { refusedImagePrompt } from "./images.server";
import { pathsFromTurns, pickMemories, taskWords } from "./context.server";
import { agentTools, runAgentTool } from "./tools.server";

const CHI = "America/Chicago";
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

describe("schedule timing", () => {
  it("runs daily at the wall-clock time, later today or tomorrow", () => {
    const from = Date.parse("2026-10-28T12:00:00Z"); // 7:00 Chicago (CDT, UTC-5)
    expect(iso(nextRun({ cadence: "daily", at: "08:00", tz: CHI }, from))).toBe(
      "2026-10-28T13:00:00.000Z",
    );
    expect(iso(nextRun({ cadence: "daily", at: "06:30", tz: CHI }, from))).toBe(
      "2026-10-29T11:30:00.000Z",
    );
  });

  it("keeps the local time across the end of daylight saving", () => {
    // DST ends 2026-11-01 in the US: 8:00 CDT is 13:00Z, 8:00 CST is 14:00Z
    const from = Date.parse("2026-10-31T14:00:00Z");
    expect(iso(nextRun({ cadence: "daily", at: "08:00", tz: CHI }, from))).toBe(
      "2026-11-01T14:00:00.000Z",
    );
    expect(zonedInstant(2026, 11, 2, 8, 0, CHI)).toBe(Date.parse("2026-11-02T14:00:00Z"));
  });

  it("skips weekends for weekdays and finds the weekday and month day", () => {
    const fri = Date.parse("2026-10-30T15:00:00Z"); // Friday 10:00 Chicago
    expect(iso(nextRun({ cadence: "weekdays", at: "08:00", tz: CHI }, fri))).toBe(
      "2026-11-02T14:00:00.000Z",
    );
    expect(iso(nextRun({ cadence: "weekly", at: "07:00", weekday: 1, tz: CHI }, fri))).toBe(
      "2026-11-02T13:00:00.000Z",
    );
    expect(iso(nextRun({ cadence: "monthly", at: "09:00", monthday: 1, tz: CHI }, fri))).toBe(
      "2026-11-01T15:00:00.000Z",
    );
  });

  it("runs hourly at the minute and once only once", () => {
    const from = Date.parse("2026-10-28T12:40:00Z");
    expect(iso(nextRun({ cadence: "hourly", at: "00:15", tz: CHI }, from))).toBe(
      "2026-10-28T13:15:00.000Z",
    );
    expect(nextRun({ cadence: "once", at: "08:00", tz: CHI }, from, { ran: true })).toBeNull();
    expect(nextRun({ cadence: "once", at: "08:00", tz: CHI }, from)).not.toBeNull();
  });

  it("describes a schedule in plain words", () => {
    expect(describeSchedule({ cadence: "weekdays", at: "08:00", tz: CHI })).toBe(
      "Weekdays at 8:00 AM Central",
    );
    expect(describeSchedule({ cadence: "weekly", at: "16:30", weekday: 1, tz: CHI })).toBe(
      "Every Monday at 4:30 PM Central",
    );
  });
});

const MD = `# Findings

Plain text with **bold**, *italic*, \`code\` and a [link](/matters/3140).

- first
- second

| MDL | Pending |
| --- | ---: |
| 3140 | 1,204 |
| 3094 | 18,950 |

<script>alert(1)</script>`;

describe("documents", () => {
  it("parses headings, lists and tables", () => {
    const blocks = parseMarkdown(MD);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "table",
      "paragraph",
    ]);
    const table = blocks.find((b) => b.type === "table");
    expect(table && table.type === "table" && table.rows.length).toBe(2);
  });

  it("writes HTML that never carries a script", () => {
    const html = markdownToHtml("Brief", MD);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="/matters/3140">');
    expect(markdownToHtml("x", "[bad](javascript:alert(1))")).not.toContain("javascript:");
  });

  it("writes Word, PDF and CSV files", async () => {
    const docx = await toDocx("Brief", MD, "28 Oct 2026");
    expect([docx[0], docx[1]]).toEqual([0x50, 0x4b]); // zip
    const pdf = await toPdf("Brief", MD, "28 Oct 2026 – scope");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(toCsv(MD)).toBe('MDL,Pending\n3140,"1,204"\n3094,"18,950"');
    const html = await renderDocument("html", "Brief", MD);
    expect(html.bytes).toBeNull();
    expect(html.mime).toBe("text/html");
  });
});

describe("workspace owner", () => {
  const req = (key?: string) =>
    new Request("https://x.test/api", { headers: key ? { "x-agent-owner": key } : {} });
  const key = "a".repeat(64);

  it("uses the account when signed in and the browser key otherwise", async () => {
    const a = await ownerFor(req(key), "user-1");
    const b = await ownerFor(req(), "user-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    const open = await ownerFor(req(key), "open-access");
    expect(open).not.toBe(a);
    expect(open).toMatch(/^[a-f0-9]{64}$/);
    expect(await ownerFor(req("short"), "open-access")).toBeNull();
    expect(await ownerFor(req(), null)).toBeNull();
    // the stored hash is never the key itself
    expect(open).not.toBe(key);
  });
});

describe("file links", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env["NAVIGATOR_SIGNING_KEY"] = "test-signing-key";
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("signs a link that expires and cannot be altered", async () => {
    const owner = "b".repeat(64);
    const id = "11111111-2222-3333-4444-555555555555";
    const now = Date.parse("2026-10-28T12:00:00Z");
    const link = (await signedFileUrl(owner, id, 3600, now))!;
    const q = new URL(link, "https://x.test").searchParams;
    const exp = Number(q.get("exp"));
    const sig = q.get("sig")!;
    expect(await verifyFileLink(owner, id, exp, sig, now)).toBe(true);
    expect(await verifyFileLink(owner, id, exp, sig, now + 3601_000)).toBe(false);
    expect(await verifyFileLink("c".repeat(64), id, exp, sig, now)).toBe(false);
    expect(await verifyFileLink(owner, id, exp + 60, sig, now)).toBe(false);
  });
});

describe("guards", () => {
  it("bounds browser actions and drops unknown ones", () => {
    const out = cleanActions([
      { type: "click", selector: "#search" },
      { type: "write", text: "ozempic" },
      { type: "press", key: "Enter" },
      { type: "press", key: "Meta+Q" },
      { type: "executeJavascript", script: "alert(1)" },
      { type: "wait", milliseconds: 999999 },
      ...Array.from({ length: 20 }, () => ({ type: "scroll", direction: "down" })),
    ]);
    expect(out.slice(0, 4)).toEqual([
      { type: "click", selector: "#search" },
      { type: "write", text: "ozempic" },
      { type: "press", key: "Enter" },
      { type: "wait", milliseconds: 8000 },
    ]);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.some((a) => (a as { type: string }).type === "executeJavascript")).toBe(false);
  });

  it("refuses realistic images of real people and imitation documents", () => {
    expect(refusedImagePrompt("A photorealistic portrait of Judge Smith in court")).toBe(true);
    expect(refusedImagePrompt("A fake court seal on an order")).toBe(true);
    expect(refusedImagePrompt("A clean diagram of how an MDL is centralized, flat style")).toBe(
      false,
    );
  });
});

const mem = (p: Partial<Memory>): Memory => ({
  id: p.id ?? "m",
  kind: p.kind ?? "fact",
  title: p.title ?? "",
  body: p.body ?? "",
  tags: p.tags ?? [],
  uses: p.uses ?? 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: p.updated_at ?? "2026-10-01T00:00:00Z",
  last_used_at: null,
});

describe("context", () => {
  it("brings every preference, relevant facts and matching procedures", () => {
    const all = [
      mem({
        id: "p1",
        kind: "preference",
        title: "Quarterly figures",
        body: "Show reports by quarter",
      }),
      mem({ id: "f1", kind: "fact", title: "Follows MDL 3094", body: "semaglutide GLP-1 MDL" }),
      mem({
        id: "r1",
        kind: "procedure",
        title: "Rising drugs check",
        body: "Open /safety/products?view=drugs, sort by rise",
      }),
      mem({ id: "r2", kind: "procedure", title: "Judge lookup", body: "Open /judges and search" }),
    ];
    const picked = pickMemories(all, "Which drugs have rising reports? check the product watch");
    expect(picked.preferences.map((m) => m.id)).toEqual(["p1"]);
    expect(picked.facts.map((m) => m.id)).toEqual(["f1"]);
    expect(picked.procedures.map((m) => m.id)).toEqual(["r1"]);
    expect(taskWords("What is the size of the MDL?")).toEqual(["size", "mdl"]);
  });

  it("collects the pages a task opened", () => {
    const turns = [
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", name: "go_to", input: { path: "/matters/3140" } },
          { type: "tool_use", name: "read_page", input: {} },
          { type: "tool_use", name: "go_to", input: { path: "/matters/3140" } },
          { type: "tool_use", name: "go_to", input: { path: "/judges" } },
        ],
      },
    ];
    expect(pathsFromTurns(turns)).toEqual(["/matters/3140", "/judges"]);
  });
});

describe("agent tools", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env["EXTERNAL_SUPABASE_URL"] = "https://corpus.test";
    process.env["EXTERNAL_SUPABASE_KEY"] = "service-key";
    process.env["NAVIGATOR_SIGNING_KEY"] = "k";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...original };
  });

  it("offers no schedule tools to scheduled runs", () => {
    const names = (m: "interactive" | "scheduled") => agentTools(m).map((t) => t.name);
    expect(names("interactive")).toEqual(
      expect.arrayContaining(["remember", "create_schedule", "create_document"]),
    );
    expect(names("scheduled")).not.toContain("create_schedule");
    expect(names("scheduled")).toContain("save_note");
  });

  it("scopes memory writes to the owner the route resolved", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push({ url, body });
        return Response.json({
          id: "9f0b2a52-6d3a-4c55-9a9f-0a3c1d2e4f60",
          kind: "preference",
          title: body["p_title"],
        });
      }),
    );
    const out = await runAgentTool(
      "remember",
      { kind: "preference", title: "Quarterly", body: "Show by quarter", owner: "attacker" },
      { owner: "o".repeat(64), mode: "interactive" },
    );
    expect(calls[0]!.url).toBe("https://corpus.test/rest/v1/rpc/agent_memory_put");
    expect(calls[0]!.body["p_owner"]).toBe("o".repeat(64));
    expect(out.label).toBe("Saved to memory");
  });

  it("computes the next run when it sets up a schedule, and refuses inside a scheduled run", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({
          id: "9f0b2a52-6d3a-4c55-9a9f-0a3c1d2e4f61",
          title: sent["p_title"],
          active: true,
          next_run_at: sent["p_next_run_at"],
        });
      }),
    );
    const out = await runAgentTool(
      "create_schedule",
      {
        title: "Morning check",
        task: "Check MDL 3094 for changes.",
        cadence: "weekdays",
        at: "08:00",
      },
      { owner: "o".repeat(64), mode: "interactive" },
    );
    expect(sent["p_cadence"]).toBe("weekdays");
    expect(typeof sent["p_next_run_at"]).toBe("string");
    expect(Date.parse(String(sent["p_next_run_at"]))).toBeGreaterThan(Date.now());
    expect(out.detail).toContain("Weekdays at 8:00 AM Central");
    await expect(
      runAgentTool(
        "create_schedule",
        { title: "x", task: "y", cadence: "daily", at: "08:00" },
        { owner: "o".repeat(64), mode: "scheduled" },
      ),
    ).rejects.toThrow(/cannot create schedules/);
  });

  it("surfaces the workspace's own limit messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { code: "54000", message: "Memory is full (500 items). Forget something first." },
          { status: 400 },
        ),
      ),
    );
    await expect(
      runAgentTool(
        "remember",
        { kind: "fact", title: "a", body: "b" },
        { owner: "o".repeat(64), mode: "interactive" },
      ),
    ).rejects.toThrow("Memory is full (500 items). Forget something first.");
  });
});
