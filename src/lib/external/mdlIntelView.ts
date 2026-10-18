/**
 * Pure, client-safe helpers for the MDL intelligence views (court-page status, leadership sections, hearing places).
 * Kept apart from mdlIntel.functions.ts so client components never import the server read path.
 */
import type {
  CourtMdl,
  LeadershipBlock,
  LeadershipSection,
  SessionRow,
} from "./mdlIntel.functions";

const fold = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
const ROLE =
  /(lead|liaison|liason|steering|executive|advisory|coordinating|coordination) (counsel|committee)|leadership|(?:plaintiff|defendant)(?:s'|'s|s)? counsel/;
/** A line printed as a role heading inside another block ("Mead Johnson's Co-Liaison Counsel"): short, names a role,
 * ends with the role word and has no comma (so "Jane Doe, Liaison Counsel" stays a line). */
export const isRoleHeadingLine = (line: string) => {
  const t = fold(line);
  return (
    t.length <= 80 &&
    !t.includes(",") &&
    ROLE.test(t) &&
    /(counsel|committee|leadership):?$/.test(t)
  );
};
const containsRun = (outer: string[], inner: string[]) =>
  inner.length <= outer.length &&
  outer.some((_, i) => inner.every((line, j) => outer[i + j] === line));

// Letters, digits, apostrophes and hyphens join a word, so "lead counsel" is not found inside "co-lead counsel".
const WORD = /[\p{L}\p{N}'-]/u;
/** End index of the first whole-word occurrence of `needle` in `hay` at or after `from`, or -1. */
function findWord(hay: string, needle: string, from: number) {
  if (!needle) return from;
  for (let i = hay.indexOf(needle, from); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = hay[i - 1];
    const after = hay[i + needle.length];
    const startOk = !before || !WORD.test(before) || !WORD.test(needle[0]!);
    const endOk = !after || !WORD.test(after) || !WORD.test(needle[needle.length - 1]!);
    if (startOk && endOk) return i + needle.length;
  }
  return -1;
}
/** True when every part occurs in `hay` as whole words, in order, without overlapping. */
const containsInOrder = (hay: string, parts: string[]) => {
  let at = 0;
  for (const part of parts) {
    at = findWord(hay, part, at);
    if (at < 0) return false;
  }
  return true;
};

type Derived = LeadershipSection & {
  explicitGroup: boolean;
  /** Folded headings an empty section may label as their group; null for a section with lines. */
  members: Set<string> | null;
};

/**
 * Ordered, non-overlapping leadership sections from stored blocks. Older records hold overlapping blocks: each
 * heading kept up to 12 following elements, which included the next headings and their lines. Here:
 * - a block's lines stop at the first line that is another block's heading (that block lists them);
 * - a role heading printed as a line starts its own section;
 * - a section with no lines of its own labels, as `group`, only the sections whose headings it was printed above:
 *   a stored block groups the headings among its own stored lines, a role line groups the role lines after it in the
 *   same block; the group ends at the first section outside that set or on another page. A role line with nothing
 *   under it stays a section with no lines (shown as "Names not recorded"), never a group for the next block;
 * - a section is dropped when its heading and lines are already listed earlier: the same heading with the same run
 *   of lines, or its heading and every line, in order and as whole words, inside one earlier line (older records
 *   joined a whole role list into one line). The same person under two roles stays under both.
 * Lines are kept verbatim (never split, merged or rewritten). Records that store `group` use it as stored.
 */
export function leadershipSections(blocks: LeadershipBlock[]): LeadershipSection[] {
  const headings = new Set(blocks.map((b) => fold(b.heading)));
  const derived: Derived[] = [];
  for (const b of blocks) {
    const base = {
      group: b.group,
      explicitGroup: b.group !== null,
      url: b.url,
      contactLinesRemoved: b.contactLinesRemoved,
      updated: b.updated,
      moreLines: 0,
      members: null,
    };
    let current: Derived = { ...base, heading: b.heading, lines: [] };
    const own = [current];
    let cut = false;
    b.lines.forEach((line, i) => {
      if (cut) return;
      const key = fold(line);
      if (i === 0 && key === fold(b.heading)) return; // the heading repeated as the first line
      if (headings.has(key)) {
        cut = true; // another block's heading: the lines after it belong to that block
        return;
      }
      if (isRoleHeadingLine(line)) {
        current = { ...base, heading: line, lines: [] };
        own.push(current);
        return;
      }
      current.lines.push(line);
    });
    if (!cut) current.moreLines = b.linesNotShown;
    own.forEach((s, k) => {
      if (s.lines.length || s.moreLines) return;
      s.members =
        k === 0
          ? // the stored heading: the headings printed after it in its own lines
            new Set(b.lines.map(fold).filter((l) => l !== fold(b.heading)))
          : new Set(own.slice(k + 1).map((t) => fold(t.heading))); // a role line: role lines after it here
    });
    derived.push(...own);
  }
  const out: LeadershipSection[] = [];
  let group: { heading: string; url: string; members: Set<string> } | null = null;
  for (const { explicitGroup, members, ...s } of derived) {
    if (group && (group.url !== s.url || !group.members.has(fold(s.heading)))) group = null;
    if (members?.size) {
      group = { heading: s.heading, url: s.url, members };
      continue;
    }
    const section = { ...s, group: explicitGroup ? s.group : (group?.heading ?? null) };
    const heading = fold(section.heading);
    const lines = section.lines.map(fold);
    const seen = out.some(
      (t) =>
        (fold(t.heading) === heading &&
          (lines.length === 0 || containsRun(t.lines.map(fold), lines))) ||
        t.lines.some((line) => containsInOrder(fold(line), [heading, ...lines])),
    );
    if (!seen) out.push(section);
  }
  return out;
}

/** Consecutive sections that share a non-null group form one run under that label; ungrouped sections stand alone. */
export function leadershipRuns<T extends Pick<LeadershipSection, "group">>(
  sections: T[],
): { group: string | null; sections: T[] }[] {
  const runs: { group: string | null; sections: T[] }[] = [];
  for (const s of sections) {
    const last = runs.at(-1);
    if (s.group !== null && last && last.group === s.group) last.sections.push(s);
    else runs.push({ group: s.group, sections: [s] });
  }
  return runs;
}

const countOf = (count: number, word: string) =>
  `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

/**
 * What extraction yielded from a court-page record: "orders" (orders were extracted), "statements" (no order was
 * extracted, but quoted statements or leadership were), "nothing" (pages fetched, nothing extracted), "failed"
 * (located but no page could be fetched) or "none" (no page located). This describes what the extractor read, not
 * what the court page contains. Derived from the record, never from the stored flag label.
 */
export function courtPageYield(
  c: CourtMdl,
): "orders" | "statements" | "nothing" | "failed" | "none" {
  if (!c.pages.length) return c.failedPages.length ? "failed" : "none";
  if (c.ordersTotal) return "orders";
  const quoted = c.quoteCounts.leadership + c.quoteCounts.bellwether + c.quoteCounts.settlement;
  return quoted || c.leadership.length ? "statements" : "nothing";
}

/** One line saying what extraction read from the court pages, for rows where no dated order can be shown. */
export function courtPageStatus(c: CourtMdl) {
  const failed = c.failedPages.length
    ? `${countOf(c.failedPages.length, "court page")} could not be fetched`
    : null;
  const quoted = c.quoteCounts.leadership + c.quoteCounts.bellwether + c.quoteCounts.settlement;
  const where = c.pages.length === 1 ? "the court page" : "the court pages";
  const parts: (string | null)[] = (() => {
    switch (courtPageYield(c)) {
      case "none":
        return ["No court page located"];
      case "failed":
        return [`Court page located, but ${failed}`];
      case "orders": {
        const dated = c.latestOrders.filter((o) => o.date);
        const listed = `${countOf(c.ordersTotal, "order")} listed`;
        return [
          dated.some((o) => !o.vacated)
            ? listed
            : dated.length
              ? `${listed}; the latest dated ${dated.length === 1 ? "order is" : "orders are"} marked vacated`
              : `${listed}, no order date extracted`,
          failed,
        ];
      }
      case "nothing":
        return [`Nothing extracted from ${where}`, failed];
      case "statements":
        return [
          `No orders extracted from ${where}`,
          quoted ? `${countOf(quoted, "statement")} quoted` : null,
          c.leadership.length
            ? `leadership listed (${countOf(c.leadership.length + c.leadershipMore, "role")})`
            : null,
          failed,
        ];
    }
  })();
  return parts.filter(Boolean).join(" · ");
}

/** Location as shown: the recorded building, plus the printed city/state or an explicit "city not recorded". */
export function sessionPlace(s: Pick<SessionRow, "location" | "city" | "state">) {
  const where = [s.city, s.state].filter(Boolean).join(", ");
  if (!s.location) return where || "Not recorded";
  return where ? `${s.location} · ${where}` : `${s.location} · city not recorded`;
}
