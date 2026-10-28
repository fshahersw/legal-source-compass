/**
 * A small XML tree builder for well-formed publisher files (GovInfo GOVMAN): elements with attributes, children and
 * text; comments, processing instructions and the doctype are skipped; the five predefined entities and numeric
 * character references are decoded. Web APIs only, so it runs in the edge runtime. Not a validating parser.
 */

export type XmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside this element (child elements' text excluded), entity-decoded, as written. */
  text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const re =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]!;
    if (m[6] !== undefined) {
      top.text += decodeEntities(m[6]);
      continue;
    }
    if (m[1] !== undefined) {
      top.text += m[1];
      continue;
    }
    const tag = m[3];
    if (!tag) continue;
    if (m[2] === "/") {
      // close: pop to the matching element (tolerates a stray close tag by ignoring it)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const raw = m[4] ?? "";
    let a: RegExpExecArray | null;
    ATTR.lastIndex = 0;
    while ((a = ATTR.exec(raw))) attrs[a[1]!] = decodeEntities(a[3] ?? a[4] ?? "");
    const node: XmlNode = { tag, attrs, children: [], text: "" };
    top.children.push(node);
    if (m[5] !== "/" && !raw.trimEnd().endsWith("/")) stack.push(node);
  }
  return root;
}

/** The first direct child with this tag. */
export const child = (n: XmlNode | null | undefined, tag: string): XmlNode | null =>
  n?.children.find((c) => c.tag === tag) ?? null;

/** Every direct child with this tag. */
export const kids = (n: XmlNode | null | undefined, tag: string): XmlNode[] =>
  n ? n.children.filter((c) => c.tag === tag) : [];

/** Text of the first direct child with this tag, whitespace collapsed; null when empty. */
export function childText(n: XmlNode | null | undefined, tag: string): string | null {
  const c = child(n, tag);
  if (!c) return null;
  const t = allText(c).replace(/\s+/g, " ").trim();
  return t || null;
}

/** All text under a node, in document order. */
export function allText(n: XmlNode): string {
  if (!n.children.length) return n.text;
  return n.text + n.children.map(allText).join(" ");
}
