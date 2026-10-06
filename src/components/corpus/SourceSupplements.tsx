import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { fetchBundleSnapshot } from "@/lib/private-data/client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarList, Stat } from "./BarList";
import { stateByUsps } from "@/lib/corpus/geo";

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
    <section className="space-y-4" aria-label="Official court workload statistics">
      <h2 className="eyebrow">Official court workload statistics</h2>
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
