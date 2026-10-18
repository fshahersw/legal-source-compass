import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { LeadershipSection } from "@/lib/external/mdlIntel.functions";
import { leadershipRuns } from "@/lib/external/mdlIntelView";
import { cn } from "@/lib/utils";

const plural = (count: number, word: string) =>
  `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

/**
 * Court-page leadership as listed: one section per role, each line verbatim. Consecutive roles printed under the same
 * heading ("PLAINTIFFS' COUNSEL") sit inside that heading's bordered group; a role without a group stands on its own,
 * so it never reads as part of the group above it. Collapsed, it shows the first `initialSections` roles with up to
 * `initialLines` lines each; one control expands all. `moreRoles` counts roles in the record that are not included,
 * linked to `moreUrl` (the court page that lists them).
 */
export function LeadershipList({
  sections: all,
  initialSections = 4,
  initialLines = 6,
  moreRoles = 0,
  moreUrl = null,
  className,
}: {
  sections: LeadershipSection[];
  initialSections?: number;
  initialLines?: number;
  moreRoles?: number;
  moreUrl?: string | null;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? all : all.slice(0, initialSections);
  const hiddenLines = all.reduce(
    (sum, s, i) =>
      sum +
      (open
        ? 0
        : i < initialSections
          ? Math.max(0, s.lines.length - initialLines)
          : s.lines.length),
    0,
  );
  const hiddenRoles = all.length - shown.length;
  const section = (s: LeadershipSection, i: number) => {
    const lines = open ? s.lines : s.lines.slice(0, initialLines);
    return (
      <div key={`${s.url}-${s.heading}-${i}`}>
        <p className="font-medium">
          {s.heading}
          {s.updated ? (
            <span className="ml-1.5 font-normal text-muted-foreground">· {s.updated}</span>
          ) : null}
          {s.contactLinesRemoved ? (
            <span className="ml-1.5 rounded border border-border px-1 py-px text-[10px] font-normal text-muted-foreground">
              contact lines removed
            </span>
          ) : null}
        </p>
        {lines.length ? (
          <ul className="mt-0.5 space-y-px text-muted-foreground">
            {lines.map((line, j) => (
              <li key={j} className="break-words leading-snug">
                {line}
              </li>
            ))}
          </ul>
        ) : !s.moreLines ? (
          <p className="mt-0.5 text-muted-foreground">Names not recorded</p>
        ) : null}
        {s.moreLines ? (
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline"
          >
            {plural(s.moreLines, "further line")} on the court page
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    );
  };
  let index = 0;
  return (
    <div className={cn("space-y-1.5 text-[11px]", className)}>
      {leadershipRuns(shown).map((run, r) => {
        const start = index;
        index += run.sections.length;
        if (run.group === null) return run.sections.map((s, k) => section(s, start + k));
        return (
          <div key={`group-${r}-${run.group}`} className={cn(r > 0 && "pt-1")}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {run.group}
            </p>
            <div className="mt-1 space-y-1.5 border-l border-border pl-2">
              {run.sections.map((s, k) => section(s, start + k))}
            </div>
          </div>
        );
      })}
      {moreRoles && (open || !hiddenRoles) ? (
        moreUrl ? (
          <a
            href={moreUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline"
          >
            {plural(moreRoles, "further role")} listed on the court page
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <p className="text-[10.5px] text-muted-foreground">
            {plural(moreRoles, "further role")} listed on the court page
          </p>
        )
      ) : null}
      {hiddenRoles || hiddenLines || open ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="block rounded text-[10.5px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {open
            ? "Show fewer"
            : `Show all${hiddenRoles ? ` · ${plural(hiddenRoles, "more role")}` : ""}${hiddenLines ? ` · ${plural(hiddenLines, "more line")}` : ""}`}
        </button>
      ) : null}
    </div>
  );
}
