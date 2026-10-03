import { createFileRoute, Link } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { useJudgeDirectory } from "@/lib/external/useDirectory";
import { judgeStates, judgeSystems } from "@/lib/external/directoryTree";

export const Route = createFileRoute("/judges/$id")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQuery("judges", params.id)),
  head: ({ loaderData }) => {
    const raw = (loaderData as { raw?: unknown } | undefined)?.raw as
      Record<string, unknown> | null | undefined;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Judge profile");
    return pageHead(
      name,
      `Judge profile for ${name}: every linked record in the connected corpus on one page.`,
    );
  },
  component: Page,
  errorComponent: ({ error }) => (
    <EntityError error={error instanceof Error ? error : new Error(String(error))} />
  ),
  notFoundComponent: () => <p className="p-6 text-[13px]">Judge not found.</p>,
});

function Page() {
  const { id } = Route.useParams();
  const dir = useJudgeDirectory();
  const j = dir.data?.find((r) => r.id === id);
  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [
    { label: "Atlas", to: "/" },
    { label: "Judges", to: "/judges" },
  ];
  if (j) {
    const systems = judgeSystems(j);
    const states = judgeStates(j);
    const systemSearch = systems.length === 1 ? { system: systems[0]! } : {};
    crumbs.push({ label: systems.join(" · "), to: "/judges", search: systemSearch });
    crumbs.push({
      label: states.join(" · "),
      to: "/judges",
      search: states.length === 1 ? { ...systemSearch, state: states[0]! } : systemSearch,
    });
    const court = j.courts[0];
    if (court)
      crumbs.push(
        states.length === 1
          ? { label: court, to: "/judges", search: { ...systemSearch, state: states[0]!, court } }
          : { label: court },
      );
  }
  return (
    <EntityPage
      dataset="judges"
      id={id}
      crumbs={crumbs}
      extra={(raw) => (
        <div className="mb-4 rounded-lg border border-primary/25 bg-primary/5 p-4 text-[13px]">
          <Link
            className="font-semibold text-primary underline"
            to="/insights"
            search={{ view: "judges", judge: j?.name ?? String(raw["title"] ?? raw["name"] ?? "") }}
          >
            Open judge analysis and service history
          </Link>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Inspect exact-name catalog cases, duration distributions and sourced federal
            appointments.
          </p>
        </div>
      )}
    />
  );
}
