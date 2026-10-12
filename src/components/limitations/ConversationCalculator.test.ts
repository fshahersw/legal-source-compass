import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationCalculator } from "./ConversationCalculator";
import {
  calculateConversationScenario,
  planConversationAssessment,
} from "@/lib/limitations/conversationAssessment";
import {
  conversationBinding,
  conversationInput,
  conversationScreens,
  createConversationSession,
  type ConversationSession,
} from "@/lib/limitations/conversationState";
import type {
  ConversationExtractionResult,
  ConversationFactField,
} from "@/lib/limitations/conversationExtraction";
import type { ConversationServerResult } from "@/lib/limitations/conversationAssessment.functions";
import { evaluateConversationRequest } from "@/lib/limitations/conversationAssessment.server";
import { SCREENING_QUESTIONS } from "@/lib/limitations/exceptionReview";
import type { LimitationsSnapshot } from "@/lib/limitations/types";

const harness = vi.hoisted(() => ({
  stateIndex: 0,
  refIndex: 0,
  dirty: false,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => void | (() => void)>,
  extract: vi.fn(),
  assess: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = harness.stateIndex++;
      if (!(index in harness.states))
        harness.states[index] = typeof initial === "function" ? initial() : initial;
      return [
        harness.states[index],
        (update: unknown) => {
          harness.states[index] =
            typeof update === "function" ? update(harness.states[index]) : update;
          harness.dirty = true;
        },
      ];
    },
    useRef: (initial: unknown) => (harness.refs[harness.refIndex++] ??= { current: initial }),
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: () => void | (() => void)) => {
      harness.effects.push(effect);
    },
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { configured: true, providerName: "Test provider" }, isPending: false }),
}));
vi.mock("@/lib/limitations/conversation.functions", () => ({
  extractConversationFacts: harness.extract,
  getConversationCapability: harness.capability,
}));
vi.mock("@/lib/limitations/conversationAssessment.functions", () => ({
  assessConversationFacts: harness.assess,
}));
vi.mock("./ConversationDictation", () => ({ ConversationDictation: () => null }));
vi.mock("./ConversationReadAloud", () => ({ ConversationReadAloud: () => null }));

const snapshot = {
  schemaVersion: "1.0.0",
  ruleVersion: "synthetic-release",
  snapshotDate: "2026-10-12",
  rules: [
    {
      id: "synthetic",
      ruleVersion: "synthetic-1",
      jurisdiction: "CA",
      claimType: "personal_injury",
      ruleKind: "limitations",
      computation: "baseline_only",
      reviewStatus: "statutory_text_verified",
      period: { amount: 2, unit: "calendar_years" },
      sourceIds: ["synthetic-source"],
      pinpoint: "Synthetic fixture only",
      scope: "Synthetic ordinary injury",
      summary: "Synthetic rule",
      accrualBasis: "confirmed_accrual",
      conditions: [],
      exclusions: [],
      warnings: [],
      effectiveFrom: "2020-01-01",
      effectiveThrough: null,
      provenance: { entryStatus: "verified", flags: [], tolling: [], repose: [] },
    },
  ],
  sources: [
    {
      id: "synthetic-source",
      state: "CA",
      authorityKind: "statute",
      sha256: "a".repeat(64),
      verifiedAt: "2026-10-01T00:00:00Z",
      url: "https://example.invalid/synthetic",
    },
  ],
  cases: [],
  coverage: [{ state: "CA", name: "California" }],
} as unknown as LimitationsSnapshot;
type Props = Parameters<typeof ConversationCalculator>[0];
const baseProps: Props = {
  snapshot,
  state: "CA",
  claim: "personal_injury",
  renderAuthority: () => null,
};

// Drive the actual component handlers and state transitions without a DOM or browser/audio APIs.
// React server rendering is used only for the resulting real JSX. Legal planning stays unmocked.
function render(overrides: Partial<Props> = {}) {
  let element: ReactElement;
  let renders = 0;
  do {
    if (++renders > 10) throw new Error("Component did not settle");
    harness.dirty = false;
    harness.stateIndex = 0;
    harness.refIndex = 0;
    harness.effects = [];
    element = ConversationCalculator({ ...baseProps, ...overrides });
  } while (harness.dirty);
  return element;
}
function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props["children"] as ReactNode)];
}
function control(tree: ReactNode, type: string) {
  const found = elements(tree).find((element) => element.type === type);
  if (!found) throw new Error(`Missing ${type}`);
  return found;
}
function typeReply(text: string) {
  const input = control(render(), "textarea");
  (input.props["onChange"] as (event: { target: { value: string } }) => void)({
    target: { value: text },
  });
}
function submit() {
  (control(render(), "form").props["onSubmit"] as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => {},
  });
}
function completedSession() {
  const session = createConversationSession("CA", "personal_injury");
  for (const [field, value] of [
    ["accrualDate", "2024-01-01"],
    ["eventState", "CA"],
    ["forumState", "CA"],
    ["residenceState", "CA"],
    ...[...SCREENING_QUESTIONS.map((screen) => screen.id), "calendar"].map((id) => [
      `screen:${id}`,
      "no",
    ]),
  ]) {
    session.facts[field as ConversationFactField] = {
      field: field as ConversationFactField,
      value: value!,
      certainty: "stated",
      replaces: false,
      evidence: { messageId: "original", quote: "Synthetic reported facts" },
    };
  }
  session.revision = session.confirmedRevision = session.scenarioRevision = 1;
  const input = conversationInput(session.facts),
    screening = conversationScreens(session.facts);
  const plan = planConversationAssessment(snapshot, input, screening);
  const scenario = calculateConversationScenario(snapshot, input, {
    requested: true,
    factsConfirmed: true,
    screening,
  });
  expect(scenario.status).toBe("conditional_illustration");
  expect(scenario.date).toBe("2026-01-01");
  const binding = conversationBinding(session, plan.contextKey!);
  session.messages = [
    { id: "original", role: "user", content: "The proposed starting date was January 1, 2024." },
    { id: "assessment", role: "assistant", content: `Conditional illustration: ${scenario.date}.` },
  ];
  const { rule, ...publicScenario } = scenario;
  const result: ConversationServerResult = {
    status: "assessed",
    scenario: { ...publicScenario, ruleId: rule?.id ?? null },
    ruleVersion: snapshot.ruleVersion,
    evidenceDigest: "a".repeat(64),
  };
  harness.states[0] = session;
  harness.states[5] = { binding, result };
  harness.states[7] = { assessment: binding };
  return { session, result };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.extract.mockReset();
  harness.assess.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("conversational calculator component", () => {
  it.each(["reviewed", "statutory"] as const)(
    "starts %s mode with a narrative draft and no date inputs",
    (mode) => {
      const html = renderToStaticMarkup(render({ mode, state: "", claim: undefined }));
      expect(html).toContain("Start with what happened");
      expect(html).toContain("Your reply");
      expect(html).toContain("Send reply");
      expect(html).toContain('aria-relevant="additions text"');
      expect(html).toContain("provider’s processing and retention policies apply");
      expect(html).not.toContain('type="date"');
      expect((harness.states[0] as ConversationSession).facts).toEqual({});
      expect(harness.extract).not.toHaveBeenCalled();
    },
  );

  it.each(["throws", "unavailable"] as const)(
    "withdraws date immediately during correction and keeps it withdrawn when extraction %s",
    async (failure) => {
      completedSession();
      expect(renderToStaticMarkup(render())).toContain("2026-01-01");
      const pending = deferred<ConversationExtractionResult>();
      harness.extract.mockReturnValue(pending.promise);
      const correction = "Actually the proposed starting date was January 3, 2024.";
      typeReply(correction);
      submit();
      const pendingHtml = renderToStaticMarkup(render());
      expect(pendingHtml).not.toContain("2026-01-01");
      expect(pendingHtml).toContain("Earlier assessment withdrawn");
      expect(pendingHtml).toContain("Checking your reply");
      expect(JSON.stringify(harness.extract.mock.calls[0])).not.toContain("2026-01-01");
      expect(harness.states[0]).toMatchObject({ confirmedRevision: null, scenarioRevision: null });
      if (failure === "throws") pending.reject(new Error("private provider detail"));
      else
        pending.resolve({
          status: "unavailable",
          reason: "provider_error",
          message: "Provider unavailable. Try again.",
        });
      await vi.waitFor(() => expect(harness.states[2]).toBe(false));
      const failed = render();
      const html = renderToStaticMarkup(failed);
      expect(html).not.toContain("2026-01-01");
      expect(html).not.toContain("private provider detail");
      expect(control(failed, "textarea").props["value"]).toBe(correction);
      expect(harness.states[0]).toMatchObject({ confirmedRevision: null, scenarioRevision: null });
    },
  );

  it("exports the same withdrawn transcript while a correction is pending", async () => {
    completedSession();
    const pending = deferred<ConversationExtractionResult>();
    harness.extract.mockReturnValue(pending.promise);
    typeReply("Actually January 3, 2024.");
    submit();
    let download: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      download = blob as Blob;
      return "blob:synthetic";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn() }) });
    const downloadButton = elements(render()).find(
      (element) =>
        Array.isArray(element.props["children"]) &&
        element.props["children"].includes(" Download review"),
    );
    expect(downloadButton).toBeDefined();
    (downloadButton!.props["onClick"] as () => void)();
    expect(download).not.toBeNull();
    const exported = await (download as unknown as Blob).text();
    expect(exported).not.toContain("2026-01-01");
    expect(exported).toContain("Earlier assessment withdrawn");
    expect(JSON.parse(exported).result).toBeNull();
    pending.resolve({ status: "unavailable", reason: "provider_error", message: "Try again." });
    await vi.waitFor(() => expect(harness.states[2]).toBe(false));
  });

  it("drops a delayed extraction after Start over", async () => {
    const pending = deferred<ConversationExtractionResult>();
    harness.extract.mockReturnValue(pending.promise);
    typeReply("The injury was January 3, 2024.");
    submit();
    const request = harness.extract.mock.calls[0]![0] as { data: { messages: { id: string }[] } };
    const resetButton = elements(render()).find(
      (element) =>
        Array.isArray(element.props["children"]) &&
        element.props["children"].includes(" Start over"),
    );
    (resetButton!.props["onClick"] as () => void)();
    pending.resolve({
      status: "extracted",
      providerName: "Google Gemini",
      conflicts: [],
      clarifications: [],
      candidates: [
        {
          field: "injuryDate",
          value: "2024-01-03",
          certainty: "stated",
          replaces: false,
          evidence: { messageId: request.data.messages.at(-1)!.id, quote: "January 3, 2024" },
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const html = renderToStaticMarkup(render());
    expect((harness.states[0] as ConversationSession).facts.injuryDate).toBeUndefined();
    expect(html).not.toContain("January 3, 2024");
    expect(harness.states[2]).toBe(false);
  });

  it("requires separate factual and scenario confirmation before requesting the current illustration", async () => {
    const { session, result } = completedSession();
    session.confirmedRevision = null;
    session.scenarioRevision = null;
    harness.states[4] = {
      id: "confirm-facts",
      kind: "confirm_facts",
      text: "Are these your facts?",
      explanation: "Factual confirmation only.",
    };
    harness.assess.mockResolvedValue(result);
    typeReply("yes");
    submit();
    expect(harness.states[0]).toMatchObject({ confirmedRevision: 1, scenarioRevision: null });
    expect(harness.states[4]).toMatchObject({ kind: "scenario" });
    expect(harness.assess).not.toHaveBeenCalled();
    expect(harness.extract).not.toHaveBeenCalled();
    typeReply("yes");
    submit();
    await vi.waitFor(() => expect(harness.states[2]).toBe(false));
    expect(harness.assess).toHaveBeenCalledOnce();
    expect(harness.assess.mock.calls[0]![0]).toMatchObject({
      data: { factsConfirmed: true, scenarioRequested: true },
    });
    expect(harness.states[0]).toMatchObject({ confirmedRevision: 1, scenarioRevision: 1 });
    expect(renderToStaticMarkup(render())).toContain("2026-01-01");
  });

  it("discards an in-flight assessment after source refresh fails", async () => {
    const { result } = completedSession();
    harness.states[4] = {
      id: "conditional-scenario",
      kind: "scenario",
      text: "Calculate this scenario?",
      explanation: "Conditional illustration only.",
    };
    const pending = deferred<ConversationServerResult>();
    harness.assess.mockReturnValue(pending.promise);
    typeReply("yes");
    submit();
    await vi.waitFor(() => expect(harness.assess).toHaveBeenCalledOnce());
    expect(renderToStaticMarkup(render({ sourceRefreshFailed: true }))).not.toContain("2026-01-01");
    pending.resolve(result);
    await vi.waitFor(() => expect(harness.states[2]).toBe(false));
    const html = renderToStaticMarkup(render({ sourceRefreshFailed: true }));
    expect(html).not.toContain("2026-01-01");
    expect(html).toContain("Earlier assessment withdrawn");
    expect(harness.states[5]).toBeNull();
    expect(
      (harness.states[0] as ConversationSession).messages.filter(
        (message) => message.role === "assistant",
      ),
    ).toHaveLength(1);
  });

  it.each(["no", "No, thanks.", "not now"])(
    "honors a plain scenario decline %s without a model request or confirmation loop",
    (reply) => {
      const { session } = completedSession();
      const facts = structuredClone(session.facts);
      harness.states[4] = {
        id: "conditional-scenario",
        kind: "scenario",
        text: "Calculate this scenario?",
        explanation: "Conditional illustration only.",
      };
      typeReply(reply);
      submit();
      const html = renderToStaticMarkup(render());
      expect(harness.extract).not.toHaveBeenCalled();
      expect(harness.assess).not.toHaveBeenCalled();
      expect(harness.states[0]).toMatchObject({
        facts,
        confirmedRevision: 1,
        scenarioRevision: null,
      });
      expect(harness.states[4]).toBeNull();
      expect(harness.states[2]).toBe(false);
      expect(html).toContain("I will not request a calculation");
      expect(html).not.toContain("2026-01-01");
      expect(html).not.toContain("Is this an accurate account of your facts?");
    },
  );

  it("still extracts a correction attached to a scenario refusal", async () => {
    completedSession();
    harness.states[4] = {
      id: "conditional-scenario",
      kind: "scenario",
      text: "Calculate this scenario?",
      explanation: "Conditional illustration only.",
    };
    harness.extract.mockResolvedValue({
      status: "unavailable",
      reason: "provider_error",
      message: "Try again.",
    });
    typeReply("No, actually the injury date was January 3, 2024.");
    submit();
    await vi.waitFor(() => expect(harness.states[2]).toBe(false));
    expect(harness.extract).toHaveBeenCalledOnce();
    expect(harness.assess).not.toHaveBeenCalled();
    expect(harness.states[0]).toMatchObject({ confirmedRevision: null, scenarioRevision: null });
  });

  it.each(["review unresolved facts", "show review", "review what we have"])(
    "provides a withheld review for %s without resolving conflicting locations",
    async (reply) => {
      const { session } = completedSession();
      session.conflicts.eventState = [
        { ...session.facts.eventState!, value: "CA" },
        { ...session.facts.eventState!, value: "NV" },
      ];
      delete session.facts.eventState;
      const conflicts = structuredClone(session.conflicts);
      harness.states[4] = {
        id: "conflict:eventState",
        kind: "clarify",
        field: "eventState",
        text: "Which location?",
        explanation: "Keep distinct events separate.",
      };
      harness.assess.mockImplementation(
        ({ data }: { data: Parameters<typeof evaluateConversationRequest>[1] }) =>
          evaluateConversationRequest(snapshot, data),
      );
      typeReply(reply);
      submit();
      await vi.waitFor(() => expect(harness.states[2]).toBe(false));
      expect(harness.extract).not.toHaveBeenCalled();
      expect(harness.assess).toHaveBeenCalledOnce();
      expect(harness.assess.mock.calls[0]![0]).toMatchObject({
        data: { factsConfirmed: false, scenarioRequested: false },
      });
      expect(harness.states[0]).toMatchObject({
        conflicts,
        confirmedRevision: null,
        scenarioRevision: null,
      });
      expect(harness.states[4]).toBeNull();
      expect(harness.states[5]).toMatchObject({
        result: {
          status: "assessed",
          scenario: { status: "withheld", date: null, calendar: null, steps: [] },
        },
      });
      const html = renderToStaticMarkup(render());
      expect(html).toContain("No reliable date can be issued");
      expect(html).not.toContain("2026-01-01");
      expect(html).toContain("California / Nevada");
    },
  );

  it("does not send an IME composition with Ctrl+Enter, but sends after composition ends", async () => {
    harness.extract.mockResolvedValue({
      status: "unavailable",
      reason: "provider_error",
      message: "Try again.",
    });
    typeReply("A reply still being composed");
    const keyDown = control(render(), "textarea").props["onKeyDown"] as (event: {
      ctrlKey: boolean;
      metaKey: boolean;
      key: string;
      nativeEvent: { isComposing: boolean };
      preventDefault: () => void;
    }) => void;
    const preventDefault = vi.fn();
    keyDown({
      ctrlKey: true,
      metaKey: false,
      key: "Enter",
      nativeEvent: { isComposing: true },
      preventDefault,
    });
    expect(harness.extract).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(control(render(), "textarea").props["value"]).toBe("A reply still being composed");
    keyDown({
      ctrlKey: true,
      metaKey: false,
      key: "Enter",
      nativeEvent: { isComposing: false },
      preventDefault,
    });
    await vi.waitFor(() => expect(harness.states[2]).toBe(false));
    expect(harness.extract).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("keeps primary facts visible and screening answers collapsed with their provenance", () => {
    completedSession();
    const tree = render();
    const screeningDetails = elements(tree).find(
      (element) =>
        element.type === "details" &&
        elements(element.props["children"] as ReactNode).some(
          (child) =>
            child.type === "summary" &&
            renderToStaticMarkup(child).includes("Screening answers (18)"),
        ),
    );
    expect(screeningDetails).toBeDefined();
    expect(screeningDetails!.props["open"]).toBeUndefined();
    const screeningHtml = renderToStaticMarkup(screeningDetails!);
    expect(screeningHtml).toContain("From your account");
    expect(screeningHtml).toContain("Synthetic reported facts");
    const primaryHtml = renderToStaticMarkup(control(tree, "dl"));
    expect(primaryHtml).toContain("California");
    expect(primaryHtml).toContain("2024-01-01");
    expect(primaryHtml).not.toContain(SCREENING_QUESTIONS[0]!.label);
    expect(
      elements(tree).find((element) => element.props["aria-label"] === "Conversation assessment")
        ?.type,
    ).toBe("section");
  });
});
