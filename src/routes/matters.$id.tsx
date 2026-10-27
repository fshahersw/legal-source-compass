import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";

import { AppShell } from "@/components/atlas/AppShell";
import { EntityError } from "@/components/corpus/EntityPage";
import { MdlCommandPage, commandTitle } from "@/components/matters/command/MdlCommandPage";
import { mdlCommandQuery } from "@/components/matters/command/commandQueries";
import { pageHead } from "@/lib/corpus/head";
import { normalizeMdlNumber } from "@/lib/matters/overview";
import { validateMatterSearch } from "@/lib/matters/search";

/** The MDL number of the address ("3047", "mdl-3047", "03047"); null when it is not one the command page reads. */
const mdlOf = (raw: string) => {
  const n = normalizeMdlNumber(raw);
  return n && /^[1-9][0-9]{0,4}$/.test(n) ? n : null;
};

export const Route = createFileRoute("/matters/$id")({
  validateSearch: validateMatterSearch,
  loader: async ({ context, params }) => {
    const mdl = mdlOf(params.id);
    if (!mdl) throw notFound();
    return context.queryClient.ensureQueryData(mdlCommandQuery(mdl));
  },
  head: ({ loaderData, params }) =>
    pageHead(
      loaderData ? commandTitle(loaderData) : `MDL ${params.id}`,
      `MDL ${params.id}: JPML counts, key orders, docketed dates, counsel, documents and the regulatory record.`,
    ),
  component: Page,
  errorComponent: ({ error }) => (
    <EntityError error={error instanceof Error ? error : new Error(String(error))} />
  ),
  notFoundComponent: () => <NotFound id={null} />,
});

function NotFound({ id }: { id: string | null }) {
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Matters", to: "/matters" },
        { label: id ? `MDL ${id}` : "MDL" },
      ]}
      title="MDL not found"
    >
      <p className="text-[13px] text-muted-foreground">
        {id
          ? `No dataset in the connected corpus records MDL number “${id}”: it is not in the JPML reports, the MDL directory, the registry, hearing sessions, Panel orders, terminated-litigation statistics or court pages.`
          : "This address is not an MDL number."}
      </p>
    </AppShell>
  );
}

function Page() {
  const { id } = Route.useParams();
  const mdl = mdlOf(id)!;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(mdlCommandQuery(mdl));
  if (!data.found) return <NotFound id={mdl} />;
  return (
    <MdlCommandPage
      cmd={data}
      search={search}
      onSearch={(next) => void navigate({ search: (prev) => next(prev), replace: true })}
    />
  );
}
