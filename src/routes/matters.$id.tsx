import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AppShell } from "@/components/atlas/AppShell";
import { EntityError } from "@/components/corpus/EntityPage";
import { MatterPage } from "@/components/matters/MatterPage";
import { pageHead } from "@/lib/corpus/head";
import { getMatterOverview } from "@/lib/matters/matters.functions";
import { normalizeMdlNumber } from "@/lib/matters/overview";
import { validateMatterSearch } from "@/lib/matters/search";

const matterOverviewQuery = (id: string) =>
  queryOptions({
    queryKey: ["matter-overview", normalizeMdlNumber(id) ?? id],
    queryFn: () => getMatterOverview({ data: { id } }),
    staleTime: 5 * 60_000,
  });

export const Route = createFileRoute("/matters/$id")({
  validateSearch: validateMatterSearch,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(matterOverviewQuery(params.id)),
  head: ({ loaderData, params }) => {
    const title = loaderData?.overview.title ?? `MDL ${params.id}`;
    return pageHead(
      title,
      `MDL ${params.id} profile: master docket, member cases, docket entries, documents and counsel from the connected corpus.`,
    );
  },
  component: Page,
  errorComponent: ({ error }) => (
    <EntityError error={error instanceof Error ? error : new Error(String(error))} />
  ),
  notFoundComponent: () => <p className="p-6 text-[13px]">MDL not found.</p>,
});

function Page() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(matterOverviewQuery(id));
  if (!data)
    return (
      <AppShell
        breadcrumbs={[
          { label: "Atlas", to: "/" },
          { label: "Matters", to: "/matters" },
          { label: `MDL ${id}` },
        ]}
        title="MDL not found"
      >
        <p className="text-[13px] text-muted-foreground">
          The connected corpus has no MDL record numbered “{id}”. MDLs outside the JPML pending list
          (for example closed matters) may not have a record yet.
        </p>
      </AppShell>
    );
  return (
    <MatterPage
      payload={data}
      search={search}
      onSearch={(next) => void navigate({ search: (prev) => next(prev), replace: true })}
    />
  );
}
