import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { Stat } from "@/components/corpus/BarList";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { useDatasets } from "@/components/corpus/DatasetBrowser";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/corpus/head";
import { queryDataset } from "@/lib/external/catalog.functions";
import {
  AVAILABILITY_LABELS,
  DOCKET_DOCUMENTS_DATASET,
  parseDocketDocument,
  type DocketDocument,
} from "@/lib/matters/docketDocuments";
import { formatBytes } from "@/lib/matters/documents";
import { getDocketDocumentsOverview } from "@/lib/matters/matters.functions";

type S = {
  mdl?: string | undefined;
  case_id?: string | undefined;
  year?: string | undefined;
  availability?: string | undefined;
  q?: string | undefined;
  offset?: number | undefined;
};
/** Search values arrive JSON-parsed, so a numeric-looking value such as 3113 is a number; keep it as the text it is. */
const text = (raw: unknown, pattern: RegExp, max = 120) => {
  const v = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
  return typeof v === "string" && v.length <= max && pattern.test(v) ? v : undefined;
};

export const Route = createFileRoute("/sources/docket-documents")({
  validateSearch: (s: Record<string, unknown>): S => ({
    mdl: text(s["mdl"], /^\d{1,6}$/),
    case_id: text(s["case_id"], /^[A-Za-z0-9:._-]{3,80}$/),
    year: text(s["year"], /^\d{4}$/),
    availability: text(s["availability"], /^[a-z_]{3,40}$/),
    q: text(s["q"], /^.{1,120}$/s),
    offset:
      typeof s["offset"] === "number" && Number.isInteger(s["offset"]) && s["offset"] >= 0
        ? s["offset"]
        : undefined,
  }),
  head: () =>
    pageHead(
      "Docket documents",
      "Documents of the DocketBird-tracked cases by docket entry, with availability and the authorised PDF link for stored files.",
    ),
  component: DocketDocumentsPage,
});

function DocketDocumentsPage() {
  const s = Route.useSearch();
  const navigate = useNavigate({ from: "/sources/docket-documents" });
  const datasets = useDatasets();
  const info = datasets.data?.find((d) => d.id === DOCKET_DOCUMENTS_DATASET);
  const overviewFn = useServerFn(getDocketDocumentsOverview);
  const overview = useQuery({
    queryKey: ["docket-documents-overview"],
    queryFn: () => overviewFn(),
    staleTime: 5 * 60_000,
  });
  const fn = useServerFn(queryDataset);
  const filters: Record<string, string> = {};
  if (s.mdl) filters["mdl"] = s.mdl;
  if (s.case_id) filters["case_id"] = s.case_id;
  if (s.year) filters["year"] = s.year;
  if (s.availability) filters["availability"] = s.availability;
  const offset = s.offset ?? 0;
  const q = useQuery({
    queryKey: ["docket-documents", s.q ?? "", filters, offset],
    queryFn: () =>
      fn({ data: { dataset: DOCKET_DOCUMENTS_DATASET, q: s.q ?? "", filters, offset } }),
    placeholderData: keepPreviousData,
  });
  const rows: DocketDocument[] = (q.data?.items ?? [])
    .map((i) => parseDocketDocument(i))
    .filter((d): d is DocketDocument => !!d);
  const set = (next: Partial<S>) =>
    navigate({ search: (prev) => ({ ...prev, ...next, offset: undefined }) });
  const o = overview.data;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Sources", to: "/sources/library" },
        { label: "Docket documents" },
      ]}
      title="Docket documents"
      description="Documents of the cases tracked in DocketBird, one row per docket-sheet document. Counts are read from the connected corpus when the page loads."
    >
      {info?.ready === false ? (
        <p className="text-[13px] text-muted-foreground">
          This collection is not currently available.
        </p>
      ) : (
        <div className="space-y-5">
          {o ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Documents listed" value={o.total ?? "Not recorded"} />
              <Stat label="PDF stored" value={o.stored ?? "Not recorded"} />
              <Stat
                label="Provider has not downloaded the file"
                value={o.providerNotDownloaded ?? "Not recorded"}
              />
              <Stat
                label="Withheld"
                value={o.withheld ?? "Not recorded"}
                note="Documents withheld under the sealed/restricted rule; counted, never listed"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-3 text-[12px]">
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Search description</span>
              <Input
                aria-label="Search document descriptions"
                className="h-8 w-64"
                defaultValue={s.q ?? ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") set({ q: e.currentTarget.value.trim() || undefined });
                }}
                placeholder="Press Enter to search"
              />
            </label>
            {(info?.filters ?? []).map((f) => (
              <label key={f.name} className="flex flex-col gap-1">
                <span className="eyebrow">{f.label}</span>
                <select
                  aria-label={f.label}
                  className="h-8 rounded border border-input bg-surface px-1"
                  value={(s as Record<string, string | number | undefined>)[f.name] ?? ""}
                  onChange={(e) => set({ [f.name]: e.target.value || undefined } as Partial<S>)}
                >
                  <option value="">{f.placeholder ?? "All"}</option>
                  {(f.options ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                      {typeof opt.count === "number" ? ` (${opt.count.toLocaleString()})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {q.data?.total != null ? (
              <span className="text-muted-foreground">
                {q.data.total.toLocaleString()}
                {q.data.capped ? "+" : ""} documents match
              </span>
            ) : null}
          </div>
          {q.error ? <ExternalError error={q.error} /> : null}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
            <table className="w-full text-left text-[12px]">
              <caption className="sr-only">Docket-sheet documents</caption>
              <thead className="bg-muted text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Entry</th>
                  <th className="p-2">Filed</th>
                  <th className="p-2">Description</th>
                  <th className="p-2">File name</th>
                  <th className="p-2">Availability</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Case</th>
                  <th className="p-2">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((d) => (
                  <tr key={d.nativeDocumentId}>
                    <td className="p-2 font-mono">{d.entryNumber ?? "—"}</td>
                    <td className="p-2 font-mono">{d.dateFiled ?? "Not recorded"}</td>
                    <td className="max-w-[28rem] p-2 break-words">
                      {d.description ??
                        (d.descriptionWithheld
                          ? "Description withheld"
                          : "Description not recorded")}
                    </td>
                    <td className="p-2 font-mono text-[11px]">{d.fileName ?? "Not recorded"}</td>
                    <td className="p-2">{AVAILABILITY_LABELS[d.availability]}</td>
                    <td className="p-2">{d.label ?? "Not recorded"}</td>
                    <td className="p-2 font-mono text-[11px]">
                      {d.nativeCaseId ?? "Not recorded"}
                      {d.mdl ? ` · MDL ${d.mdl}` : ""}
                    </td>
                    <td className="p-2">
                      {d.pdfUrl ? (
                        <a
                          href={d.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline"
                        >
                          Open PDF
                          {d.bytes !== null ? ` (${formatBytes(d.bytes)})` : ""}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
          {!q.isLoading && !rows.length ? (
            <p className="text-[13px] text-muted-foreground">No document matches these filters.</p>
          ) : null}
          <div className="flex items-center gap-3 text-[12px]">
            <button
              type="button"
              disabled={offset === 0}
              className="rounded border border-border px-2 py-1 disabled:opacity-40"
              onClick={() =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    offset: Math.max(0, offset - (q.data?.pageSize ?? 50)) || undefined,
                  }),
                })
              }
            >
              Previous
            </button>
            <button
              type="button"
              disabled={q.data?.total != null && offset + (q.data?.pageSize ?? 50) >= q.data.total}
              className="rounded border border-border px-2 py-1 disabled:opacity-40"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, offset: offset + (q.data?.pageSize ?? 50) }),
                })
              }
            >
              Next
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {info?.qualification ??
              "Documents as the provider's docket sheet shows them. PDFs open only through the authorised in-app route."}
          </p>
        </div>
      )}
    </AppShell>
  );
}
