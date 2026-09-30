import { createFileRoute } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(entityQuery("court_spine", params.id)),
  head: ({ loaderData }) => {
    const raw = loaderData?.raw as Record<string, unknown> | null | undefined;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Court profile");
    return pageHead(name, `Court profile for ${name}: every linked record in the connected corpus on one page.`);
  },
  component: Page,
  errorComponent: EntityError,
  notFoundComponent: () => <p className="p-6 text-[13px]">Court not found.</p>,
});

function Page() {
  const { id } = Route.useParams();
  return <EntityPage dataset="court_spine" id={id} docket={{ kind: "court", id }} crumbs={[{ label: "Atlas", to: "/" }, { label: "Courts", to: "/courts" }]} />;
}
