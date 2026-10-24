/**
 * Fixed wording and pure helpers of the AI kit (kept apart from the components so fast refresh keeps working).
 * No model, vendor or provider name appears in any of it.
 */
import type { SectionContext } from "@/lib/assistant/sectionContext";

export const AI_LABEL = "AI-generated from the figures on this page; check the source.";
export const AI_UNCONFIGURED = "AI summaries are not configured on this server.";
export const AI_THIN = "Not enough figures here to summarize.";
export const AI_NOT_CONFIGURED = "AI is not configured on this server.";
export const AI_WAITING = "Ask AI is available once the figures have loaded.";
export const AI_ASK_TIP =
  "Ask AI about this section. Its figures, period and source go with your question.";

/** The text placed on the clipboard: the bullets, then the label and where the figures came from. */
export function copyText(bullets: readonly string[], provenance?: string): string {
  return [
    ...bullets.map((b) => `- ${b}`),
    "",
    provenance ? `${AI_LABEL} ${provenance}` : AI_LABEL,
  ].join("\n");
}

export type AskAiAvailability = "ready" | "waiting" | "unconfigured";

/** Whether the Ask AI button can act, from the context and the server's configuration. */
export function askAiAvailability(
  context: SectionContext | null,
  status: "unknown" | "configured" | "unconfigured",
): AskAiAvailability {
  if (status === "unconfigured") return "unconfigured";
  if (!context || context.figures.length === 0) return "waiting";
  return "ready";
}
