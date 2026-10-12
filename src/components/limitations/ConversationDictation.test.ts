import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createDictationSession,
  dictationConstructor,
  type DictationRecognition,
} from "./dictationSession";
import { ConversationDictation } from "./ConversationDictation";

const lifecycle = vi.hoisted(() => ({
  active: false,
  stateIndex: 0,
  refIndex: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useId: () => (lifecycle.active ? "dictation-test" : react.useId()),
    useState: (initial: unknown) => {
      if (!lifecycle.active) return react.useState(initial);
      const index = lifecycle.stateIndex++;
      if (!(index in lifecycle.states)) lifecycle.states[index] = initial;
      return [
        lifecycle.states[index],
        (value: unknown) => {
          lifecycle.states[index] = value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      if (!lifecycle.active) return react.useRef(initial);
      const index = lifecycle.refIndex++;
      return (lifecycle.refs[index] ??= { current: initial });
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      if (!lifecycle.active) return react.useEffect(effect, deps);
      lifecycle.effects.push(effect);
    },
  };
});

function setup() {
  const recognition: DictationRecognition = {
    lang: "",
    continuous: true,
    interimResults: true,
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  const makeRecognition = vi.fn(() => recognition);
  const transcript = vi.fn();
  const status = vi.fn();
  const session = createDictationSession(makeRecognition, transcript, status);
  return { recognition, makeRecognition, transcript, status, session };
}
const final = (text: string) => ({ isFinal: true, 0: { transcript: text } });

describe("conversation dictation", () => {
  it("detects native, prefixed and unavailable implementations without starting a microphone", () => {
    const native = vi.fn();
    const prefixed = vi.fn();
    expect(
      dictationConstructor({ SpeechRecognition: native, webkitSpeechRecognition: prefixed }),
    ).toBe(native);
    expect(dictationConstructor({ webkitSpeechRecognition: prefixed })).toBe(prefixed);
    expect(dictationConstructor({})).toBeNull();
    expect(native).not.toHaveBeenCalled();
    expect(prefixed).not.toHaveBeenCalled();
  });

  it("waits for an explicit start and records a bounded final-result session", () => {
    const { recognition, makeRecognition, session, status } = setup();
    expect(makeRecognition).not.toHaveBeenCalled();
    session.start();
    session.start();
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(false);
    expect(status).toHaveBeenLastCalledWith({ state: "starting", message: "Starting microphone…" });
    recognition.onstart?.();
    expect(status).toHaveBeenLastCalledWith({ state: "listening", message: "Listening…" });
  });

  it("ignores interim/blank results and duplicate events, while preserving repeated spoken words", () => {
    const { recognition, transcript, session } = setup();
    session.start();
    recognition.onresult?.({
      resultIndex: 0,
      results: [{ ...final("wrong interim"), isFinal: false }],
    });
    expect(transcript).not.toHaveBeenCalled();
    const results = [final("  no  "), final("no"), final("  ")];
    recognition.onresult?.({ resultIndex: 0, results });
    recognition.onresult?.({ resultIndex: 0, results });
    expect(transcript.mock.calls).toEqual([["no"], ["no"]]);
  });

  it("accepts a final chunk after Stop, then ends without restarting or sending anything", () => {
    const { recognition, transcript, status, session } = setup();
    session.start();
    session.stop();
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(status.mock.lastCall?.[0].state).toBe("stopping");
    recognition.onresult?.({ resultIndex: 0, results: [final("January 3, 2024")] });
    recognition.onend?.();
    expect(transcript).toHaveBeenCalledExactlyOnceWith("January 3, 2024");
    expect(status.mock.lastCall?.[0].state).toBe("idle");
    expect(recognition.start).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
  });

  it("discards queued callbacks after abort and resets final indexes for the next explicit session", () => {
    const { recognition, transcript, status, session } = setup();
    session.start();
    const lateResult = recognition.onresult;
    const lateError = recognition.onerror;
    const lateEnd = recognition.onend;
    session.abort();
    expect(recognition.abort).toHaveBeenCalledOnce();
    lateResult?.({ resultIndex: 0, results: [final("discard me")] });
    lateError?.({ error: "network" });
    lateEnd?.();
    expect(transcript).not.toHaveBeenCalled();
    expect(status.mock.lastCall?.[0].state).toBe("idle");
    session.start();
    lateResult?.({ resultIndex: 0, results: [final("old session after restart")] });
    lateError?.({ error: "network" });
    lateEnd?.();
    recognition.onresult?.({ resultIndex: 0, results: [final("new draft")] });
    expect(transcript).toHaveBeenCalledExactlyOnceWith("new draft");
  });

  it.each([
    ["not-allowed", "Microphone access was not allowed"],
    ["service-not-allowed", "Microphone access was not allowed"],
    ["network", "dictation service is unavailable"],
    ["no-speech", "No speech was detected"],
    ["audio-capture", "No microphone is available"],
  ])("handles %s without retrying or retaining late results", (error, message) => {
    const { recognition, transcript, status, session } = setup();
    session.start();
    const lateResult = recognition.onresult;
    recognition.onerror?.({ error });
    lateResult?.({ resultIndex: 0, results: [final("must not appear")] });
    expect(status.mock.lastCall?.[0]).toEqual({
      state: "error",
      message: expect.stringContaining(message),
    });
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(recognition.start).toHaveBeenCalledOnce();
    expect(transcript).not.toHaveBeenCalled();
  });

  it("handles synchronous permission failures and already-ended aborts", () => {
    const { recognition, status, session } = setup();
    const error = new Error("private provider detail");
    error.name = "NotAllowedError";
    vi.mocked(recognition.start).mockImplementation(() => {
      throw error;
    });
    vi.mocked(recognition.abort).mockImplementation(() => {
      throw new Error("already ended");
    });
    expect(() => session.start()).not.toThrow();
    expect(status.mock.lastCall?.[0].message).toContain("Microphone access was not allowed");
    expect(status.mock.lastCall?.[0].message).not.toContain("private provider detail");
    expect(() => session.abort()).not.toThrow();
  });

  it("renders an optional, disabled-until-detected control and accurate voice privacy text", () => {
    const transcript = vi.fn();
    const html = renderToStaticMarkup(
      createElement(ConversationDictation, { onTranscript: transcript }),
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Dictate a draft");
    expect(html).toContain("speech provider may process your voice");
    expect(html).toContain("never sends it automatically");
    expect(transcript).not.toHaveBeenCalled();
  });

  it.each(["disabled", "unmount"])(
    "aborts from the real component's %s lifecycle and drops queued words",
    (reason) => {
      const { recognition } = setup();
      const onTranscript = vi.fn();
      vi.stubGlobal("window", {
        SpeechRecognition: function () {
          return recognition;
        },
      });
      lifecycle.active = true;
      lifecycle.states = [];
      lifecycle.refs = [];
      const render = (disabled = false) => {
        lifecycle.stateIndex = 0;
        lifecycle.refIndex = 0;
        lifecycle.effects = [];
        return ConversationDictation({ onTranscript, disabled });
      };
      try {
        render();
        const cleanup = lifecycle.effects[0]!();
        lifecycle.effects[1]!();
        expect(recognition.start).not.toHaveBeenCalled();
        const element = render();
        const button = (element.props as { children: Array<{ props: { onClick: () => void } }> })
          .children[0]!;
        button.props.onClick();
        expect(recognition.start).toHaveBeenCalledOnce();
        const lateResult = recognition.onresult;
        if (reason === "disabled") {
          render(true);
          // Even before the disabling effect, a queued result must not alter the draft.
          lateResult?.({ resultIndex: 0, results: [final("disabled draft")] });
          lifecycle.effects[1]!();
        } else if (typeof cleanup === "function") cleanup();
        lateResult?.({ resultIndex: 0, results: [final("late draft")] });
        expect(recognition.abort).toHaveBeenCalledOnce();
        expect(onTranscript).not.toHaveBeenCalled();
        if (reason === "disabled" && typeof cleanup === "function") cleanup();
      } finally {
        lifecycle.active = false;
        vi.unstubAllGlobals();
      }
    },
  );
});
