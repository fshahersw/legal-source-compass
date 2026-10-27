import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { FreshnessBadge } from "@/components/freshness/FreshnessBadge";
import { ExternalBadge } from "@/components/corpus/ExternalBadge";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { datasetLabel, datasetSuccessor } from "@/lib/external/groups";
import { pageHead } from "@/lib/corpus/head";

type S = { q?: string | undefined; f?: Record<string, string> | undefined };

export const Route = createFileRoute("/data/$dataset")({
  // A URL typed by hand (?q=3140&f[mdl]=3140) parses 3140 as a number; keep it as the text it is.
  validateSearch: (s: Record<string, unknown>): S => ({
    q:
      typeof s["q"] === "string"
        ? s["q"]
        : typeof s["q"] === "number" && Number.isFinite(s["q"])
          ? String(s["q"])
          : undefined,
    f:
      s["f"] && typeof s["f"] === "object"
        ? (Object.fromEntries(
            Object.entries(s["f"] as Record<string, unknown>)
              .filter(
                ([, v]) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)),
              )
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>)
        : undefined,
  }),
  // A retired collection id opens the collection its rows moved into (same search and filters).
  beforeLoad: ({ params, search }) => {
    const next = datasetSuccessor(params.dataset);
    if (next)
      throw redirect({ to: "/data/$dataset", params: { dataset: next }, search, replace: true });
  },
  head: ({ params }) =>
    pageHead(
      datasetLabel(params.dataset, null),
      `Browse the ${params.dataset} dataset from the connected corpus.`,
    ),
  component: DatasetPage,
});

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { q, f } = Route.useSearch();
  const ds = useDatasets();
  const info = ds.data?.find((d) => d.id === dataset);
  const label = datasetLabel(dataset, info?.label);
  return (
    <AppShell
      // The shell puts the dataset under its section and tab (e.g. Enforcement › Actions by agency).
      breadcrumbs={[{ label: "Data catalog", to: "/data" }, { label }]}
      title={label}
      description={info?.records != null ? `${info.records.toLocaleString()} imported records` : ""}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ExternalBadge />
        <FreshnessBadge dataset={dataset} />
      </div>
      {ds.data && !info ? (
        <p className="text-[13px] text-destructive">
          No dataset named “{dataset}” exists in the corpus.
        </p>
      ) : null}
      <DatasetBrowser
        key={`${dataset}-${q}-${JSON.stringify(f)}`}
        dataset={dataset}
        initialQ={q ?? ""}
        initialFilters={f ?? {}}
      />
    </AppShell>
  );
}
