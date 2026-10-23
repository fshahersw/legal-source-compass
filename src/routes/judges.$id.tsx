import { createFileRoute, Link } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { JudgeFjcPanel } from "@/components/corpus/JudgeFjcPanel";
import { JudgePracticesPanel } from "@/components/judges/practices/JudgePracticesPanel";
import { JudgeCourtListenerPanel } from "@/components/judges/JudgeCourtListenerPanel";
import { JudgeDisclosuresPanel } from "@/components/judges/clb/JudgeDisclosuresPanel";
import { JudgePanelServicePanel } from "@/components/judges/clb/JudgePanelServicePanel";
import { JudgeHeadshot } from "@/components/judges/JudgeHeadshot";
import { JudgeMdlPanel } from "@/components/judges/JudgeMdlPanel";
import { JudgeMdlFlowsPanel } from "@/components/judges/JudgeMdlFlowsPanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { NominationPanel } from "@/components/judiciary/NominationPanel";
import { pageHead } from "@/lib/corpus/head";
import { canonicalState } from "@/lib/corpus/stateHub";
import { buildEntityView } from "@/lib/external/entityView";

export const Route = createFileRoute("/judges/$id")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQuery("judges", params.id)),
  head: ({ loaderData }) => {
    const raw = (loaderData as { raw?: Record<string, unknown> | null } | undefined)?.raw;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Judge profile");
    return pageHead(
      name,
      `Recorded judicial profile for ${name}: service, sources and state associations.`,
    );
  },
  component: Page,
  errorComponent: ({ error }) => (
    <EntityError error={error instanceof Error ? error : new Error(String(error))} />
  ),
  notFoundComponent: () => <p className="p-6 text-sm">Judge not found.</p>,
});
function Page() {
  const { id } = Route.useParams();
  const { raw } = Route.useLoaderData();
  const view = buildEntityView(raw ?? {});
  const rawStates = Array.isArray(raw?.["states"])
    ? (raw["states"] as unknown[])
    : [
        raw?.["state"],
        ...view.facts.filter(([key]) => key.toLowerCase() === "state").map(([, value]) => value),
      ];
  const states = [
    ...new Map(
      rawStates
        .map(canonicalState)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => [s.usps, s]),
    ).values(),
  ];
  // Courts & judges › Judges › <state> (the judge directory filtered to the state exactly as recorded) › <judge>.
  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [
    { label: "Judges", to: "/judges" },
  ];
  const recorded = rawStates.filter((s): s is string => typeof s === "string");
  if (states.length === 1 && recorded.includes(states[0]!.name))
    crumbs.push({ label: states[0]!.name, to: "/judges", search: { state: states[0]!.name } });
  return (
    <EntityPage
      dataset="judges"
      id={id}
      crumbs={crumbs}
      lead={(_, v) => <JudgeHeadshot judgeId={id} name={v.title} recorded={v.photo} />}
      extra={() => (
        <>
          <JudgeFjcPanel judgeId={id} />
          <JudgePracticesPanel judgeId={id} />
          <NominationPanel judgeId={id} />
          <JudgeCourtListenerPanel judgeId={id} />
          <JudgePanelServicePanel judgeId={id} />
          <JudgeDisclosuresPanel judgeId={id} />
          <JudgeMdlPanel judgeId={id} />
          <JudgeMdlFlowsPanel judgeId={id} />
          {/^[0-9a-f]{32}$/.test(id) ? (
            <DocumentsPanel type="judge" id={id} quiet className="mb-6" />
          ) : null}
          {states.length ? (
            <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Recorded state associations:</span>
              {states.map((state) => (
                <Link
                  key={state.usps}
                  to="/places/$state"
                  params={{ state: state.usps }}
                  search={{ tab: "judges" }}
                  className="rounded-lg border border-border bg-surface px-3 py-2 font-medium hover:bg-muted"
                >
                  {state.name} →
                </Link>
              ))}
            </div>
          ) : null}
        </>
      )}
    />
  );
}
