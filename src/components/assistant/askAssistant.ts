/** Open the research assistant with a question from anywhere on the page (the panel listens for this event). */
export const ASK_EVENT = "assistant:ask";

/** Open the research assistant without a question (the header's Ask AI button). */
export const OPEN_EVENT = "assistant:open";

export function openAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export type AskDetail = { question: string; label?: string | undefined };

/** `label` is what the conversation shows for the question (the full question is still sent). */
export function askAssistant(question: string, label?: string) {
  window.dispatchEvent(
    new CustomEvent<AskDetail>(ASK_EVENT, { detail: { question: question.slice(0, 7000), label } }),
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
