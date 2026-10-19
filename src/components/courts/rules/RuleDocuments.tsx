import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import type { RuleDocument } from "@/lib/external/courtRules.functions";
import { groupDocuments, hostLabel, plural } from "./ruleFormat";

const FIRST = 8;

/** The rule documents that apply, grouped federal / local / state; each opens at its official address. */
export function RuleDocuments({ documents }: { documents: RuleDocument[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return (
    <div className="space-y-3 pt-1">
      {groupDocuments(documents).map((g) => {
        // documents that could not be retrieved are listed first so the gap is visible
        const ordered = [
          ...g.docs.filter((d) => d.status !== "text"),
          ...g.docs.filter((d) => d.status === "text"),
        ];
        const all = open.has(g.scope) || ordered.length <= FIRST + 2;
        return (
          <section key={g.scope} aria-label={g.heading}>
            <h3 className="eyebrow m-0 mb-1.5">
              {g.heading}
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                {ordered.length}
              </span>
            </h3>
            <ul className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
              {(all ? ordered : ordered.slice(0, FIRST)).map((d) => (
                <DocumentRow key={d.id} d={d} />
              ))}
            </ul>
            {!all ? (
              <button
                type="button"
                onClick={() => setOpen((s) => new Set(s).add(g.scope))}
                className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                Show all {ordered.length}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function DocumentRow({ d }: { d: RuleDocument }) {
  const retrieved = d.status === "text";
  const href = d.url ?? d.foundOn;
  return (
    <li className="min-w-0 rounded-md border border-border/70 px-3 py-2.5">
      <p className="m-0 flex items-start gap-1.5 text-[13px] font-medium leading-snug">
        <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">{d.title}</span>
      </p>
      <p className="m-0 mt-1 text-[11px] text-muted-foreground">
        {d.publisher ?? "Publisher not recorded"}
        {retrieved
          ? ` · ${plural(d.sections, "section")}${d.pages ? ` · ${plural(d.pages, "page")}` : ""}${
              d.insights ? ` · ${plural(d.insights, "practice point")}` : ""
            }`
          : ""}
      </p>
      {!retrieved ? (
        <p className="m-0 mt-1 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
          {d.statusLabel}
          {d.note ? `. ${d.note}` : ""}
        </p>
      ) : null}
      {href ? (
        <p className="m-0 mt-1.5 text-[11px]">
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            <span className="truncate">{d.url ? hostLabel(d.url) : "Court's rules page"}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
        </p>
      ) : null}
    </li>
  );
}
