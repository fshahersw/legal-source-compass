import { createFileRoute } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { datasetDisplayName } from "@/lib/external/domainRegistry";

export const Route = createFileRoute("/records/$dataset/$id")({
  loader: ({ context, params }) => {
    if (!/^[a-z0-9_]{1,80}$/.test(params.dataset)) throw new Error("Unknown dataset");
    return context.queryClient.ensureQueryData(entityQuery(params.dataset, params.id));
  },
  head: ({ loaderData, params }) => {
    const raw = (loaderData as { raw?: unknown } | undefined)?.raw as Record<string, unknown> | null | undefined;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? params.id);
    return pageHead(name, `${datasetDisplayName(params.dataset)} record: ${name}.`);
  },
  component: Page,
  errorComponent: ({ error }) => <EntityError error={error} /> ,
  notFoundComponent: () => <p className="p-6 text-[13px]">Record not found.</p>,
});

function Page() {
  const { dataset, id } = Route.useParams();
  return <EntityPage dataset={dataset} id={id} crumbs={[{ label: "Atlas", to: "/" }, { label: datasetDisplayName(dataset), to: `/data/${dataset}` }]} />;
}
