import { createFileRoute, Link } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { canonicalState } from "@/lib/corpus/stateHub";
import { courtLinkCompatible } from "@/lib/corpus/courtLinks";
import { buildEntityView } from "@/lib/external/entityView";
import { CourtArtwork } from "@/components/corpus/CourtArtwork";

export const Route = createFileRoute("/courts/$id")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQuery("court_spine", params.id)),
  head: ({ loaderData }) => {
    const raw = (loaderData as { raw?: Record<string, unknown> | null } | undefined)?.raw;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Court profile");
    return pageHead(name, `Court profile for ${name}: court information and recorded sources.`);
  },
  component: Page,
  errorComponent: ({ error }) => (
    <EntityError error={error instanceof Error ? error : new Error(String(error))} />
  ),
  notFoundComponent: () => <p className="p-6 text-sm">Court not found.</p>,
});
function Page() {
  const { id } = Route.useParams();
  const { raw } = Route.useLoaderData();
  const view = buildEntityView(raw ?? {});
  const facts = new Map(view.facts.map(([key, value]) => [key.toLowerCase(), value]));
  const fact = (key: string) =>
    typeof facts.get(key) === "string" ? String(facts.get(key)) : null;
  const cells = (raw?.["cells"] && typeof raw["cells"] === "object" ? raw["cells"] : {}) as Record<
    string,
    unknown
  >;
  const state = canonicalState(raw?.["state"] ?? cells["state"] ?? fact("state"));
  const system = String(raw?.["system"] ?? cells["system"] ?? fact("system") ?? "Unknown system");
  const type = String(
    raw?.["type"] ?? cells["type"] ?? fact("type") ?? view.subtitle?.split(" · ")[0] ?? "Court",
  );
  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [
    { label: "State atlas", to: "/" },
  ];
  if (state)
    crumbs.push({ label: state.name, to: "/places/" + state.usps, search: { tab: "courts" } });
  else crumbs.push({ label: "Courts", to: "/courts" });
  const withheld = view.links.filter((link) => !courtLinkCompatible(link, system)).length;
  return (
    <EntityPage
      dataset="court_spine"
      id={id}
      crumbs={crumbs}
      linkFilter={(links) => links.filter((link) => courtLinkCompatible(link, system))}
      lead={(_raw, v) => <CourtArtwork courtId={id} title={v.title} system={system} type={type} />}
      extra={() => (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {state ? (
            <Link
              to="/places/$state"
              params={{ state: state.usps }}
              search={{ tab: "courts" }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              ← Courts in {state.name}
            </Link>
          ) : null}
          {withheld ? (
            <details className="max-w-2xl text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {withheld} conflicting court homepage link withheld
              </summary>
              <p className="mt-2 leading-relaxed">
                The source combines a state-court identity with a federal-court homepage. That link
                is not presented as this court’s website. The original source record remains
                unchanged for review.
              </p>
            </details>
          ) : null}
        </div>
      )}
    />
  );
}
