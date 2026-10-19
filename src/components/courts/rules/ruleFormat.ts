/** Display helpers for the court rules panel (pure, no data access). */
import {
  RULE_CATEGORIES,
  type RuleCategory,
  type RuleDocument,
  type RuleScope,
} from "@/lib/external/courtRules.functions";

export const SCOPE_HEADINGS: Record<RuleScope, string> = {
  federal_national: "Federal rules",
  federal_local: "This court's local rules",
  state: "State rules of court",
};

/** Categories in reading order (deadlines first), each with the number of practice points across the documents. */
export function categoryTotals(
  docs: RuleDocument[],
): { category: RuleCategory; label: string; count: number }[] {
  const totals = new Map<RuleCategory, number>();
  for (const d of docs)
    for (const [k, n] of Object.entries(d.categories) as [RuleCategory, number][])
      totals.set(k, (totals.get(k) ?? 0) + n);
  return (Object.keys(RULE_CATEGORIES) as RuleCategory[])
    .filter((c) => (totals.get(c) ?? 0) > 0)
    .map((c) => ({ category: c, label: RULE_CATEGORIES[c], count: totals.get(c)! }));
}

/** Documents grouped by scope in the order national, local, state; empty groups left out. */
export function groupDocuments(
  docs: RuleDocument[],
): { scope: RuleScope; heading: string; docs: RuleDocument[] }[] {
  return (Object.keys(SCOPE_HEADINGS) as RuleScope[])
    .map((scope) => ({
      scope,
      heading: SCOPE_HEADINGS[scope],
      docs: docs.filter((d) => d.scope === scope),
    }))
    .filter((g) => g.docs.length > 0);
}

/** "uscourts.gov/…/frcp.pdf" style label for an official address. */
export function hostLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const file = u.pathname.split("/").filter(Boolean).pop();
    return file && file !== host ? `${host}/…/${decodeURIComponent(file)}` : host;
  } catch {
    return url;
  }
}

/** Text shown on one line: runs of whitespace (line breaks from the printed page) become one space. */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The snippet split into plain and matching parts for highlighting (a part matches when it starts one of the
 * query's words), without building HTML.
 */
export function highlightParts(text: string, q: string): { text: string; hit: boolean }[] {
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length > 1)
    .slice(0, 8);
  if (!terms.length) return [{ text, hit: false }];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`((?<![\\p{L}\\p{N}])(?:${escaped.join("|")})[\\p{L}\\p{N}]*)`, "giu");
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
