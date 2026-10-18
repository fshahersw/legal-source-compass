export type SafetyView = "overview" | "reports" | "neiss";

/** The view a `?view=` URL value names; anything else is the default view. */
export function safetyViewOf(raw: unknown): SafetyView {
  return raw === "reports" || raw === "neiss" ? raw : "overview";
}
