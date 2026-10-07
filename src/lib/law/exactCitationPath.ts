/**
 * Official section paths named by a limitations citation.
 * A path is emitted only when the citation states that section number exactly.
 * A range, a second title, or an unrecognized form returns null so nothing is linked.
 */
/** Publishers whose citation_path is the dotted section number printed after the section sign. */
const DOTTED_PATH_STATES = new Set(["FL", "KY", "MI", "MN", "MO", "NV", "OR", "WI"]);

export function exactCitationPaths(state: string, citation: string): string[] | null {
  const text = withoutSectionRanges(citation.trim());
  const usps = state.toUpperCase();
  if (!text.trim()) return null;
  if (usps === "OK") return oklahomaPaths(text);
  const paths = omitSectionHalf(
    omitDottedPrefix([
      ...new Set([
        ...(hyphenPaths(text) ?? []),
        ...(dottedHyphenPaths(text) ?? []),
        ...(sectionSignPaths(text) ?? []),
        ...(vermontTitleSections(text) ?? []),
        ...(usps === "IL" ? (illinoisPaths(text) ?? []) : []),
        ...(usps === "MA" ? (massachusettsPaths(text) ?? []) : []),
        ...(usps === "ME" ? (mainePaths(text) ?? []) : []),
        ...(usps === "DE" ? (delawarePaths(text) ?? []) : []),
        ...(usps === "MD" ? (marylandPaths(text) ?? []) : []),
        ...(usps === "LA" ? (louisianaRevisedStatutePaths(text) ?? []) : []),
        ...(usps === "LA" ? (louisianaCivilCodePaths(text) ?? []) : []),
        ...(DOTTED_PATH_STATES.has(usps) ? (dottedPaths(text) ?? []) : []),
      ]),
    ]),
  );
  return paths.length ? paths : null;
}

/**
 * A written range such as "15-51-10 to 15-51-60" is removed and not linked.
 * An exact section beside that range is still linked.
 * "to" in ordinary prose, such as "applied to", is not a range.
 */
function withoutSectionRanges(text: string): string {
  return text.replace(
    /(?:§§?\s*)?\d[\dA-Za-z.-]*(?:\([^)]*\))*\s+(?:to|through)\s+(?:§§?\s*)?\d[\dA-Za-z.-]*(?:\([^)]*\))*/gi,
    " ",
  );
}

/** A bare section number that is already the section half of a title, chapter, or article token is not a second section. */
function omitSectionHalf(paths: string[]): string[] {
  return paths.filter(
    (path) =>
      !paths.some(
        (other) =>
          other !== path &&
          (other.endsWith(`/${path}`) || other.endsWith(` ${path}`) || other.endsWith(`:${path}`)),
      ),
  );
}

/** A dotted token that is only the front of a longer dotted-hyphen token is not a second section. */
function omitDottedPrefix(paths: string[]): string[] {
  return paths.filter(
    (path) =>
      !paths.some((other) => other !== path && other.startsWith(`${path}-`) && path.includes(".")),
  );
}

export function statuteNativeId(state: string, citationPath: string): string {
  return `${state.toUpperCase()}:${citationPath}`;
}

/**
 * Illinois compiled-statute paths such as `735 ILCS 5/13-202`.
 * The chapter, act, and section are one path. A parenthetical is not included.
 * `735 ILCS 5/13-202` is not `735 ILCS 5/13-202.1` or `220 ILCS 5/13-202`.
 */
function illinoisPaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re =
    /\b(\d{1,4} ILCS \d+[A-Za-z]?\/\d+[A-Za-z]*(?:-\d+[A-Za-z]*)*(?:\.\d+[A-Za-z]*)?)(?![A-Za-z0-9])/g;
  for (const match of citation.matchAll(re)) {
    const path = match[1];
    if (!path || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths.length ? paths : null;
}

/**
 * Massachusetts paths such as `Mass. Gen. Laws ch. 260, § 2A` and `ch. 106, § 2-318`.
 * The chapter and the section are one path. A parenthetical is not included.
 * `§ 2-318` is not `§ 2`. `§ 2A` is not `§ 2` or `§ 2B`.
 */
function massachusettsPaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re =
    /\b(?:ch(?:apter)?|c)\.?\s+(\d+[A-Za-z]*)\s*,?\s*§§?\s*(\d+(?:-\d+)?[A-Za-z]*)(?![A-Za-z0-9-])/gi;
  for (const match of citation.matchAll(re)) {
    const chapter = match[1]?.toUpperCase();
    const section = match[2]?.toUpperCase();
    if (!chapter || !section) continue;
    const path = `${chapter}:${section}`;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths.length ? paths : null;
}

/**
 * Maine paths such as `14 M.R.S. § 752` and `14 M.R.S. § 752-B`.
 * The title and the section are one path. A parenthetical is not included.
 * `§ 752` is not `§ 752-B`. The bare section number is not a second path.
 */
function mainePaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\b(\d+(?:-[A-Za-z])?)\s+M\.R\.S\.?\s*§§?\s*(\d+(?:-[A-Za-z]+)?)(?![A-Za-z0-9-])/gi;
  for (const match of citation.matchAll(re)) {
    const title = match[1]?.toUpperCase();
    const section = match[2]?.toUpperCase();
    if (!title || !section) continue;
    const path = `${title}/${section}`;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths.length ? paths : null;
}

/**
 * Delaware paths such as `10 Del. C. § 8119` and `10 Del. C. § 8131(a)`.
 * The title and the section are one path. A parenthetical is not included.
 * A note such as `(narrow variant: …, …)` is not a second section.
 * Title 10 section 8131 is not the section 8131 in another title.
 */
function delawarePaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\b(\d+[A-Za-z]?)\s+Del\.?\s+C\.?\s*§§?\s*([^.;]+)/gi;
  for (const match of citation.matchAll(re)) {
    const title = match[1]?.toUpperCase();
    if (!title) continue;
    const listed = (match[2] ?? "").replace(/\s+\(.*$/s, "");
    for (const raw of listed.split(",")) {
      const section = raw
        .trim()
        .replace(/\s+/g, "")
        .replace(/(?:\([^)]*\))+$/g, "")
        .replace(/\.$/, "");
      if (!/^\d{3,}$/.test(section)) continue;
      const path = `${title}/${section}`;
      if (!paths.includes(path)) paths.push(path);
    }
  }
  return paths.length ? paths : null;
}

/**
 * Maryland Courts and Judicial Proceedings paths such as `Md. Code, Cts. & Jud. Proc. § 5-101`.
 * The article and the section are one path, `gcj 5-101`. A parenthetical is not included.
 * The bare number `5-101` is also published in other articles, so it is not a second path.
 */
function marylandPaths(citation: string): string[] | null {
  if (!/\bCts\.\s*&\s*Jud\.\s*Proc\./i.test(citation)) return null;
  const paths: string[] = [];
  const re = /§§?\s*(\d+(?:\.\d+)?-\d+(?:\.\d+)?)(?![A-Za-z0-9.])/g;
  for (const match of citation.matchAll(re)) {
    const section = match[1];
    if (!section) continue;
    const path = `gcj ${section}`;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths.length ? paths : null;
}

/**
 * Louisiana Revised Statutes paths such as `La. R.S. 9:5628(A)`.
 * The title and the section are one path, `9:5628`. A parenthetical is not included.
 * `9:5628` is not `9:5628.1`. A Civil Code article is not a Revised Statutes section.
 */
function louisianaRevisedStatutePaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\bR\.S\.\s*(\d+[A-Z]?):(\d+(?:\.\d+)?)(?![A-Za-z0-9.])/gi;
  for (const match of citation.matchAll(re)) {
    const title = match[1]?.toUpperCase();
    const section = match[2];
    if (!title || !section) continue;
    const path = `${title}:${section}`;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths.length ? paths : null;
}

/**
 * Louisiana Civil Code articles such as `La. Civ. Code art. 2315.2(B)`.
 * The article number is the path. A parenthetical is not included.
 * `2315.2` is not `2315.1` or `2315.10`.
 */
function louisianaCivilCodePaths(citation: string): string[] | null {
  if (!/\bCiv\.?\s+Code\b/i.test(citation)) return null;
  const paths: string[] = [];
  const re = /\bart\.?\s*(\d+(?:\.\d+)?)(?![A-Za-z0-9.])/gi;
  for (const match of citation.matchAll(re)) {
    const path = match[1];
    if (!path || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths.length ? paths : null;
}

/** Dotted official paths such as Fla. Stat. § 95.11, KRS 413.140, MCL 600.5851b, NRS 11.190, NRS 41A.097, and ORS 12.110. The whole token, including one chapter letter and a trailing letter. A parenthetical is not included. */
function dottedPaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\b(\d{1,4}[A-Za-z]?\.\d{1,4}[A-Za-z]*)(?![A-Za-z0-9])/g;
  for (const match of citation.matchAll(re)) {
    const path = match[1];
    if (!path || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths.length ? paths : null;
}

/** Title-and-section numbers such as Va. Code § 8.01-243. A parenthetical or later subdivision is not included. */
function dottedHyphenPaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\b(\d{1,4}\.\d{1,4}-\d{1,4}(?:\.\d{1,4})?)(?![A-Za-z0-9.])/g;
  for (const match of citation.matchAll(re)) {
    const path = match[1];
    if (!path || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths.length ? paths : null;
}

/**
 * Section numbers written after a section sign.
 * A bare number such as § 8119, a multi-part number such as § 09.10.070,
 * or a colon number such as § 508:4. A following paragraph, such as ", I", is not part of the number.
 * A parenthetical is not part of the number. A one- or two-digit session-law section is not taken.
 */
function sectionSignPaths(citation: string): string[] | null {
  const paths: string[] = [];
  for (const match of citation.matchAll(/§§?\s*([^;]+)/g)) {
    const chunk = match[1] ?? "";
    for (const raw of chunk.split(",")) {
      const token = raw
        .trim()
        .replace(/\s+/g, "")
        .replace(/(?:\([^)]*\))+$/g, "")
        .replace(/\)+$/, "")
        .replace(/\.$/, "");
      if (!token || paths.includes(token)) continue;
      if (
        /^\d{3,}$/.test(token) ||
        /^\d{1,2}(?:\.\d{2,3}){2,}$/.test(token) ||
        /^\d+(?:-[A-Z])?:\d+(?:-[A-Za-z])?$/.test(token)
      )
        paths.push(token);
    }
  }
  return paths.length ? paths : null;
}

/** `12 V.S.A. § 512(4)` names title 12 and section 512. The parenthetical is not part of the section. */
function vermontTitleSections(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\b(\d+[A-Za-z]?)\s+V\.S\.A\.\s*§§?\s*(\d+)(?!\d)/gi;
  for (const match of citation.matchAll(re)) {
    const title = match[1];
    const section = match[2];
    if (!title || !section) continue;
    const path = `${title}/${section}`;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths.length ? paths : null;
}

function hyphenPaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /(?<!\d\.)\b(\d{1,2}[A-Z]?(?:-\d{1,4}[A-Za-z]?){1,8}(?:\.\d{1,4})?)(?!\d)/g;
  for (const match of citation.matchAll(re)) {
    const path = match[1];
    if (!path || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths.length ? paths : null;
}

function oklahomaPaths(citation: string): string[] | null {
  const titles = [...citation.matchAll(/\btit(?:le)?\.?\s+(\d{1,2}[A-Z]?)\b/gi)].map((match) =>
    match[1]!.toUpperCase(),
  );
  const unique = [...new Set(titles)];
  if (unique.length > 1) return null;
  if (unique.length === 0) return hyphenPaths(citation);
  const title = unique[0]!;
  const chunks = [...citation.matchAll(/§§?\s*([^.;]+)/g)].map((match) => match[1]!);
  if (!chunks.length) return hyphenPaths(citation);
  const paths: string[] = [];
  for (const chunk of chunks) {
    for (const raw of chunk.split(",")) {
      const token = raw.trim().replace(/\s+/g, "");
      if (!token) continue;
      // A parenthetical, including a subsection range such as (6)–(7), is not another section.
      const bare = token.replace(
        /(?:\([0-9A-Za-z]+\)(?:\s*[\u2013\u2014-]\s*\([0-9A-Za-z]+\))?)+$/g,
        "",
      );
      if (!bare || !/^[0-9]+(?:\.[0-9]+)?(?:-[0-9A-Za-z.]+)*$/.test(bare)) return null;
      const path = bare.startsWith(`${title}-`) ? bare : `${title}-${bare}`;
      if (!paths.includes(path)) paths.push(path);
    }
  }
  return paths.length ? paths : null;
}

/** The final hyphen piece of a path such as `10-81-8119`. Slash paths stay with the sec_ rule. */
export function lastHyphenSegment(citationPath: string): string | null {
  if (citationPath.includes("/")) return null;
  const pieces = citationPath.split("-");
  if (pieces.length < 2) return null;
  const segment = pieces[pieces.length - 1] ?? "";
  return segment || null;
}

/** Last path segment after a literal `sec_` prefix. A `secs_` range is not a section token. */
export function sectionTokenAfterSec(citationPath: string): string | null {
  const segment = citationPath.split("/").pop() ?? "";
  const match = /^sec_(.+)$/.exec(segment);
  return match?.[1] ?? null;
}

/** Numbers recorded on one hierarchy level. */
export function storedHierarchyNumbers(hierarchy: unknown, level: string): string[] {
  if (!Array.isArray(hierarchy)) return [];
  const numbers: string[] = [];
  for (const item of hierarchy) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row["level"] !== level) continue;
    const number = row["number"];
    if (typeof number !== "string") continue;
    const trimmed = number.trim();
    if (trimmed) numbers.push(trimmed);
  }
  return numbers;
}

/** Section numbers recorded on the hierarchy. Chapter and title numbers are not included. */
export function storedSectionNumbers(hierarchy: unknown): string[] {
  return storedHierarchyNumbers(hierarchy, "section");
}

/**
 * True when the citation token equals the path segment after `sec_`,
 * the final hyphen segment, or a stored section number.
 * A heading, a chapter number, or a nearby number does not match.
 */
export function tokenEqualsStoredSection(
  token: string,
  citationPath: string,
  sectionNumbers: readonly string[],
  titleNumbers: readonly string[] = [],
): boolean {
  if (!token) return false;
  const titled =
    /^(\d+[A-Za-z]?)\/(\d+)$/.exec(token) ??
    /^(\d+(?:-[A-Za-z])?)\/(\d+(?:-[A-Za-z]+)?)$/.exec(token);
  if (titled) return titleNumbers.includes(titled[1]!) && sectionNumbers.includes(titled[2]!);
  if (sectionTokenAfterSec(citationPath) === token) return true;
  if (lastHyphenSegment(citationPath) === token) return true;
  return sectionNumbers.includes(token);
}

/** The one stored section the token names. Zero or several matches stay unlinked. */
export function onlyExactStoredSection<
  T extends {
    citationPath: string;
    sectionNumbers: readonly string[];
    titleNumbers?: readonly string[];
  },
>(token: string, rows: readonly T[]): T | null {
  const matches = rows.filter((row) =>
    tokenEqualsStoredSection(token, row.citationPath, row.sectionNumbers, row.titleNumbers ?? []),
  );
  return matches.length === 1 ? matches[0]! : null;
}
