/**
 * Document generation for the agent: one Markdown source written as a Word document (.docx), a PDF, a self-contained
 * HTML page, Markdown or CSV. Pure JavaScript writers (docx, pdf-lib) so it runs wherever the site's server runs.
 * Server-only.
 */
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { inlineText, markdownToHtml, parseMarkdown, type Inline } from "./markdown";

export const DOC_FORMATS = ["docx", "pdf", "html", "md", "csv"] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];
export const DOC_MIME: Record<DocFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  html: "text/html",
  md: "text/markdown",
  csv: "text/csv",
};

function runs(
  inl: Inline[],
  base: { size?: number; bold?: boolean } = {},
): (TextRun | ExternalHyperlink)[] {
  return inl.map((i) => {
    const run = new TextRun({
      text: i.text,
      ...(base.bold || i.bold ? { bold: true } : {}),
      ...(i.italic ? { italics: true } : {}),
      ...(i.code ? { font: "Consolas" } : {}),
      ...(base.size ? { size: base.size } : {}),
      ...(i.href ? { style: "Hyperlink" } : {}),
    });
    return i.href && /^https?:\/\//.test(i.href)
      ? new ExternalHyperlink({ link: i.href, children: [run] })
      : run;
  });
}

export async function toDocx(title: string, md: string, subtitle?: string): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }),
  ];
  if (subtitle)
    children.push(
      new Paragraph({
        children: [new TextRun({ text: subtitle, italics: true, color: "5B6474" })],
      }),
    );
  for (const b of parseMarkdown(md)) {
    if (b.type === "heading")
      children.push(
        new Paragraph({
          heading:
            b.level === 1
              ? HeadingLevel.HEADING_1
              : b.level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          children: runs(b.inlines),
        }),
      );
    else if (b.type === "paragraph")
      children.push(new Paragraph({ children: runs(b.inlines), spacing: { after: 120 } }));
    else if (b.type === "quote")
      children.push(
        new Paragraph({
          children: runs(b.inlines),
          indent: { left: 400 },
          spacing: { after: 120 },
        }),
      );
    else if (b.type === "code")
      for (const line of b.text.split("\n"))
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line || " ", font: "Consolas", size: 18 })],
          }),
        );
    else if (b.type === "list")
      b.items.forEach((it, k) =>
        children.push(
          new Paragraph({
            children: [new TextRun({ text: b.ordered ? `${k + 1}. ` : "• " }), ...runs(it)],
            indent: { left: 360, hanging: 260 },
            spacing: { after: 60 },
          }),
        ),
      );
    else if (b.type === "table")
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: b.header.map(
                (c) =>
                  new TableCell({
                    children: [new Paragraph({ children: runs(c, { bold: true }) })],
                  }),
              ),
            }),
            ...b.rows.map(
              (r) =>
                new TableRow({
                  children: b.header.map(
                    (_, k) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: runs(r[k] ?? []),
                            alignment: /^[-−]?[\d,.]+%?×?$/.test(inlineText(r[k] ?? []))
                              ? AlignmentType.RIGHT
                              : AlignmentType.LEFT,
                          }),
                        ],
                      }),
                  ),
                }),
            ),
          ],
        }),
        new Paragraph({ children: [] }),
      );
  }
  const doc = new Document({
    creator: "Research workspace navigator",
    title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

/** Characters the standard PDF fonts cannot draw become close ASCII equivalents. */
function pdfSafe(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00D7/g, "x")
    .replace(/\u2192/g, "->")
    .replace(/\u00B7/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "");
}

export async function toPdf(title: string, md: string, subtitle?: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Research workspace navigator");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const W = 612;
  const H = 792;
  const M = 56;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.063, 0.086, 0.141);
  const muted = rgb(0.357, 0.392, 0.455);
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const write = (
    text: string,
    font: PDFFont,
    size: number,
    opts: { indent?: number; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ) => {
    const indent = opts.indent ?? 0;
    const maxW = W - 2 * M - indent;
    const words = pdfSafe(text).split(/\s+/).filter(Boolean);
    let line = "";
    const flush = () => {
      if (y < M + size) newPage();
      page.drawText(line, { x: M + indent, y, size, font, color: opts.color ?? ink });
      y -= size * 1.38;
      line = "";
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxW && line) flush();
      line = line ? `${line} ${w}` : w;
    }
    if (line) flush();
    y -= opts.gap ?? 4;
  };
  write(title, bold, 20, { gap: 2 });
  if (subtitle) write(subtitle, regular, 10, { color: muted, gap: 10 });
  for (const b of parseMarkdown(md)) {
    if (b.type === "heading") {
      y -= 6;
      write(inlineText(b.inlines), bold, b.level === 1 ? 16 : b.level === 2 ? 13.5 : 12, {
        gap: 4,
      });
    } else if (b.type === "paragraph") write(inlineText(b.inlines), regular, 10.5, { gap: 6 });
    else if (b.type === "quote")
      write(inlineText(b.inlines), regular, 10.5, { indent: 14, color: muted, gap: 6 });
    else if (b.type === "code")
      for (const l of b.text.split("\n")) write(l || " ", mono, 9, { gap: 0 });
    else if (b.type === "list")
      b.items.forEach((it, k) =>
        write(`${b.ordered ? `${k + 1}.` : "-"} ${inlineText(it)}`, regular, 10.5, {
          indent: 10,
          gap: 2,
        }),
      );
    else if (b.type === "table") {
      const cols = b.header.length || 1;
      const colW = (W - 2 * M) / cols;
      const row = (cellsIn: Inline[][], font: PDFFont) => {
        if (y < M + 14) newPage();
        cellsIn.slice(0, cols).forEach((c, k) => {
          let t = pdfSafe(inlineText(c));
          while (t.length > 1 && font.widthOfTextAtSize(t, 9) > colW - 6) t = `${t.slice(0, -2)}.`;
          page.drawText(t, { x: M + k * colW, y, size: 9, font, color: ink });
        });
        y -= 13;
      };
      row(b.header, bold);
      page.drawLine({
        start: { x: M, y: y + 9 },
        end: { x: W - M, y: y + 9 },
        thickness: 0.5,
        color: muted,
      });
      for (const r of b.rows) row(r, regular);
      y -= 6;
    }
  }
  return await pdf.save();
}

/** CSV from the first table in the Markdown (or the Markdown itself when it already is CSV). */
export function toCsv(md: string): string {
  const table = parseMarkdown(md).find((b) => b.type === "table");
  if (!table || table.type !== "table") return md;
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [table.header, ...table.rows]
    .map((r) => r.map((c) => q(inlineText(c))).join(","))
    .join("\n");
}

export async function renderDocument(
  format: DocFormat,
  title: string,
  md: string,
  subtitle?: string,
): Promise<{ bytes: Uint8Array | null; text: string | null; mime: string }> {
  const mime = DOC_MIME[format];
  if (format === "docx") return { bytes: await toDocx(title, md, subtitle), text: null, mime };
  if (format === "pdf") return { bytes: await toPdf(title, md, subtitle), text: null, mime };
  if (format === "html")
    return { bytes: null, text: markdownToHtml(title, md, subtitle ? { subtitle } : {}), mime };
  if (format === "csv") return { bytes: null, text: toCsv(md), mime };
  return { bytes: null, text: `# ${title}\n\n${subtitle ? `_${subtitle}_\n\n` : ""}${md}`, mime };
}
