import { createFileRoute } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/judges/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(entityQuery("judges", params.id)),
  head: ({ loaderData }) => {
    const raw = loaderData?.raw as Record<string, unknown> | null | undefined;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Judge profile");
    return pageHead(name, `Judge profile for ${name}: every linked record in the connected corpus on one page.`);
  },
  component: Page,
  errorComponent: EntityError,
  notFoundComponent: () => <p className="p-6 text-[13px]">Judge not found.</p>,
});

function Page() {
  const { id } = Route.useParams();
  return <EntityPage dataset="judges" id={id} crumbs={[{ label: "Atlas", to: "/" }, { label: "Judges", to: "/judges" }]} />;
}
