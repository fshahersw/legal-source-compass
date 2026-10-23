import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type BodyLine } from "@/lib/external/usCode.functions";

/** Indentation steps as OLRC sets them (indent0 … indentN), capped so deep tables stay readable. */
const pad = (indent: number) => ({ paddingLeft: `${Math.min(indent, 8) * 1.5}rem` });

type Group =
  | { kind: "line"; line: BodyLine }
  | { kind: "table"; rows: Extract<BodyLine, { cells: string[] }>[] };

function groupLines(lines: BodyLine[]): Group[] {
  const out: Group[] = [];
  for (const line of lines) {
    if (line.kind === "tr" || line.kind === "th") {
      const last = out[out.length - 1];
      if (last && last.kind === "table") last.rows.push(line);
      else out.push({ kind: "table", rows: [line] });
    } else out.push({ kind: "line", line });
  }
  return out;
}

/**
 * A unit's printed lines: subdivisions indented as printed, number-and-heading lines set apart, tables as tables.
 * Very long units (a few run to thousands of lines) show the first `limit` lines until the reader asks for the rest.
 */
export function BodyLines({
  lines,
  className,
  limit,
}: {
  lines: BodyLine[];
  className?: string;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const cut = !all && limit !== undefined && lines.length > limit;
  const shown = cut ? lines.slice(0, limit) : lines;
  return (
    <div className={cn("space-y-1.5 text-[13px] leading-relaxed", className)}>
      {groupLines(shown).map((g, n) =>
        g.kind === "table" ? (
          <div key={n} className="overflow-x-auto" style={pad(g.rows[0]!.indent)}>
            <table className="my-1 min-w-[16rem] border-collapse text-[12px]">
              <tbody>
                {g.rows.map((row, r) => (
                  <tr key={r} className="border-b border-border/70 align-top">
                    {row.cells.map((cell, c) =>
                      row.kind === "th" ? (
                        <th
                          key={c}
                          scope="col"
                          className="px-2 py-1 text-left font-medium text-muted-foreground"
                        >
                          {cell}
                        </th>
                      ) : (
                        <td key={c} className="px-2 py-1">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p
            key={n}
            className={cn("m-0 max-w-[80ch]", g.line.kind === "h" && "font-medium")}
            style={pad(g.line.indent)}
          >
            {"text" in g.line ? g.line.text : null}
          </p>
        ),
      )}
      {cut ? (
        <p className="m-0 border-t border-border/70 pt-2 text-[12px] text-muted-foreground">
          Showing the first {limit.toLocaleString()} of {lines.length.toLocaleString()} lines.{" "}
          <button
            type="button"
            onClick={() => setAll(true)}
            className="text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            Show the full text
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function Footnotes({ items }: { items: [string, string][] }) {
  if (!items.length) return null;
  return (
    <ol className="m-0 mt-3 list-none space-y-1 border-t border-border/70 p-0 pt-2 text-[12px] text-muted-foreground">
      {items.map(([n, text], i) => (
        <li key={i}>
          <span className="mr-1 font-mono">[{n}]</span>
          {text}
        </li>
      ))}
    </ol>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Fact({
  label,
  children,
  wrap,
}: {
  label: string;
  children: ReactNode;
  wrap?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("m-0", wrap ? "break-words" : "truncate")}>{children}</dd>
    </div>
  );
}
