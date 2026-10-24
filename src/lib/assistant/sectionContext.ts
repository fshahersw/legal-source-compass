/**
 * Section context: the bounded, deterministic description of one page section (title, scope, period, source and a
 * list of labelled figures) that the "Ask AI" entry and the "What this shows" summary send to the server. Shared by the
 * browser and the server, pure and tested (sectionContext.test.ts).
 *
 * A figure's value is always a display string ("303,716", "4.4%", "Not recorded"), never a bare number, so the text the
 * reader sees, the text the model receives and the text the number check compares against are the same characters.
 */
import { z } from "zod";

/** The serialised context never exceeds this many bytes (the summary endpoint and the assistant both enforce it). */
export const MAX_SECTION_CONTEXT_BYTES = 8 * 1024;
/** Figures kept by default, and the most a builder may keep. */
export const DEFAULT_SECTION_FIGURES = 24;
export const MAX_SECTION_FIGURES = 40;
/** Fewer figures than this are too thin to summarize. */
export const MIN_SUMMARY_FIGURES = 2;
/** Shown in place of a value the page does not record; never zero. */
export const NOT_RECORDED = "Not recorded";

export const sectionFigureSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    /** Display text: "303,716", "4.4%", "$3.94 billion", or "Not recorded". */
    value: z.string().trim().min(1).max(48),
    unit: z.string().trim().max(40).optional(),
    period: z.string().trim().max(48).optional(),
    note: z.string().trim().max(140).optional(),
  })
  .strict();

export const sectionContextSchema = z
  .object({
    /** Anchor id of the section on its page. */
    id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/),
    title: z.string().trim().min(1).max(140),
    /** Geography or population the figures describe ("United States"). */
    scope: z.string().trim().max(120).optional(),
    period: z.string().trim().max(80).optional(),
    source: z.string().trim().max(200).optional(),
    figures: z.array(sectionFigureSchema).max(MAX_SECTION_FIGURES),
    /** How many figures the section had before the builder cut it to fit; present only when some were left out. */
    total: z.number().int().min(0).max(100000).optional(),
  })
  .strict()
  .refine((c) => serialisedBytes(c) <= MAX_SECTION_CONTEXT_BYTES, {
    message: "The section context is too large.",
  });

export type SectionFigure = z.infer<typeof sectionFigureSchema>;
export type SectionContext = z.infer<typeof sectionContextSchema>;

export function serialisedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Collapses whitespace, drops control characters and cuts to `max` characters (with an ellipsis). */
export function cleanText(value: unknown, max: number): string {
  const text = String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

/** One figure as a line of text: "- Cases filed: 303,716 cases (FY2025) - note". The model and the number check read this. */
export function renderFigure(f: SectionFigure): string {
  const unit = f.unit ? (f.unit.startsWith("%") ? f.unit : ` ${f.unit}`) : "";
  const value = f.unit && f.value.endsWith(f.unit) ? f.value : `${f.value}${unit}`;
  return `- ${f.label}: ${value}${f.period ? ` (${f.period})` : ""}${f.note ? ` - ${f.note}` : ""}`;
}

/** The whole context as plain text, in a fixed order. Identical contexts always render identical text. */
export function renderSectionContext(c: SectionContext): string {
  const lines = [`Section: ${c.title}`];
  if (c.scope) lines.push(`Scope: ${c.scope}`);
  if (c.period) lines.push(`Period: ${c.period}`);
  if (c.source) lines.push(`Source: ${c.source}`);
  lines.push(
    c.total !== undefined && c.total > c.figures.length
      ? `Figures (${c.figures.length} of ${c.total} shown):`
      : "Figures:",
  );
  for (const f of c.figures) lines.push(renderFigure(f));
  return lines.join("\n");
}

/** 53-bit string hash (cyrb53), base 36. Not cryptographic: it keys caches, never authorizes anything. */
export function hashText(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Cache key of a context: its rendered text, so two contexts with the same words share one summary. */
export function contextKey(c: SectionContext): string {
  return hashText(renderSectionContext(c));
}

/** Figures usable for a summary: those that carry a recorded value. */
export function recordedFigures(c: Pick<SectionContext, "figures">): SectionFigure[] {
  return c.figures.filter((f) => f.value !== NOT_RECORDED);
}

/** True when the context has enough recorded figures to say anything. */
export function summarizable(c: Pick<SectionContext, "figures"> | null | undefined): boolean {
  return !!c && recordedFigures(c).length >= MIN_SUMMARY_FIGURES;
}
