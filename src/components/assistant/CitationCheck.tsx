import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { CheckedCitation, CitationCheck } from "@/lib/assistant/protocol";
import { cn } from "@/lib/utils";
import { CITATION_ORDER as ORDER, CITATION_STATUS } from "./citationStatus";
import { safeHref } from "./markdownLinks";

function ExternalLinks({ links }: { links: { label: string; url: string }[] }) {
  const safe = links
    .map((l) => ({ label: l.label, href: safeHref(l.url) }))
    .filter((l) => l.href && !l.href.internal);
  if (!safe.length) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2.5">
      {safe.map((l) => (
        <a
          key={`${l.label}-${l.href!.url}`}
          href={l.href!.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          title={l.href!.url}
        >
          {l.label}
        </a>
      ))}
    </span>
  );
}

function Item({ item }: { item: CheckedCitation }) {
  const s = CITATION_STATUS[item.status];
  const facts = [item.title, item.court, item.date].filter(Boolean).join(" · ");
  return (
    <li className="flex gap-2 py-1.5">
      <span
        className={cn(
          "mt-px h-fit shrink-0 whitespace-nowrap rounded border px-1 py-px text-[10px] font-medium leading-tight",
          s.badge,
        )}
      >
        {s.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 break-words font-medium text-foreground">{item.normalized}</p>
        {facts ? <p className="m-0 break-words text-foreground/80">{facts}</p> : null}
        {item.reason ? <p className="m-0 break-words">{item.reason}</p> : null}
        {item.status === "ambiguous" && item.matches.length ? (
          <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
            {item.matches.map((m, k) => {
              const href = m.url ? safeHref(m.url) : null;
              const label = [m.title ?? "Decision", m.court, m.date].filter(Boolean).join(" · ");
              return (
                <li key={`${m.clusterId ?? k}`} className="break-words">
                  {href && !href.internal ? (
                    <a
                      href={href.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <ExternalLinks links={item.links} />
        )}
      </div>
    </li>
  );
}

/** "4 citations checked · 1 not found" under an answer; expands to every citation with its status, reason and links. */
export function CitationCheckLine({
  check,
  defaultOpen = false,
}: {
  check: CitationCheck;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!check.total && !check.more) return null;
  const { total, counts, more } = check;
  const problems = (["not_found", "ambiguous", "unverified"] as const).filter((k) => counts[k]);
  const items = [...check.items].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const segment: Record<(typeof problems)[number], string> = {
    not_found: `${counts.not_found} not found`,
    ambiguous: `${counts.ambiguous} ambiguous`,
    unverified: `${counts.unverified} could not be checked`,
  };
  return (
    <div className="mt-2 text-[11.5px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 rounded px-0.5 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="min-w-0">
          {total} citation{total === 1 ? "" : "s"} checked
          {problems.length ? (
            problems.map((k) => (
              <span key={k} className={cn("font-medium", CITATION_STATUS[k].summary)}>
                {" · "}
                {segment[k]}
              </span>
            ))
          ) : total ? (
            <span>{total === 1 ? " · found" : " · all found"}</span>
          ) : null}
          {more ? <span>{` · ${more} more not checked`}</span> : null}
        </span>
      </button>
      {open ? (
        <div className="mt-1 border-l border-border pl-2.5">
          <ul className="m-0 list-none divide-y divide-border/60 p-0">
            {items.map((i) => (
              <Item key={`${i.kind}:${i.normalized}:${i.citation}`} item={i} />
            ))}
          </ul>
          {more ? (
            <p className="m-0 mt-1">
              {more} more citation{more === 1 ? " was" : "s were"} not checked; ask about them
              separately.
            </p>
          ) : null}
          <p className="m-0 mt-1">
            Found means the citation exists at the source checked. Read it to confirm it supports
            the statement.
          </p>
        </div>
      ) : null}
    </div>
  );
}
