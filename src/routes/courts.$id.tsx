import { createFileRoute } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { CourtContext, RelatedDockets } from "@/components/corpus/LinkedPanels";
import { RegistryMatters } from "@/components/corpus/RegistryMatters";
import { buildEntityView } from "@/lib/external/entityView";
import { useCourtDirectory } from "@/lib/external/useDirectory";

export const Route = createFileRoute("/courts/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(entityQuery("court_spine", params.id)),
  head: ({ loaderData }) => {
    const raw = (loaderData as { raw?: unknown } | undefined)?.raw as Record<string, unknown> | null | undefined;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Court profile");
    return pageHead(name, `Court profile for ${name}: linked records from the connected corpus on one page.`);
  },
  component: Page,
  errorComponent: ({ error }) => <EntityError error={error instanceof Error ? error : new Error(String(error))} /> ,
  notFoundComponent: () => <p className="p-6 text-[13px]">Court not found.</p>,
});

function Page() {
  const { id } = Route.useParams();
  const dir = useCourtDirectory();
  const c = dir.data?.find((r) => r.id === id);
  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [{ label: "Atlas", to: "/" }, { label: "Courts", to: "/courts" }];
  if (c) {
    crumbs.push({ label: c.system, to: "/courts", search: { system: c.system } });
    if (c.system !== "Federal") crumbs.push({ label: `${stateByUsps.get(c.state)?.name ?? c.state} courts`, to: "/courts", search: { system: c.system, state: c.state } });
    crumbs.push({ label: c.type, to: "/courts", search: c.system === "Federal" ? { system: c.system, type: c.type } : { system: c.system, state: c.state, type: c.type } });
  }
  return <EntityPage dataset="court_spine" id={id} docket={{ kind: "court", id }} crumbs={crumbs} extra={(raw) => <><CourtContext courtId={id} fallbackState={c?.state} known={new Set(buildEntityView(raw).facts.slice(0, 8).map(([k]) => k))} /><RegistryMatters courtId={id} /><RelatedDockets by="court" id={id} /></>} />;
}
