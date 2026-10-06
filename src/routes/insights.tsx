import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { StateResearch } from "@/components/research/StateResearch";
import { JudgeResearch } from "@/components/research/JudgeResearch";
import { CaseResearch } from "@/components/research/CaseResearch";
import { CitationResearch } from "@/components/research/CitationResearch";
import { SourceResearch } from "@/components/research/SourceResearch";
import {
  control,
  Field,
  type ResearchSearch,
  type ResearchView,
  type WorkbenchProps,
} from "@/components/research/shared";
import { loadResearch } from "@/lib/corpus/research";
import { loadCatalog } from "@/lib/atlas/catalogMatters";
import { STATES } from "@/lib/corpus/geo";
import { pageHead } from "@/lib/corpus/head";

const views: { id: ResearchView; label: string }[] = [
  { id: "states", label: "State comparisons" },
  { id: "judges", label: "Judge analysis" },
  { id: "cases", label: "Case analysis" },
  { id: "citations", label: "Citation paths" },
  { id: "sources", label: "Court & rules hierarchy" },
];
function retrievedLabel(sources: { fetchedAt: string }[]): string {
  const days = [...new Set(sources.map((x) => x.fetchedAt.slice(0, 10)).filter(Boolean))].sort();
  if (days.length === 0) return "retrieval date Not recorded";
  return days.length === 1
    ? `sources retrieved ${days[0]}`
    : `sources retrieved ${days[0]} to ${days[days.length - 1]}`;
}

export const Route = createFileRoute("/insights")({
  validateSearch: (input: Record<string, unknown>): ResearchSearch => ({
    view: views.some((v) => v.id === input["view"]) ? (input["view"] as ResearchView) : undefined,
    state:
      typeof input["state"] === "string" &&
      (input["state"] === "ALL" || STATES.some((s) => s.usps === input["state"]))
        ? input["state"]
        : undefined,
    judge: typeof input["judge"] === "string" ? input["judge"].slice(0, 200) : undefined,
    docket:
      ["string", "number"].includes(typeof input["docket"]) &&
      Number.isSafeInteger(Number(input["docket"])) &&
      Number(input["docket"]) > 0
        ? Number(input["docket"])
        : undefined,
    q: typeof input["q"] === "string" ? input["q"].slice(0, 200) : undefined,
    mdl:
      typeof input["mdl"] === "string" && /^\d{1,6}$/.test(input["mdl"]) ? input["mdl"] : undefined,
  }),
  head: () =>
    pageHead(
      "Research workbench",
      "State comparisons, judicial service histories, case cohorts, relationships, and citation evidence with inspectable sources.",
    ),
  component: Page,
});
function Page() {
  const search = Route.useSearch(),
    navigate = useNavigate({ from: "/insights" });
  const research = useQuery({
    queryKey: ["research-snapshot"],
    queryFn: loadResearch,
    staleTime: Infinity,
  });
  const catalog = useQuery({
    queryKey: ["catalog-matters"],
    queryFn: loadCatalog,
    staleTime: Infinity,
  });
  const view = search.view ?? "states",
    state = search.state ?? "ALL";
  const update = (value: Partial<ResearchSearch>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...value }),
      replace:
        Object.hasOwn(value, "q") &&
        !Object.hasOwn(value, "view") &&
        !Object.hasOwn(value, "docket"),
    });
  };
  const props: WorkbenchProps | undefined =
    research.data && catalog.data
      ? {
          data: research.data,
          cases: catalog.data.rows,
          masters: catalog.data.masterMap,
          state,
          search,
          update,
        }
      : undefined;
  const error = research.error ?? catalog.error;
  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Research workbench" }]}
      title="Research workbench"
      description="Compare jurisdictions, trace case relationships, inspect judge histories, and follow citations to source documents."
    >
      <div className="mb-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="eyebrow text-primary">Evidence you can inspect</div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {research.data
                ? `Population as of ${research.data.population.referenceDate} · judiciary data as of ${research.data.judiciary.asOf} · ${retrievedLabel(research.data.sources.sources)}`
                : "Loading source dates…"}
            </p>
          </div>
          <div className="w-full sm:w-64">
            <Field label="State selection">
              <select
                className={control}
                value={state}
                disabled={view === "citations"}
                onChange={(e) => update({ state: e.target.value, docket: undefined })}
              >
                <option value="ALL">All states + DC</option>
                {[...STATES]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <option key={s.usps} value={s.usps}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            {view === "citations" && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Citation paths search the published citation index.
              </p>
            )}
          </div>
        </div>
      </div>
      <nav aria-label="Research views" className="mb-4 flex flex-wrap gap-2">
        {views.map((v) => (
          <Button
            key={v.id}
            size="sm"
            variant={v.id === view ? "default" : "outline"}
            aria-pressed={v.id === view}
            onClick={() => update({ view: v.id, q: undefined, mdl: undefined })}
          >
            {v.label}
          </Button>
        ))}
      </nav>
      {!props && !error && (
        <p className="py-8 text-[13px] text-muted-foreground">
          Loading verified research snapshots…
        </p>
      )}
      {error && (
        <div className="rounded-lg border border-border p-4 text-[13px]">
          <p>
            Research data could not load. {error instanceof Error ? error.message : "Please retry."}
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            onClick={() => {
              research.refetch();
              catalog.refetch();
            }}
          >
            Retry research data
          </Button>
        </div>
      )}
      {props && (
        <div key={`${view}-${state}-${search.judge ?? ""}`}>
          {view === "states" ? (
            <StateResearch {...props} />
          ) : view === "judges" ? (
            <JudgeResearch {...props} />
          ) : view === "cases" ? (
            <CaseResearch {...props} />
          ) : view === "citations" ? (
            <CitationResearch {...props} />
          ) : (
            <SourceResearch {...props} />
          )}
        </div>
      )}
    </AppShell>
  );
}
