/**
 * A small, strict Markdown reader for agent documents: headings, paragraphs, bullet and numbered lists, tables,
 * code blocks and quotes, with bold, italic, code and links inline. It feeds the Word, PDF and HTML writers, so every
 * format shows the same content. Pure; never evaluates HTML (any tag is escaped as text).
 */
export type Inline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "code"; text: string }
  | { type: "quote"; inlines: Inline[] };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    if (m[2]) out.push({ text: m[2], bold: true });
    else if (m[4]) out.push({ text: m[4], italic: true });
    else if (m[6]) out.push({ text: m[6], code: true });
    else if (m[8] && m[9]) out.push({ text: m[8], href: m[9] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out.filter((i) => i.text);
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({
        type: "heading",
        level: h[1]!.length as 1 | 2 | 3,
        inlines: parseInline(h[2]!.trim()),
      });
      i++;
      continue;
    }
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)
    ) {
      const header = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!))
        items.push(parseInline(lines[i++]!.replace(/^\s*([-*+]|\d+[.)])\s+/, "")));
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">"))
        body.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push({ type: "quote", inlines: parseInline(body.join(" ")) });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,3}\s|```|>|\s*([-*+]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(lines[i]!)
    )
      para.push(lines[i++]!.trim());
    blocks.push({ type: "paragraph", inlines: parseInline(para.join(" ")) });
  }
  return blocks;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeHref = (h: string) => (/^(https?:\/\/|\/(?!\/))/i.test(h) ? h : null);

export function inlineHtml(inl: Inline[]): string {
  return inl
    .map((i) => {
      let t = esc(i.text);
      if (i.code) t = `<code>${t}</code>`;
      if (i.bold) t = `<strong>${t}</strong>`;
      if (i.italic) t = `<em>${t}</em>`;
      const href = i.href ? safeHref(i.href) : null;
      if (href) t = `<a href="${esc(href)}">${t}</a>`;
      return t;
    })
    .join("");
}

export const inlineText = (inl: Inline[]) => inl.map((i) => i.text).join("");

/** A self-contained HTML document (no scripts, no external assets). */
export function markdownToHtml(
  title: string,
  md: string,
  meta: { subtitle?: string } = {},
): string {
  const body = parseMarkdown(md)
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `<h${b.level + 1}>${inlineHtml(b.inlines)}</h${b.level + 1}>`;
        case "paragraph":
          return `<p>${inlineHtml(b.inlines)}</p>`;
        case "list":
          return `<${b.ordered ? "ol" : "ul"}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
        case "table":
          return `<table><thead><tr>${b.header.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`;
        case "code":
          return `<pre><code>${esc(b.text)}</code></pre>`;
        case "quote":
          return `<blockquote>${inlineHtml(b.inlines)}</blockquote>`;
      }
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(
    title,
  )}</title><style>body{font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#101624;max-width:760px;margin:40px auto;padding:0 20px}h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:28px 0 8px}h3{font-size:16px;margin:22px 0 6px}.sub{color:#5b6474;margin:0 0 24px}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13.5px}th,td{border-bottom:1px solid #e3e6eb;padding:6px 8px;text-align:left}th{background:#f4f6f9}code{font:13px ui-monospace,Menlo,monospace;background:#f4f6f9;padding:1px 4px;border-radius:4px}pre{background:#f4f6f9;padding:12px;border-radius:8px;overflow:auto}blockquote{margin:12px 0;padding-left:12px;border-left:3px solid #2a78d6;color:#3b4454}a{color:#1c5cab}@media (prefers-color-scheme:dark){body{background:#0f141b;color:#e6e9ef}th,code,pre{background:#1b2330}th,td{border-color:#2a3342}.sub{color:#8a93a5}a{color:#6fa9ee}}</style></head><body><h1>${esc(
    title,
  )}</h1>${meta.subtitle ? `<p class="sub">${esc(meta.subtitle)}</p>` : ""}\n${body}</body></html>`;
}
