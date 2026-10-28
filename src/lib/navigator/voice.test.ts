import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/api/navigator-voice";
import {
  DEFAULT_VOICE_STYLE,
  VOICE_TOOLS,
  adaptFromBehaviour,
  applyStyleChange,
  parseVoiceStyle,
  speakable,
  styleLabels,
  voiceInstructions,
} from "./voiceStyle";

const mocks = vi.hoisted(() => ({
  requireCorpusAccess: vi.fn(),
  corpusAccessErrorResponse: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/lib/auth/access.server", () => ({
  requireCorpusAccess: mocks.requireCorpusAccess,
  corpusAccessErrorResponse: mocks.corpusAccessErrorResponse,
}));

type Handler = (options: { request: Request }) => Promise<Response>;
const handler = (Route as unknown as { options: { server: { handlers: { POST: Handler } } } })
  .options.server.handlers.POST;

describe("voice style", () => {
  it("repairs stored styles field by field", () => {
    expect(parseVoiceStyle(null)).toEqual(DEFAULT_VOICE_STYLE);
    const s = parseVoiceStyle({
      verbosity: "brief",
      formality: "loud",
      explainTerms: false,
      callMe: "Firas<script>",
    });
    expect(s.verbosity).toBe("brief");
    expect(s.formality).toBe("neutral");
    expect(s.explainTerms).toBe(false);
    expect(s.callMe).toBe("Firasscript");
  });

  it("applies only valid changes and forgets a name on request", () => {
    const named = applyStyleChange(DEFAULT_VOICE_STYLE, {
      callMe: "Sam",
      humor: "light",
      pace: "warp",
    });
    expect(named.callMe).toBe("Sam");
    expect(named.humor).toBe("light");
    expect(named.pace).toBe("normal");
    expect(applyStyleChange(named, { callMe: "" }).callMe).toBeNull();
  });

  it("gets shorter when the user cuts in, and stops being detailed for terse users", () => {
    const shorter = adaptFromBehaviour(DEFAULT_VOICE_STYLE, {
      interruptedLast4: 2,
      userWordsLast4: [12, 9],
    });
    expect(shorter?.style.verbosity).toBe("brief");
    expect(
      adaptFromBehaviour(
        { ...DEFAULT_VOICE_STYLE, verbosity: "brief" },
        { interruptedLast4: 3, userWordsLast4: [] },
      ),
    ).toBeNull();
    const detailed = { ...DEFAULT_VOICE_STYLE, verbosity: "detailed" as const };
    expect(
      adaptFromBehaviour(detailed, { interruptedLast4: 0, userWordsLast4: [3, 2, 4, 5] })?.style
        .verbosity,
    ).toBe("normal");
    expect(
      adaptFromBehaviour(detailed, { interruptedLast4: 0, userWordsLast4: [3, 20, 4, 5] }),
    ).toBeNull();
  });

  it("builds instructions that follow the style", () => {
    const brief = voiceInstructions(
      { ...DEFAULT_VOICE_STYLE, verbosity: "brief", explainTerms: false },
      "- x",
    );
    expect(brief).toContain("one or two short sentences");
    expect(brief).toContain("do not explain them");
    expect(brief).toContain("run_task");
    expect(brief).not.toMatch(/openai|gpt/i);
    const humor = voiceInstructions(
      { ...DEFAULT_VOICE_STYLE, humor: "light", callMe: "Sam" },
      "- x",
    );
    expect(humor).toContain("dry humor");
    expect(humor).toContain("called Sam");
    expect(styleLabels({ ...DEFAULT_VOICE_STYLE, humor: "light" })).toContain("Light humor");
  });

  it("turns markdown answers into speech", () => {
    expect(speakable("**D. New Jersey** holds [84,916](/matters/x) actions.\n\n| a |")).toBe(
      "D. New Jersey holds 84,916 actions.\n a",
    );
  });

  it("offers the voice its five tools", () => {
    expect(VOICE_TOOLS.map((t) => t.name)).toEqual([
      "run_task",
      "stop_task",
      "read_screen",
      "open_page",
      "set_style",
    ]);
  });
});

describe("voice session route", () => {
  const original = { ...process.env };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireCorpusAccess.mockResolvedValue({ userId: null, email: null });
    process.env["OPENAI_API_KEY"] = "sk-test-secret";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...original };
  });

  const offer = (headers: Record<string, string> = {}) =>
    new Request("https://workspace.example/api/navigator-voice", {
      method: "POST",
      headers: {
        "content-type": "application/sdp",
        "x-voice-style": encodeURIComponent(JSON.stringify({ verbosity: "brief" })),
        "x-real-ip": `10.0.0.${Math.floor(Math.random() * 200)}`,
        ...headers,
      },
      body: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n",
    });

  it("exchanges the offer with the session config and returns only the SDP answer", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const session = JSON.parse(String(form.get("session"))) as {
        type: string;
        instructions: string;
        tools: { name: string }[];
        audio: { input: { turn_detection: { type: string } } };
      };
      expect(session.type).toBe("realtime");
      expect(session.instructions).toContain("one or two short sentences");
      expect(session.tools.map((t) => t.name)).toContain("run_task");
      expect(session.audio.input.turn_detection.type).toBe("semantic_vad");
      expect(String(form.get("sdp"))).toMatch(/^v=0/);
      expect((init.headers as Record<string, string>)["authorization"]).toBe(
        "Bearer sk-test-secret",
      );
      return new Response("v=0\r\nanswer", { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handler({ request: offer() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/sdp");
    const text = await res.text();
    expect(text).toBe("v=0\r\nanswer");
    expect(text).not.toContain("sk-test");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/calls",
      expect.anything(),
    );
  });

  it("refuses non-SDP bodies and reports a missing key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await handler({ request: offer({ "content-type": "application/json" }) })).status).toBe(
      415,
    );
    delete process.env["OPENAI_API_KEY"];
    expect((await handler({ request: offer() })).status).toBe(503);
  });

  it("does not pass the service's error text to the browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("internal detail from provider", { status: 400 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handler({ request: offer() });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("provider");
  });
});
