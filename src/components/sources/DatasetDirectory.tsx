import { Link } from "@tanstack/react-router";
import { ArrowRight, Database, ExternalLink } from "lucide-react";
import {
  CATEGORIES,
  categoryLabel,
  categoryOf,
  datasetHaystack,
  groupByCategory,
  hostOf,
  matchesQuery,
  portalName,
  usedOn,
  type CategoryId,
  type SourceDataset,
} from "@/lib/external/sourcesCatalog";
import { cn } from "@/lib/utils";

const PREVIEW = 6;

export function DatasetCard({ d, showCategory }: { d: SourceDataset; showCategory: boolean }) {
  const pages = usedOn(d.id);
  const official = d.sourceUrls[0] ?? null;
  const host = official ? hostOf(official) : null;
  return (
    <li className="flex min-w-0 flex-col rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <Link
          to="/data/$dataset"
          params={{ dataset: d.id }}
          className="min-w-0 text-[13px] font-medium leading-snug text-foreground hover:underline"
        >
          {d.label}
        </Link>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {d.records === null ? "Not recorded" : d.records.toLocaleString("en-US")}
        </span>
      </div>
      <p className="m-0 mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={d.id}>
        {d.id}
        {showCategory ? ` · ${categoryLabel(categoryOf(d.id))}` : ""}
      </p>
      {d.sourceText ? (
        <p
          className="m-0 mt-1.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground"
          title={d.sourceText}
        >
          {d.sourceText}
        </p>
      ) : (
        <p className="m-0 mt-1.5 text-[12px] text-muted-foreground">
          Source statement not recorded
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[11px]">
        {pages.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
          >
            {p.label}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        ))}
        <Link
          to="/data/$dataset"
          params={{ dataset: d.id }}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          aria-label={`Browse records of ${d.label}`}
        >
          <Database className="size-3" aria-hidden /> Records
        </Link>
        {official && host ? (
          <a
            href={official}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
            title={official}
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{portalName(host)}</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}

export function DatasetDirectory({
  datasets,
  cat,
  q,
  onCategory,
}: {
  datasets: readonly SourceDataset[];
  cat: CategoryId | undefined;
  q: string;
  onCategory: (cat: CategoryId | undefined) => void;
}) {
  const visible = q ? datasets.filter((d) => matchesQuery(datasetHaystack(d), q)) : datasets;
  const all = groupByCategory(datasets);
  const grouped = groupByCategory(visible);
  const sections = CATEGORIES.filter((c) => (cat ? c.id === cat : true)).filter(
    (c) => (grouped.get(c.id) ?? []).length > 0,
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <nav aria-label="Dataset categories" className="lg:sticky lg:top-2 lg:self-start">
        <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          <CategoryButton
            label="All categories"
            count={visible.length}
            active={!cat}
            onClick={() => onCategory(undefined)}
          />
          {CATEGORIES.filter((c) => (all.get(c.id) ?? []).length > 0).map((c) => (
            <CategoryButton
              key={c.id}
              label={c.label}
              count={(grouped.get(c.id) ?? []).length}
              active={cat === c.id}
              onClick={() => onCategory(c.id)}
            />
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-5">
        {sections.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            No dataset matches “{q}”{cat ? ` in ${categoryLabel(cat)}` : ""}. Try fewer words or
            another category.
          </p>
        ) : null}
        {sections.map((c) => {
          const list = grouped.get(c.id) ?? [];
          const shown = cat || q ? list : list.slice(0, PREVIEW);
          return (
            <section key={c.id} aria-labelledby={`cat-${c.id}`}>
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h2 id={`cat-${c.id}`} className="m-0 text-sm font-semibold">
                  {c.label}{" "}
                  <span className="text-[12px] font-normal text-muted-foreground">
                    {list.length} dataset{list.length === 1 ? "" : "s"} ·{" "}
                    {list.reduce((n, d) => n + (d.records ?? 0), 0).toLocaleString("en-US")} records
                  </span>
                </h2>
                {!cat && !q && list.length > PREVIEW ? (
                  <button
                    type="button"
                    onClick={() => onCategory(c.id)}
                    className="rounded text-[12px] text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Show all {list.length}
                  </button>
                ) : null}
              </header>
              <p className="m-0 mb-2 text-[12px] text-muted-foreground">{c.blurb}</p>
              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 2xl:grid-cols-3">
                {shown.map((d) => (
                  <DatasetCard key={d.id} d={d} showCategory={false} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CategoryButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li className="shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-md lg:max-w-full px-2.5 py-1.5 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-ring",
          active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
        )}
      >
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            active ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      </button>
    </li>
  );
}
