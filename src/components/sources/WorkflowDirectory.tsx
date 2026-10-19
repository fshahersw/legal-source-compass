import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  categoryLabel,
  matchesQuery,
  WORKFLOWS,
  type CategoryId,
} from "@/lib/external/sourcesCatalog";

export function WorkflowDirectory({
  q,
  counts,
  onCategory,
}: {
  q: string;
  counts: ReadonlyMap<CategoryId, number>;
  onCategory: (cat: CategoryId) => void;
}) {
  const visible = q
    ? WORKFLOWS.filter((w) =>
        matchesQuery(
          [
            w.title,
            w.question,
            ...w.steps.map((s) => s.label),
            ...w.categories.map(categoryLabel),
          ].join(" "),
          q,
        ),
      )
    : WORKFLOWS;
  if (!visible.length)
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No workflow matches “{q}”.
      </p>
    );
  return (
    <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 2xl:grid-cols-3">
      {visible.map((w) => (
        <li key={w.id} className="flex min-w-0 flex-col rounded-md border border-border bg-surface">
          <div className="border-b border-border/70 px-3 py-2.5">
            <h2 className="m-0 text-[13px] font-semibold">{w.title}</h2>
            <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">{w.question}</p>
          </div>
          <ol className="m-0 list-none space-y-0.5 px-3 py-2">
            {w.steps.map((s, i) => (
              <li key={s.to + s.label}>
                <Link
                  to={s.to}
                  className="group flex items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="grid size-4 shrink-0 place-items-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{s.label}</span>
                  <ArrowRight
                    className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
            <span>Data:</span>
            {w.categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onCategory(c)}
                className="rounded border border-border/70 px-1.5 py-0.5 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                {categoryLabel(c)} · {counts.get(c) ?? 0}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
