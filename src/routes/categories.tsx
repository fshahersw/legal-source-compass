import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { useAtlas } from "@/lib/atlas/store";
import { defaultFilters } from "@/lib/atlas/filters";
import { valuesOf } from "@/lib/atlas/bundle";
import { CATEGORY_LABELS, classify, type CategoryId } from "@/lib/corpus/taxonomy";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/categories")({
  head: () => pageHead("Categories", "The corpussite category taxonomy applied to the heading categories, with unmatched headings shown separately."),
  component: Categories,
});

function Categories() {
  const { bundle, setFilters } = useAtlas();
  const navigate = useNavigate();
  const groups = useMemo(() => {
    const byCat = new Map<CategoryId, Map<string, number>>();
    for (const s of bundle?.sources ?? []) {
      for (const h of valuesOf(s, "heading_category")) {
        const c = classify(h);
        const m = byCat.get(c) ?? new Map<string, number>();
        m.set(h, (m.get(h) ?? 0) + 1);
        byCat.set(c, m);
      }
    }
    return (Object.keys(CATEGORY_LABELS) as CategoryId[]).map((id) => ({
      id,
      headings: [...(byCat.get(id) ?? new Map())].sort((a, b) => b[1] - a[1]),
    }));
  }, [bundle]);

  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Categories" }]} title="Categories" description="corpussite's eight categories (rule ported exactly from categories.py) applied to each imported heading. Headings the rule does not recognise are listed under “not matched”, not reassigned by guesswork.">
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => {
          const total = g.headings.reduce((a, [, n]) => a + n, 0);
          return (
            <section key={g.id} className="rounded-lg border border-border bg-surface p-4 shadow-card" data-testid={`category-${g.id}`}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-lg">{CATEGORY_LABELS[g.id]}</h2>
                <span className="font-mono text-[12px] text-muted-foreground">{total.toLocaleString()} source–heading links</span>
              </div>
              {g.headings.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted-foreground">No heading falls in this category.</p>
              ) : (
                <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-[12px]">
                  {g.headings.map(([h, n]) => (
                    <li key={h} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 break-words">{h}</span>
                      <span className="font-mono">{n.toLocaleString()}</span>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => { setFilters({ ...defaultFilters, headingCategories: [h] }); navigate({ to: "/" }); }}>
                        View
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
