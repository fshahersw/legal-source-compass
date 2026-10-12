import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "./conversationState";
import {
  projectConversationTranscript,
  WITHDRAWN_ASSESSMENT_MESSAGE,
} from "./conversationTranscript";

const messages: ConversationMessage[] = [
  { id: "facts", role: "user", content: "The injury was January 1, 2024." },
  { id: "question", role: "assistant", content: "Was January 1, 2024 the date you intended?" },
  {
    id: "assessment",
    role: "assistant",
    content:
      "The illustration is 2025-01-01. An earlier intermediate result was 2024-12-31. The next-day option was 2025-01-02.",
  },
];

describe("conversation assessment transcript projection", () => {
  it("preserves a current assessment and the user's original words", () => {
    expect(
      projectConversationTranscript(
        messages,
        { assessment: "facts-and-evidence-1" },
        "facts-and-evidence-1",
      ),
    ).toEqual(messages);
  });

  it.each([
    ["facts corrected", "facts-and-evidence-2", false],
    ["evidence changed", "facts-1-evidence-2", false],
    ["source refresh failed", "facts-and-evidence-1", true],
    ["no current binding", "", false],
  ] as const)(
    "withdraws the whole assessment when %s, including dates inside reasons",
    (_reason, currentBinding, failed) => {
      const projected = projectConversationTranscript(
        messages,
        { assessment: "facts-and-evidence-1" },
        currentBinding,
        failed,
      );
      expect(projected.slice(0, 2)).toEqual(messages.slice(0, 2));
      expect(projected[2]).toEqual({
        id: "assessment",
        role: "assistant",
        content: WITHDRAWN_ASSESSMENT_MESSAGE,
      });
      const exported = JSON.stringify({ conversation: { messages: projected } });
      expect(exported).not.toContain("2025-01-01");
      expect(exported).not.toContain("2024-12-31");
      expect(exported).not.toContain("2025-01-02");
      expect(exported).toContain("January 1, 2024");
      expect(messages[2]!.content).toContain("2025-01-01");
    },
  );

  it("keeps only the matching assessment from multiple historical results", () => {
    const next = [
      ...messages,
      {
        id: "new-assessment",
        role: "assistant" as const,
        content: "New conditional illustration: 2025-02-01.",
      },
    ];
    const projected = projectConversationTranscript(
      next,
      { assessment: "old", "new-assessment": "new" },
      "new",
    );
    expect(projected[2]!.content).toBe(WITHDRAWN_ASSESSMENT_MESSAGE);
    expect(projected[3]!.content).toBe(next[3]!.content);
  });

  it("fails closed for an empty recorded assessment binding and ignores prototype keys", () => {
    expect(projectConversationTranscript(messages, { assessment: "" }, "")[2]!.content).toBe(
      WITHDRAWN_ASSESSMENT_MESSAGE,
    );
    const inherited = Object.create({ assessment: "unrelated" }) as Record<string, string>;
    expect(projectConversationTranscript(messages, inherited, "current")).toEqual(messages);
  });

  it("does not erase user-reported dates even if an incorrect binding map includes that message", () => {
    expect(projectConversationTranscript(messages, { facts: "old" }, "new", true)[0]).toEqual(
      messages[0],
    );
  });
});
