import { createFileRoute } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { useJudgeDirectory } from "@/lib/external/useDirectory";

export const Route = createFileRoute("/judges/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(entityQuery("judges", params.id)),
  head: ({ loaderData }) => {
    const raw = (loaderData as { raw?: unknown } | undefined)?.raw as Record<string, unknown> | null | undefined;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Judge profile");
    return pageHead(name, `Judge profile for ${name}: every linked record in the connected corpus on one page.`);
  },
  component: Page,
  errorComponent: ({ error }) => <EntityError error={error instanceof Error ? error : new Error(String(error))} /> ,
  notFoundComponent: () => <p className="p-6 text-[13px]">Judge not found.</p>,
});

function Page() {
  const { id } = Route.useParams();
  const dir = useJudgeDirectory();
  const j = dir.data?.find((r) => r.id === id);
  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [{ label: "Atlas", to: "/" }, { label: "Judges", to: "/judges" }];
  if (j) {
    crumbs.push({ label: j.system, to: "/judges", search: { system: j.system } });
    crumbs.push({ label: j.state, to: "/judges", search: { system: j.system, state: j.state } });
    const court = j.courts[0];
    if (court) crumbs.push({ label: court, to: "/judges", search: { system: j.system, state: j.state, court } });
  }
  return <EntityPage dataset="judges" id={id} crumbs={crumbs} />;
}
