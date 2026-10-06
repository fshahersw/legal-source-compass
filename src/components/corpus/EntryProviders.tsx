import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarList } from "./BarList";
import { getEntryProviders } from "@/lib/corpus/filingYears.functions";

const PROVIDER_LABELS: Record<string, string> = {
  courtlistener: "CourtListener",
  docketbird: "DocketBird",
  govinfo: "GovInfo",
  "official-court": "Official court website",
};

/** Matter registry docket entries by the provider that supplied them, counted from the live corpus. */
export function EntryProviders() {
  const fn = useServerFn(getEntryProviders);
  const q = useQuery({ queryKey: ["entry-providers"], queryFn: () => fn(), staleTime: 5 * 60_000 });
  if (q.isLoading)
    return (
      <p role="status" className="text-[13px] text-muted-foreground">
        Counting docket entries by source…
      </p>
    );
  if (q.error || !q.data)
    return (
      <p role="alert" className="text-[13px] text-muted-foreground">
        Docket entries by source: Not recorded.{" "}
        <button className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </p>
    );
  const rows = q.data.providers.map((r) => ({
    label: PROVIDER_LABELS[r.provider] ?? r.provider,
    count: r.count,
  }));
  if (q.data.other) rows.push({ label: "Other or not recorded", count: q.data.other });
  return (
    <BarList
      title="Matter registry docket entries by source"
      rows={rows}
      unit="docket entries, read from the corpus when this page loaded"
    />
  );
}
