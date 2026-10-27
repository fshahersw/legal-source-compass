import { createFileRoute, redirect } from "@tanstack/react-router";
import { datasetSuccessor } from "@/lib/external/groups";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/atlas/exports";
import { BillForPublicLawRecord } from "@/components/legislation/BillForLaw";
import { RelatedPanel } from "@/components/semantic/RelatedPanel";

export const Route = createFileRoute("/records/$dataset/$id")({
  // A record of a retired collection keeps its id in the collection it moved into.
  beforeLoad: ({ params }) => {
    const next = datasetSuccessor(params.dataset);
    if (next) throw redirect({ to: "/records/$dataset/$id", params: { dataset: next, id: params.id }, replace: true });
  },
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

/** Report datasets whose semantic record ids are their corpus record ids (statutes, regulations and bills have their own pages). */
const RELATED_ON_RECORD_PAGE = new Set(["crs_reports", "oversight_reports", "doj_oig_reports", "ftc_publications_index"] as const);
type RecordPageDataset = typeof RELATED_ON_RECORD_PAGE extends Set<infer T> ? T : never;
const relatedOnRecordPage = (d: string): d is RecordPageDataset => RELATED_ON_RECORD_PAGE.has(d as RecordPageDataset);

function Page() {
  const { dataset, id } = Route.useParams();
  return <EntityPage dataset={dataset} id={id} crumbs={[{ label: "Home", to: "/" }, { label: datasetDisplayName(dataset), to: `/data/${dataset}` }]} extra={(raw) => <div className="mb-5 space-y-3">
    {typeof raw["qualification"] === "string" && raw["qualification"] ? <p role="note" className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">{raw["qualification"]}</p> : null}
    {dataset === "public_laws_enacted" ? <BillForPublicLawRecord raw={raw} /> : null}
    {relatedOnRecordPage(dataset) ? <RelatedPanel dataset={dataset} recordId={id} quiet /> : null}
    {raw["text_truncated"] === true ? <p className="text-[12px] text-muted-foreground">The stored text is a preview. Use the original source link to check the complete document.</p> : null}
    <Button size="sm" variant="outline" onClick={() => downloadText(`${dataset}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`, "application/json", JSON.stringify({ schema_version: "corpus-detail-export.1", dataset, record_id: id, exported_at: new Date().toISOString(), record: raw }, null, 2))}>Download record metadata</Button>
  </div>} />;
}
