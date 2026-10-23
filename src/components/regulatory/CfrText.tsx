import { ExternalLink, ImageIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { scriptRuns, type CfrBlock, type CfrNote } from "@/lib/external/ecfrFull";

const CHUNK = 400;

/** Text with the builder's ^(..)/_(..) fallbacks shown as real super/subscripts. */
export function ScriptText({ text }: { text: string }) {
  const runs = scriptRuns(text);
  if (runs.length === 1 && runs[0]!.t === "text") return <>{text}</>;
  return (
    <>
      {runs.map((r, k) =>
        r.t === "sup" ? (
          <sup key={k}>{r.s}</sup>
        ) : r.t === "sub" ? (
          <sub key={k}>{r.s}</sub>
        ) : (
          <span key={k}>{r.s}</span>
        ),
      )}
    </>
  );
}

function Table({ rows }: { rows: Extract<CfrBlock, { kind: "table" }>["rows"] }) {
  const headRows: typeof rows = [];
  let k = 0;
  while (k < rows.length && rows[k]!.every((c) => c.header)) headRows.push(rows[k++]!);
  const bodyRows = rows.slice(k);
  const cell = (c: (typeof rows)[number][number], i: number, head: boolean) => {
    const props = {
      ...(c.colspan > 1 ? { colSpan: c.colspan } : {}),
      ...(c.rowspan > 1 ? { rowSpan: c.rowspan } : {}),
      className: cn(
        "border border-border/70 px-2 py-1 align-top",
        head || c.header ? "bg-muted/50 font-medium" : "",
      ),
    };
    return head || c.header ? (
      <th key={i} scope={head ? "col" : "row"} {...props}>
        <ScriptText text={c.text} />
      </th>
    ) : (
      <td key={i} {...props}>
        <ScriptText text={c.text} />
      </td>
    );
  };
  return (
    <div className="my-2 max-w-full overflow-x-auto">
      <table className="min-w-[20rem] border-collapse text-left text-[12px] leading-snug">
        {headRows.length ? (
          <thead>
            {headRows.map((r, n) => (
              <tr key={n}>{r.map((c, i) => cell(c, i, true))}</tr>
            ))}
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((r, n) => (
            <tr key={n}>{r.map((c, i) => cell(c, i, false))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ b }: { b: CfrBlock }) {
  if (b.kind === "table") return <Table rows={b.rows} />;
  if (b.kind === "graphic") {
    const name = b.src.split("/").pop() ?? b.src;
    return b.url ? (
      <p className="m-0 my-1">
        <a
          href={b.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] text-primary hover:bg-muted"
        >
          <ImageIcon className="size-3.5" aria-hidden />
          Graphic {name} (opens on ecfr.gov)
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
    ) : (
      <p className="m-0 my-1 text-[12px] text-muted-foreground">Graphic {name} (not reproduced)</p>
    );
  }
  const boxed = b.flag === "x";
  const foot = b.flag === "f";
  if (b.kind === "h") {
    return (
      <p
        className={cn(
          "m-0 mt-3 font-semibold",
          b.level <= 1 ? "text-[14px]" : "text-[13px]",
          boxed && "border-l-2 border-border pl-3",
        )}
      >
        <ScriptText text={b.text} />
      </p>
    );
  }
  return (
    <p
      className={cn(
        "m-0",
        boxed && "border-l-2 border-border bg-muted/30 py-0.5 pl-3",
        foot && "text-[12px] text-muted-foreground",
      )}
      style={b.depth ? { marginLeft: `${Math.min(b.depth, 8) * 1.25}rem` } : undefined}
    >
      <ScriptText text={b.text} />
    </p>
  );
}

/** Section body: paragraphs indented by their (a)/(1)/(i)/(A) depth, tables, graphics; long texts shown in parts. */
export function CfrBlocks({ blocks, label }: { blocks: CfrBlock[]; label: string }) {
  const [shown, setShown] = useState(CHUNK);
  if (!blocks.length) return null;
  return (
    <div aria-label={label} className="max-w-[78ch] space-y-1.5 text-[14px] leading-relaxed">
      {blocks.slice(0, shown).map((b, n) => (
        <Block key={n} b={b} />
      ))}
      {blocks.length > shown ? (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShown((s) => s + CHUNK * 2)}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
          >
            Show more ({(blocks.length - shown).toLocaleString("en-US")} blocks remaining)
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CfrNotes({ notes, title }: { notes: CfrNote[]; title: string }) {
  if (!notes.length) return null;
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="eyebrow mb-2">{title}</h2>
      <dl className="m-0 grid grid-cols-1 gap-y-2 text-[12px] sm:grid-cols-[9rem_1fr] sm:gap-x-3">
        {notes.map((n, k) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">
              {n.label}
              {/* A note printed for the whole part needs no scope here; subpart notes name their subpart. */}
              {n.scope && !/^parts?\s/i.test(n.scope) ? (
                <span className="block text-[11px]">{n.scope}</span>
              ) : null}
            </dt>
            <dd className="m-0 whitespace-pre-line break-words">
              <ScriptText text={n.text} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
