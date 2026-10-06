/**
 * Official section paths named by a limitations citation.
 * A path is emitted only when the citation states that section number exactly.
 * A range, a second title, or an unrecognized form returns null so nothing is linked.
 */
/** Publishers whose citation_path is the dotted section number printed after the section sign. */
const DOTTED_PATH_STATES = new Set(["FL", "MI", "MO", "WI"]);

export function exactCitationPaths(state: string, citation: string): string[] | null {
  const text = citation.trim();
  const usps = state.toUpperCase();
  if (!text || /\b(?:to|through)\b/i.test(text)) return null;
  if (usps === "OK") return oklahomaPaths(text);
  const paths = [
    ...new Set([
      ...(hyphenPaths(text) ?? []),
      ...(DOTTED_PATH_STATES.has(usps) ? (dottedPaths(text) ?? []) : []),
    ]),
  ];
  return paths.length ? paths : null;
}

export function statuteNativeId(state: string, citationPath: string): string {
  return `${state.toUpperCase()}:${citationPath}`;
}

/** Dotted official paths such as Fla. Stat. § 95.11 and MCL 600.5805. The whole number only. */
function dottedPaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\b(\d{1,4}\.\d{1,4})(?!\d)/g;
  for (const match of citation.matchAll(re)) {
    const path = match[1];
    if (!path || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths.length ? paths : null;
}

function hyphenPaths(citation: string): string[] | null {
  const paths: string[] = [];
  const re = /\b(\d{1,2}[A-Z]?(?:-\d{1,4}[A-Za-z]?){1,8}(?:\.\d{1,4})?)(?!\d)/g;
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
      const bare = token.replace(/(?:\([0-9A-Za-z]+\))+$/g, "");
      if (!bare || !/^[0-9]+(?:\.[0-9]+)?(?:-[0-9A-Za-z.]+)*$/.test(bare)) return null;
      const path = bare.startsWith(`${title}-`) ? bare : `${title}-${bare}`;
      if (!paths.includes(path)) paths.push(path);
    }
  }
  return paths.length ? paths : null;
}
