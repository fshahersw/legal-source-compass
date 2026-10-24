/**
 * buildSectionContext: turns the rows and KPIs a page already holds into the bounded, deterministic context the AI kit
 * sends (title, scope, period, source and up to N labelled figures with units). Pure and tested.
 *
 *   const context = buildSectionContext({
 *     title: "Federal civil cases filed",
 *     scope: "United States",
 *     period: "FY2025",
 *     source: "Federal Judicial Center, Integrated Database",
 *     figures: [
 *       { label: "Cases filed", value: 303716, unit: "cases" },
 *       { label: "Change on FY2024", value: 4.4, unit: "%", decimals: 1 },
 *     ],
 *   });
 *
 * Rules the builder enforces so a page cannot misuse it:
 *  - values become display text ("303,716", "4.4%"); a missing value reads "Not recorded", never zero;
 *  - the order you give is the order sent (use figuresFromRows to rank rows); nothing is reordered behind your back;
 *  - at most `maxFigures` (24 by default, 40 at most) and never more than about 8 KB serialised: figures are cut from the
 *    end, and the context records "N of M shown";
 *  - text is whitespace-collapsed, control characters removed, and cut to the schema's limits.
 */
import {
  DEFAULT_SECTION_FIGURES,
  MAX_SECTION_CONTEXT_BYTES,
  MAX_SECTION_FIGURES,
  NOT_RECORDED,
  cleanText,
  serialisedBytes,
  type SectionContext,
  type SectionFigure,
} from "@/lib/assistant/sectionContext";

export type FigureInput = {
  label: string;
  /** A number (formatted for you), ready-made display text, or null/undefined for "Not recorded". */
  value: number | string | null | undefined;
  /** "cases", "per 100,000 residents", "%"; omit when the value text already carries it ("$3.94 billion"). */
  unit?: string | undefined;
  /** The period this figure covers, when it differs from the section's. */
  period?: string | undefined;
  /** A short qualifier ("partial year"), not prose. */
  note?: string | undefined;
  /** Fraction digits for a numeric value (default: none for a whole number, up to 2 otherwise). */
  decimals?: number | undefined;
};

export type BuildSectionContextInput = {
  title: string;
  /** Anchor id of the section; the AskAiButton overrides it with its `sectionId`. */
  id?: string | undefined;
  scope?: string | null | undefined;
  period?: string | null | undefined;
  /** Source name as printed in the card footer. */
  source?: string | { label: string } | null | undefined;
  figures: readonly FigureInput[];
  maxFigures?: number | undefined;
};

const grouping = new Map<string, Intl.NumberFormat>();
function numberFormat(decimals: number): Intl.NumberFormat {
  let f = grouping.get(String(decimals));
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    grouping.set(String(decimals), f);
  }
  return f;
}

/** A number as display text: thousands commas, no compaction, so the exact digits stay checkable. */
export function formatFigureValue(
  value: number | string | null | undefined,
  decimals?: number,
): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  if (typeof value === "string") return cleanText(value, 48) || NOT_RECORDED;
  if (!Number.isFinite(value)) return NOT_RECORDED;
  const places = decimals ?? (Number.isInteger(value) ? 0 : 2);
  return numberFormat(Math.min(Math.max(places, 0), 6)).format(value);
}

function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "section";
}

function toFigure(input: FigureInput): SectionFigure | null {
  const label = cleanText(input.label, 120);
  if (!label) return null;
  const unit = input.unit ? cleanText(input.unit, 40) : "";
  const period = input.period ? cleanText(input.period, 48) : "";
  const note = input.note ? cleanText(input.note, 140) : "";
  const value = formatFigureValue(input.value, input.decimals);
  return {
    label,
    value,
    // a unit makes no sense on "Not recorded"
    ...(unit && value !== NOT_RECORDED ? { unit } : {}),
    ...(period ? { period } : {}),
    ...(note ? { note } : {}),
  };
}

/** The bounded, deterministic context. The same input always produces the same object, byte for byte. */
export function buildSectionContext(input: BuildSectionContextInput): SectionContext {
  const title = cleanText(input.title, 140) || "Section";
  const cap = Math.min(
    Math.max(1, Math.floor(input.maxFigures ?? DEFAULT_SECTION_FIGURES)),
    MAX_SECTION_FIGURES,
  );
  const seen = new Set<string>();
  const all: SectionFigure[] = [];
  for (const raw of input.figures) {
    const figure = toFigure(raw);
    if (!figure) continue;
    const key = `${figure.label}\u0000${figure.period ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(figure);
  }
  const scope = cleanText(input.scope, 120);
  const period = cleanText(input.period, 80);
  const sourceText =
    typeof input.source === "object" && input.source ? input.source.label : input.source;
  const source = cleanText(sourceText, 200);
  const base = {
    id: input.id && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(input.id) ? input.id : slug(title),
    title,
    ...(scope ? { scope } : {}),
    ...(period ? { period } : {}),
    ...(source ? { source } : {}),
  };

  let kept = all.slice(0, cap);
  const build = (figures: SectionFigure[]): SectionContext => ({
    ...base,
    figures,
    ...(figures.length < all.length ? { total: all.length } : {}),
  });
  // cut from the end until the serialised context fits, leaving a margin for the envelope
  const budget = MAX_SECTION_CONTEXT_BYTES - 256;
  while (kept.length > 1 && serialisedBytes(build(kept)) > budget) kept = kept.slice(0, -1);
  return build(kept);
}

/** Options for figuresFromRows. */
export type RowFigures<T> = {
  label: (row: T) => string;
  value: (row: T) => number | string | null | undefined;
  unit?: string | undefined;
  period?: string | ((row: T) => string | undefined) | undefined;
  note?: ((row: T) => string | undefined) | undefined;
  decimals?: number | undefined;
  /** "desc" (default) ranks by value, largest first; "asc" smallest first; "none" keeps the rows as given. */
  order?: "desc" | "asc" | "none" | undefined;
  /** Rows kept (default 10). */
  limit?: number | undefined;
};

/**
 * Rows to figures, ranked and bounded: numeric values sort by value (ties by label, in code-unit order so the result
 * never depends on the browser's locale), rows with no value go last, and only `limit` rows are kept. Pass the result
 * as `figures` (with `maxFigures` raised if you need more than 24).
 */
export function figuresFromRows<T>(rows: readonly T[], spec: RowFigures<T>): FigureInput[] {
  const order = spec.order ?? "desc";
  const limit = Math.max(0, Math.floor(spec.limit ?? 10));
  const items = rows.map((row, index) => {
    const raw = spec.value(row);
    return {
      row,
      index,
      sortValue: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
      label: spec.label(row),
    };
  });
  if (order !== "none")
    items.sort((a, b) => {
      if (a.sortValue === null || b.sortValue === null) {
        if (a.sortValue === b.sortValue) return a.index - b.index;
        return a.sortValue === null ? 1 : -1;
      }
      const d = order === "desc" ? b.sortValue - a.sortValue : a.sortValue - b.sortValue;
      if (d !== 0) return d;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : a.index - b.index;
    });
  return items.slice(0, limit).map(({ row, label }) => {
    const period = typeof spec.period === "function" ? spec.period(row) : spec.period;
    const note = spec.note?.(row);
    return {
      label,
      value: spec.value(row),
      unit: spec.unit,
      period,
      note,
      decimals: spec.decimals,
    };
  });
}
