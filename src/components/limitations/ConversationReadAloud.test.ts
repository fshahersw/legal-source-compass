import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConversationReadAloud } from "./ConversationReadAloud";
import { createReadAloudSession } from "./readAloudSession";

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
  const utterances: SpeechSynthesisUtterance[] = [];
  const host = {
    speechSynthesis: { speak: vi.fn(), cancel: vi.fn() },
    SpeechSynthesisUtterance: function (text: string) {
      const utterance = {
        text,
        lang: "",
        onend: null,
        onerror: null,
      } as unknown as SpeechSynthesisUtterance;
      utterances.push(utterance);
      return utterance;
    } as unknown as new (text: string) => SpeechSynthesisUtterance,
  };
  const status = vi.fn();
  const session = createReadAloudSession(host, status)!;
  return { host, status, session, utterances };
}

describe("optional spoken questions", () => {
  it("waits for explicit playback, speaks only the supplied question, and ends without restarting", () => {
    const { host, status, session, utterances } = setup();
    expect(host.speechSynthesis.speak).not.toHaveBeenCalled();
    session.speak("  When did the injury happen?  ");
    const utterance = utterances[0]!;
    expect(utterance.text).toBe("When did the injury happen?");
    expect(host.speechSynthesis.speak).toHaveBeenCalledExactlyOnceWith(utterance);
    utterance.onend?.call(utterance, {} as SpeechSynthesisEvent);
    expect(status.mock.lastCall?.[0].speaking).toBe(false);
    expect(host.speechSynthesis.speak).toHaveBeenCalledOnce();
  });

  it("cancels its active utterance and ignores late events from a prior question", () => {
    const { host, status, session, utterances } = setup();
    session.speak("Old question?");
    const old = utterances[0]!,
      lateEnd = old.onend,
      lateError = old.onerror;
    session.stop();
    session.speak("New question?");
    lateEnd?.call(old, {} as SpeechSynthesisEvent);
    lateError?.call(old, {} as SpeechSynthesisErrorEvent);
    expect(host.speechSynthesis.cancel).toHaveBeenCalledOnce();
    expect(status.mock.lastCall?.[0].speaking).toBe(true);
    expect(host.speechSynthesis.speak).toHaveBeenCalledTimes(2);
  });

  it("does not cancel unrelated page speech when this control has never spoken", () => {
    const { host, session } = setup();
    session.stop();
    session.speak(" ");
    expect(host.speechSynthesis.cancel).not.toHaveBeenCalled();
    expect(host.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("handles missing implementations and speech errors with text still available", () => {
    expect(createReadAloudSession({}, vi.fn())).toBeNull();
    const { host, status, session } = setup();
    host.speechSynthesis.speak.mockImplementation(() => {
      throw new Error("private service detail");
    });
    expect(() => session.speak("Question still visible?")).not.toThrow();
    expect(status.mock.lastCall?.[0]).toEqual({
      speaking: false,
      message: expect.stringContaining("question is still shown"),
    });
    expect(status.mock.lastCall?.[0].message).not.toContain("private service detail");
  });

  it.each(["text changed", "disabled", "unmount"])(
    "cancels through the real component when %s",
    (reason) => {
      const { host } = setup();
      vi.stubGlobal("window", host);
      lifecycle.active = true;
      lifecycle.states = [];
      lifecycle.refs = [];
      const render = (text = "Current question?", disabled = false) => {
        lifecycle.stateIndex = 0;
        lifecycle.refIndex = 0;
        lifecycle.effects = [];
        return ConversationReadAloud({ text, disabled });
      };
      try {
        render();
        const cleanup = lifecycle.effects[0]!();
        lifecycle.effects[1]!();
        const element = render();
        const button = (element.props as { children: Array<{ props: { onClick: () => void } }> })
          .children[0]!;
        button.props.onClick();
        expect(host.speechSynthesis.speak).toHaveBeenCalledOnce();
        if (reason === "unmount" && typeof cleanup === "function") cleanup();
        else {
          render(
            reason === "text changed" ? "New question?" : "Current question?",
            reason === "disabled",
          );
          lifecycle.effects[1]!();
        }
        expect(host.speechSynthesis.cancel).toHaveBeenCalledOnce();
        expect(host.speechSynthesis.speak).toHaveBeenCalledOnce();
        if (reason !== "unmount" && typeof cleanup === "function") cleanup();
      } finally {
        lifecycle.active = false;
        vi.unstubAllGlobals();
      }
    },
  );

  it("renders a button that cannot start from server render and explains browser playback", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationReadAloud, { text: "A question?" }),
    );
    expect(html).toContain("Read question aloud");
    expect(html).toContain('disabled=""');
    expect(html).toContain("browser’s speech service");
  });
});
