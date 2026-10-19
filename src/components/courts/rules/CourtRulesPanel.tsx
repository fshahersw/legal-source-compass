import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCourtRules, type RuleDocument } from "@/lib/external/courtRules.functions";
import { RuleDocuments } from "./RuleDocuments";
import { RuleInsights } from "./RuleInsights";
import { RuleTextSearch } from "./RuleTextSearch";
import { plural } from "./ruleFormat";

const tabClass = "h-7 px-2.5 text-xs";

/**
 * Rules of court for one court (federal rules and the court's local rules, or the state's rules of court), with
 * practice points quoted from the rules and a search of the rule text. Documents open in the source panel.
 */
export function CourtRulesPanel({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["court-rules", courtId],
    queryFn: () => getCourtRules({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  const [tab, setTab] = useState<string | null>(null);
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-28 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading court rules"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        Court rules could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  const data = q.data;
  if (!data) return null;
  const docs = data.documents;
  if (!docs.length) return <EmptyRules />;
  const readable = docs.filter((d) => d.status === "text");
  const missing = docs.length - readable.length;
  const points = docs.reduce((n, d) => n + d.insights, 0);
  const active = tab ?? (points ? "points" : "documents");
  return (
    <section aria-label="Court rules" className="mb-5 rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
        <h2 className="m-0 text-sm font-semibold">Court rules</h2>
        <p className="m-0 text-xs text-muted-foreground">
          {plural(docs.length, "rule document")} from official publishers
          {points ? ` · ${plural(points, "practice point")} with quotes` : ""}
          {missing ? ` · ${missing} not retrieved` : ""}
        </p>
      </header>
      <Tabs value={active} onValueChange={setTab} className="px-4 pb-3 pt-2">
        <TabsList className="h-8">
          <TabsTrigger value="points" className={tabClass} disabled={!points}>
            Practice points
          </TabsTrigger>
          <TabsTrigger value="documents" className={tabClass}>
            Rule documents
          </TabsTrigger>
          <TabsTrigger value="search" className={tabClass} disabled={!readable.length}>
            Search rule text
          </TabsTrigger>
        </TabsList>
        <TabsContent value="points">
          <RuleInsights courtId={courtId} documents={readable} />
        </TabsContent>
        <TabsContent value="documents">
          <RuleDocuments documents={docs} />
        </TabsContent>
        <TabsContent value="search">
          <RuleTextSearch courtId={courtId} documents={readable} />
        </TabsContent>
      </Tabs>
      <Footer documents={docs} dropped={data.dropped} />
    </section>
  );
}

function Footer({ documents, dropped }: { documents: RuleDocument[]; dropped: number }) {
  const retrieved = documents
    .map((d) => d.retrievedAt?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort();
  return (
    <footer className="space-y-1 border-t border-border/70 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
      <p className="m-0">
        Rules as published by each court or rules publisher
        {retrieved.length ? `, retrieved ${retrieved[retrieved.length - 1]}` : ""}. Practice points
        were read from the rule text; each is shown with the words it rests on, found word for word
        in the retrieved rule. Rules change: confirm against the current official version before
        relying on them.
      </p>
      {dropped ? (
        <p className="m-0">
          {plural(dropped, "stored document")} could not be read and is not shown.
        </p>
      ) : null}
    </footer>
  );
}

function EmptyRules() {
  return (
    <section
      aria-label="Court rules"
      className="mb-5 flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <h2 className="m-0 text-sm font-semibold">Court rules</h2>
      <p className="m-0 text-xs text-muted-foreground">
        No rules of court are recorded for this court.{" "}
        <Link
          to="/data/$dataset"
          params={{ dataset: "court_rule_documents" }}
          search={{}}
          className="text-primary underline-offset-2 hover:underline"
        >
          Browse recorded rule documents
        </Link>
      </p>
    </section>
  );
}
