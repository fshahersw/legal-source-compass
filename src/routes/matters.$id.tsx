import { createFileRoute } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { MdlJudges, RelatedDockets } from "@/components/corpus/LinkedPanels";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(entityQuery("mdls", params.id)),
  head: ({ loaderData }) => {
    const raw = (loaderData as { raw?: unknown } | undefined)?.raw as Record<string, unknown> | null | undefined;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "MDL profile");
    return pageHead(name, `MDL profile for ${name}: every linked record in the connected corpus on one page.`);
  },
  component: Page,
  errorComponent: ({ error }) => <EntityError error={error instanceof Error ? error : new Error(String(error))} /> ,
  notFoundComponent: () => <p className="p-6 text-[13px]">MDL not found.</p>,
});

function Page() {
  const { id } = Route.useParams();
  return <EntityPage dataset="mdls" id={id} docket={{ kind: "mdl", id }} crumbs={[{ label: "Atlas", to: "/" }, { label: "Matters", to: "/matters" }]} extra={(raw) => <><MdlJudges raw={raw} /><RelatedDockets by="mdl" id={id.replace(/^mdl:/i, "").replace(/^0+/, "")} /></>} />;
}
