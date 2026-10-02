import { createFileRoute } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/atlas/exports";

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
  errorComponent: ({ error }) => <EntityError error={error instanceof Error ? error : new Error(String(error))} /> ,
  notFoundComponent: () => <p className="p-6 text-[13px]">Record not found.</p>,
});

function Page() {
  const { dataset, id } = Route.useParams();
  return <EntityPage dataset={dataset} id={id} crumbs={[{ label: "Atlas", to: "/" }, { label: datasetDisplayName(dataset), to: `/data/${dataset}` }]} extra={(raw) => <div className="mb-5 space-y-3">
    {typeof raw["qualification"] === "string" && raw["qualification"] ? <p role="note" className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">{raw["qualification"]}</p> : null}
    {raw["text_truncated"] === true ? <p className="text-[12px] text-muted-foreground">The stored text is a preview. Use the original source link to check the complete document.</p> : null}
    <Button size="sm" variant="outline" onClick={() => downloadText(`${dataset}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`, "application/json", JSON.stringify({ schema_version: "corpus-detail-export.1", dataset, record_id: id, exported_at: new Date().toISOString(), record: raw }, null, 2))}>Download record metadata</Button>
  </div>} />;
}
