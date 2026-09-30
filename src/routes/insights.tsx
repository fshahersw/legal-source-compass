import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/atlas/AppShell";
import { BarList, CorpusStatus, Stat } from "@/components/corpus/BarList";
import { useCorpus } from "@/lib/corpus/store";
import { countBy, firmCounts, mattersByYear } from "@/lib/corpus/insights";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/insights")({
  head: () => pageHead("Litigation Insights", "Analysis of the corpussite saved case catalog: matters by year, state, court, MDL, firm and status."),
  component: InsightsPage,
});

function InsightsPage() {
  const corpus = useCorpus();
  const ins = corpus.insights;
  const data = useMemo(() => {
    if (!ins) return null;
    return {
      years: mattersByYear(ins),
      states: countBy(ins.matters, (m) => m.state),
      courts: countBy(ins.matters, (m) => m.court),
      status: countBy(ins.matters, (m) => m.status),
      mdl: countBy(ins.matters.filter((m) => m.mdl), (m) => (m.mdl_name ? `MDL ${m.mdl} · ${m.mdl_name}` : `MDL ${m.mdl}`)),
      firms: firmCounts(ins),
      roles: countBy(ins.parties, (p) => p.role),
      withMdl: ins.matters.filter((m) => m.mdl).length,
    };
  }, [ins]);

  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Litigation Insights" }]} title="Litigation Insights" description="Charts over the corpussite saved case catalog. This is the saved catalog, not a national census.">
      {!ins || !data ? (
        <CorpusStatus {...corpus} />
      ) : (
        <>
          <blockquote className="mb-4 rounded-lg border-l-4 border-primary bg-muted/50 p-3 text-[12px] leading-relaxed">
            <div className="eyebrow mb-1">Catalog qualification (verbatim)</div>
            {ins.qualification}
          </blockquote>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Saved case rows" value={ins.matters.length} />
            <Stat label="Rows with MDL number" value={data.withMdl} />
            <Stat label="Scoped master dockets" value={ins.masters.length} />
            <Stat label="Citation edges" value={ins.citation_edges} note="value as shipped" />
          </div>
          <section className="mt-5 rounded-lg border border-border bg-surface p-4 shadow-card">
            <h3 className="eyebrow mb-2">Case rows by filing year</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.years}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={36} />
                  <Tooltip />
                  <Bar dataKey="count" fill="var(--primary)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <BarList title="By state" rows={data.states} unit="saved case rows" />
            <BarList title="By court" rows={data.courts} unit="saved case rows" />
            <BarList title="By MDL" rows={data.mdl} unit="saved case rows with an MDL number" />
            <BarList title="By firm (catalog alias lists applied)" rows={data.firms} unit="case rows naming the firm" />
            <BarList title="By status" rows={data.status} unit="saved case rows" />
            <BarList title="Party roles" rows={data.roles} unit="party records" />
          </div>
        </>
      )}
    </AppShell>
  );
}
