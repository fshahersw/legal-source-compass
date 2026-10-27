export type SafetyView = "overview" | "reports" | "neiss";

/** The view a `?view=` URL value names; anything else is the default view. */
export function safetyViewOf(raw: unknown): SafetyView {
  return raw === "reports" || raw === "neiss" ? raw : "overview";
}

/**
 * Modes of /safety/signals (at most 4 tabs): "emerging" (the default, no `?view=`), "mdl" (products in an MDL,
 * the page's former default), "reports" and "neiss".
 */
export type SignalsView = "emerging" | "mdl" | "reports" | "neiss";

/**
 * The /safety/signals mode a `?view=` value names. Every former URL keeps a page: `?view=reports` and `?view=neiss`
 * are unchanged, and `?view=overview` / `?view=mass-tort` (the former default mode) open "In an MDL". No value, or an
 * unknown one, is the default "emerging" mode.
 */
export function signalsViewOf(raw: unknown): SignalsView {
  if (raw === "reports" || raw === "neiss" || raw === "mdl" || raw === "emerging") return raw;
  if (raw === "overview" || raw === "mass-tort") return "mdl";
  return "emerging";
}
