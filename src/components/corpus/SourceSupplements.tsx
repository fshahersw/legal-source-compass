import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { fetchBundleSnapshot } from "@/lib/private-data/client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarList, Stat } from "./BarList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stateByUsps } from "@/lib/corpus/geo";
import {
  filterRegisterDocuments,
  loadRegisterDocuments,
  loadRegisterManifest,
  publicationLabel,
} from "@/lib/corpus/registerUpdates";

type Benchmark = {
  schemaVersion: number;
  sourceUrl: string;
  period: string;
  qualification: string;
  totals: {
    filed2024: number;
    filed2025: number;
    terminated2025: number;
    pending2025: number;
  };
  jurisdictions: {
    code: string;
    filed2024: number;
    filed2025: number;
    terminated2025: number;
    pending2025: number;
  }[];
};
async function loadBenchmark(): Promise<Benchmark> {
  const r = await fetchBundleSnapshot("/data/quality/reference/uscourts-table-c-2025.json");
  if (!r.ok) throw new Error(`Court benchmark: HTTP ${r.status}`);
  const b = (await r.json()) as Benchmark;
  if (b.schemaVersion !== 1 || !Array.isArray(b.jurisdictions))
    throw new Error("Court benchmark format is invalid.");
  return b;
}

export function SourceSupplements() {
  const register = useQuery({
    queryKey: ["register-gap-manifest"],
    queryFn: loadRegisterManifest,
    staleTime: Infinity,
  });
  const benchmark = useQuery({
    queryKey: ["court-benchmark-2025"],
    queryFn: loadBenchmark,
    staleTime: Infinity,
  });
  const [metric, setMetric] = useState<"filed2025" | "terminated2025" | "pending2025">("filed2025");
  const b = benchmark.data;
  const metrics = {
    filed2025: "Filed",
    terminated2025: "Terminated",
    pending2025: "Pending at period end",
  };
  return (
    <section className="space-y-4" aria-label="Verified public source supplements">
      <h2 className="eyebrow">Public source supplements · separate populations</h2>
      {register.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Loading the regulatory update index…</p>
      ) : register.error ? (
        <p className="text-[13px] text-muted-foreground">Regulatory update index: Not recorded.</p>
      ) : register.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="New Federal Register index records"
              value={register.data.records}
              note={`${register.data.publicationFrom} through ${register.data.publicationThrough}`}
            />
            <Stat
              label="Documents with CFR references"
              value={register.data.cfrReferenceRecords}
              note="Publisher-provided references, not inferred links"
            />
            <Stat
              label="Publisher effective dates recorded"
              value={register.data.effectiveDateRecords}
              note="Dates are distinct from publication and legal currency"
            />
            <Stat
              label="Corrections with native references"
              value={register.data.correctionRecords}
              note="Native correction identifiers remain intact"
            />
          </div>
          <BarList
            title="Publication types in the new index"
            rows={register.data.typeCounts.map((r) => ({
              ...r,
              label: publicationLabel(r.label),
            }))}
            unit="documents in this bounded publication interval"
          />
          <p className="text-[12px] text-muted-foreground">
            {register.data.qualification} These records are a bundled supplement and are not added
            to the external database total.
          </p>
          <RegisterBrowser />
        </>
      ) : null}
      {benchmark.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Loading the court workload benchmark…</p>
      ) : benchmark.error ? (
        <p className="text-[13px] text-muted-foreground">Court workload benchmark: Not recorded.</p>
      ) : b ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="eyebrow">Official civil workload · {b.period}</h3>
            <a
              href={b.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-primary hover:underline"
            >
              U.S. Courts Table C
            </a>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Civil filings, FY 2025"
              value={b.totals.filed2025}
              note={`${b.totals.filed2024.toLocaleString()} in FY 2024`}
            />
            <Stat label="Civil terminations, FY 2025" value={b.totals.terminated2025} />
            <Stat
              label="Civil cases pending at period end"
              value={b.totals.pending2025}
              note="Includes MDL transfers"
            />
          </div>
          <label className="flex flex-wrap items-center gap-2 text-[12px]">
            Workload measure
            <select
              aria-label="Court benchmark metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as typeof metric)}
              className="rounded border border-input bg-surface p-1"
            >
              {Object.entries(metrics).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <BarList
            title={`${metrics[metric]} by jurisdiction · FY 2025`}
            rows={b.jurisdictions
              .map((r) => ({
                label: stateByUsps.get(r.code)?.name ?? r.code,
                count: r[metric],
              }))
              .sort((a, c) => c.count - a.count)}
            unit="publisher district rows summed by jurisdiction; circuit subtotals excluded"
          />
          <p className="text-[12px] text-muted-foreground">{b.qualification}</p>
          <PrivateDataLink
            className="text-[12px] text-primary hover:underline"
            href="/data/quality/reference/uscourts-table-c-2025.json"
            download
          >
            Download benchmark, district rows and workbook hash
          </PrivateDataLink>
        </>
      ) : null}
    </section>
  );
}

function RegisterBrowser() {
  const manifest = useQuery({
    queryKey: ["register-gap-manifest"],
    queryFn: loadRegisterManifest,
    staleTime: Infinity,
  });
  const [show, setShow] = useState(false);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const data = useQuery({
    queryKey: ["register-gap-documents"],
    enabled: show && !!manifest.data,
    queryFn: () => loadRegisterDocuments(manifest.data!),
    staleTime: Infinity,
  });
  const filtered = useMemo(
    () =>
      [...filterRegisterDocuments(data.data ?? [], q, type)].sort(
        (a, b) =>
          b.publication_date.localeCompare(a.publication_date) ||
          b.document_number.localeCompare(a.document_number),
      ),
    [data.data, q, type],
  );
  return (
    <div className="space-y-3">
      <Button size="sm" variant="outline" onClick={() => setShow((s) => !s)}>
        {show ? "Hide" : "Browse"} regulatory update index
      </Button>
      {show ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            Original API pages load on demand and are checked against their hashes. Links open the
            publisher's entry or official GovInfo PDF.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search regulatory update index"
              placeholder="Document number, title or agency"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              className="h-8 max-w-sm"
            />
            <select
              aria-label="Regulatory publication type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(0);
              }}
              className="rounded border border-input bg-surface p-1 text-[12px]"
            >
              <option value="">All publication types</option>
              {manifest.data?.typeCounts.map((r) => (
                <option key={r.label} value={r.label}>
                  {publicationLabel(r.label)}
                </option>
              ))}
            </select>
            {data.isSuccess ? (
              <span className="text-[12px] text-muted-foreground">
                {filtered.length.toLocaleString()} matching documents
              </span>
            ) : null}
          </div>
          {data.isLoading ? (
            <p role="status" className="text-[13px] text-muted-foreground">
              Loading and verifying source pages…
            </p>
          ) : data.error ? (
            <p role="alert" className="text-[13px] text-muted-foreground">
              Source pages could not be verified.{" "}
              <button className="underline" onClick={() => data.refetch()}>
                Retry
              </button>
            </p>
          ) : data.isSuccess ? (
            <>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="p-2">Document</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Published</th>
                      <th className="p-2">Effective date as recorded</th>
                      <th className="p-2">CFR references</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.slice(page * 50, page * 50 + 50).map((r) => (
                      <tr key={r.document_number}>
                        <td className="min-w-72 p-2">
                          <a
                            href={r.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {r.document_number} · {r.title}
                          </a>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {r.agencies.map((a) => a.name).join("; ")}
                          </div>
                        </td>
                        <td className="p-2">{publicationLabel(r.type)}</td>
                        <td className="p-2">{r.publication_date}</td>
                        <td className="p-2">{r.effective_on ?? "Not recorded"}</td>
                        <td className="p-2">
                          {r.cfr_references?.length
                            ? r.cfr_references
                                .map((c) => `${c.title} CFR${c.part == null ? "" : ` ${c.part}`}`)
                                .join("; ")
                            : "Not recorded"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No index documents match.</p>
              ) : null}
              <div className="flex items-center gap-2 text-[12px]">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous documents
                </Button>
                <span>
                  {filtered.length
                    ? `${page * 50 + 1}–${Math.min((page + 1) * 50, filtered.length)}`
                    : "0"}{" "}
                  of {filtered.length.toLocaleString()}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * 50 >= filtered.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next documents
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
