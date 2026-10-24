import type { SectionContext } from "@/lib/assistant/sectionContext";

/** Open the research assistant with a question from anywhere on the page (the panel listens for this event). */
export const ASK_EVENT = "assistant:ask";
/** Open the assistant with one page section attached as context (the panel shows it as a removable chip). */
export const SECTION_EVENT = "assistant:section";

/** Open the research assistant without a question (the header's Ask AI button). */
export const OPEN_EVENT = "assistant:open";

export function openAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export type AskDetail = {
  question: string;
  label?: string | undefined;
  /** Attach this section to the question (and keep it attached until the user removes it). */
  section?: SectionContext | undefined;
};

export type SectionAskDetail = { section: SectionContext; questions: string[] };

/** `label` is what the conversation shows for the question (the full question is still sent). */
export function askAssistant(question: string, label?: string, section?: SectionContext) {
  window.dispatchEvent(
    new CustomEvent<AskDetail>(ASK_EVENT, {
      detail: { question: question.slice(0, 7000), label, section },
    }),
  );
}

/** Suggested questions offered with a section when the caller gives none. */
export const DEFAULT_SECTION_QUESTIONS = [
  "What stands out in these figures?",
  "What could explain the biggest differences or changes?",
  "What should I check in the source before relying on this?",
] as const;

/**
 * Open the assistant with a section attached and 2 to 3 questions ready to click; nothing is sent until the user asks.
 * The figures, period and source travel with their next question and are shown in the panel as "Context: <title>".
 */
export function askAboutSection(section: SectionContext, questions?: readonly string[]) {
  const chosen = (questions ?? [])
    .map((q) => q.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 3);
  window.dispatchEvent(
    new CustomEvent<SectionAskDetail>(SECTION_EVENT, {
      detail: { section, questions: chosen.length ? chosen : [...DEFAULT_SECTION_QUESTIONS] },
    }),
  );
}

/** A question asking the assistant to interpret a set of computed findings in the context of the page. */
export function interpretQuestion(
  title: string,
  scope: string | undefined,
  lines: string[],
): string {
  return [
    `Interpret these "${title}" findings from the page I am on${scope ? ` (${scope})` : ""}:`,
    ...lines.map((l) => `- ${l}`),
    "",
    "What stands out, what might explain it (check the underlying records and, where useful, outside sources), what caveats apply, and what should I look at next? Keep it brief and cite what you use.",
  ].join("\n");
}
