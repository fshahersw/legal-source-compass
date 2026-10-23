import type { ReactNode } from "react";
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

/** A unit's printed lines: subdivisions indented as printed, number-and-heading lines set apart, tables as tables. */
export function BodyLines({ lines, className }: { lines: BodyLine[]; className?: string }) {
  if (!lines.length) return null;
  return (
    <div className={cn("space-y-1.5 text-[13px] leading-relaxed", className)}>
      {groupLines(lines).map((g, n) =>
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

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate">{children}</dd>
    </div>
  );
}
