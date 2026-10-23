import { useRouter } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CITATION_STATUS, type CitationMark } from "./citationStatus";
import { safeHref } from "./markdownLinks";

/** In-app link that navigates without a page load (modifier clicks open normally). */
export function InternalLink({
  href,
  children,
  className = "text-primary underline underline-offset-2",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        router.history.push(href);
      }}
    >
      {children}
    </a>
  );
}

/** Plain text with each unresolved citation wrapped in a visible mark that names its status; the text itself is unchanged. */
function marked(text: string, marks: CitationMark[], key: string): ReactNode[] {
  if (!marks.length || !text) return [text];
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  for (;;) {
    let best: { at: number; mark: CitationMark } | null = null;
    for (const mark of marks) {
      const at = rest.indexOf(mark.text);
      if (
        at >= 0 &&
        (!best || at < best.at || (at === best.at && mark.text.length > best.mark.text.length))
      )
        best = { at, mark };
    }
    if (!best) break;
    if (best.at) out.push(rest.slice(0, best.at));
    const status = CITATION_STATUS[best.mark.status];
    out.push(
      <span
        key={`${key}-m${n++}`}
        className={cn("underline decoration-wavy underline-offset-2", status.mark)}
        title={`${status.label}: ${best.mark.reason}`}
        data-citation-status={best.mark.status}
      >
        {best.mark.text}
        <span className="sr-only"> (citation {status.label.toLowerCase()})</span>
      </span>,
    );
    rest = rest.slice(best.at + best.mark.text.length);
  }
  if (rest) out.push(rest);
  return out;
}

/** Inline markdown: `code`, **bold**, *italic*, [text](href). Everything else stays text; no HTML is interpreted. */
function inline(text: string, key: string, marks: CitationMark[] = []): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    const k = `${key}-${i++}`;
    if (m.index > last) out.push(...marked(text.slice(last, m.index), marks, `${k}t`));
    if (m[1])
      out.push(
        <code key={k} className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
          {m[1].slice(1, -1)}
        </code>,
      );
    else if (m[2])
      out.push(
        <strong key={k} className="font-semibold">
          {inline(m[2].slice(2, -2), k, marks)}
        </strong>,
      );
    else if (m[3]) out.push(<em key={k}>{marked(m[3].slice(1, -1), marks, k)}</em>);
    else if (m[4]) {
      const href = safeHref(m[6]!);
      const label = inline(m[5]!, k, marks);
      if (!href) out.push(<Fragment key={k}>{label}</Fragment>);
      else if (href.internal)
        out.push(
          <InternalLink key={k} href={href.url}>
            {label}
          </InternalLink>,
        );
      else
        out.push(
          <a
            key={k}
            href={href.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {label}
          </a>,
        );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(...marked(text.slice(last), marks, `${key}-end`));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/**
 * Block markdown: headings, lists, tables, code fences, quotes and paragraphs. `marks` are citations the check could not
 * resolve; they stay in the text and are marked where they appear.
 */
export function AssistantMarkdown({ text, marks = [] }: { text: string; marks?: CitationMark[] }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${n++}`;
    if (/^```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) body.push(lines[i++]!);
      i += 1;
      blocks.push(
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-[11.5px] leading-snug"
        >
          {body.join("\n")}
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key} className="mt-1 font-semibold">
          {inline(heading[2]!, key, marks)}
        </p>,
      );
      i += 1;
      continue;
    }
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)
    ) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-border">
                {head.map((h, k) => (
                  <th key={k} className="px-1.5 py-1 font-semibold">
                    {inline(h, `${key}h${k}`, marks)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {r.map((c, k) => (
                    <td key={k} className="px-1.5 py-1 align-top">
                      {inline(c, `${key}r${ri}c${k}`, marks)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={key}
          className={`m-0 space-y-0.5 pl-4 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((it, k) => (
            <li key={k}>{inline(it, `${key}-${k}`, marks)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!))
        quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={key} className="border-l-2 border-border pl-2 text-muted-foreground">
          {inline(quote.join(" "), key, marks)}
        </blockquote>,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s|>|\s*\|)/.test(lines[i]!)
    )
      para.push(lines[i++]!);
    if (!para.length) {
      para.push(line);
      i += 1;
    }
    blocks.push(
      <p key={key} className="m-0">
        {inline(para.join(" "), key, marks)}
      </p>,
    );
  }
  return <div className="space-y-2 break-words text-[13px] leading-relaxed">{blocks}</div>;
}
