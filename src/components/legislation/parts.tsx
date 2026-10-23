import { useId, useState } from "react";
import { Check, Circle, CircleSlash } from "lucide-react";
import { MoreToggle } from "@/components/enforcement/parts";
import type { Milestone } from "@/lib/external/legislation";
import { cn } from "@/lib/utils";

import { fmtDay, NR } from "./format";

/** Status label in a quiet chip; enacted outcomes get the primary tone, vetoes the destructive tone. */
export function StatusChip({ status, label }: { status: string; label: string }) {
  const tone =
    status === "became_law" || status === "signed"
      ? "border-primary/40 bg-primary/10 text-primary"
      : status === "vetoed"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-muted/60 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[10.5px] font-medium",
        tone,
      )}
    >
      {label}
    </span>
  );
}

/**
 * The published milestones as a compact track: reached milestones show their date; a vitiated passage is marked; a
 * milestone with no qualifying action is "Not recorded" (never assumed).
 */
export function MilestoneTrack({ milestones, rule }: { milestones: Milestone[]; rule: string }) {
  const shown = milestones.filter((m) => m.date || m.key !== "vetoed");
  return (
    <section aria-label="Milestones" className="rounded-md border border-border bg-surface p-3">
      <h2 className="eyebrow mb-2">Milestones</h2>
      <ol className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
        {shown.map((m) => (
          <li key={m.key} className="flex items-start gap-2 text-[12.5px]">
            {m.date && !m.vitiated ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            ) : m.vitiated ? (
              <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
            )}
            <span className="min-w-0">
              <span className={cn("font-medium", !m.date && "text-muted-foreground")}>
                {m.label}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {m.date ? fmtDay(m.date) : NR}
                {m.vitiated ? ` · passage vitiated ${fmtDay(m.vitiated)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">{rule}</p>
    </section>
  );
}

/** A capped list with a keyboard-operable "+N more" toggle. */
export function Capped<T>({
  items,
  limit,
  noun,
  render,
  className,
}: {
  items: T[];
  limit: number;
  noun: string;
  render: (item: T, index: number) => React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const shown = open ? items : items.slice(0, limit);
  return (
    <>
      <ul id={id} className={cn("m-0 list-none p-0", className)}>
        {shown.map((x, i) => render(x, i))}
      </ul>
      <MoreToggle
        total={items.length}
        limit={limit}
        expanded={open}
        onToggle={() => setOpen((v) => !v)}
        controls={id}
        noun={noun}
      />
    </>
  );
}

export function Section({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="min-w-0 rounded-md border border-border bg-surface"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-3 py-2">
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        {aside ? <span className="text-[11px] text-muted-foreground">{aside}</span> : null}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}
