import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarList, Stat } from "./BarList";
import { getFilingYears, type FilingYearDataset } from "@/lib/corpus/filingYears.functions";

/** Rows per filing year, counted from the live corpus when the page loads. */
export function FilingYears({
  dataset,
  title,
  rowLabel,
  note,
}: {
  dataset: FilingYearDataset;
  title: string;
  rowLabel: string;
  note: string;
}) {
  const fn = useServerFn(getFilingYears);
  const q = useQuery({ queryKey: ["filing-years", dataset], queryFn: () => fn({ data: { dataset } }), staleTime: 5 * 60_000 });
  if (q.isLoading)
    return (
      <p role="status" className="text-[13px] text-muted-foreground">
        Counting {rowLabel} by filing year…
      </p>
    );
  if (q.error || !q.data)
    return (
      <p role="alert" className="text-[13px] text-muted-foreground">
        {title}: Not recorded.{" "}
        <button className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </p>
    );
  const d = q.data;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="eyebrow">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`${rowLabel} in this collection`} value={d.total ?? "Not recorded"} />
        <Stat label="With a recorded filing date" value={d.dated} {...(d.years.length ? { note: `${d.years[0]!.year} to ${d.years[d.years.length - 1]!.year}` } : {})} />
        <Stat label="Filing date not recorded" value={d.notRecorded ?? "Not recorded"} />
      </div>
      {d.years.length ? (
        <BarList title="By filing year" rows={d.years.map((r) => ({ label: String(r.year), count: r.count }))} limit={80} unit={`${rowLabel}, read from the corpus when this page loaded`} />
      ) : (
        <p className="text-[13px] text-muted-foreground">No rows with a recorded filing date.</p>
      )}
      <p className="text-[11px] text-muted-foreground">{note}</p>
    </section>
  );
}
