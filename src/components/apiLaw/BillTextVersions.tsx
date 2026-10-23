import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Panel, SourceLink } from "@/components/enforcement/parts";
import { getBillVersions } from "@/lib/external/apiLaw.functions";

const fmtDay = (d: string | null) => {
  if (!d) return "date not recorded";
  const t = Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : d;
};

/**
 * Every text version GovInfo has published for one bill (govinfo_bill_versions, refreshed daily), with direct PDF, HTML
 * and XML links. Renders nothing while loading, when the dataset is not published, or when GovInfo lists no version.
 */
export function BillTextVersions({
  billId,
  className = "",
}: {
  billId: string;
  className?: string;
}) {
  const fn = useServerFn(getBillVersions);
  const q = useQuery({
    queryKey: ["bill-text-versions", billId],
    queryFn: () => fn({ data: { billId } }),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  if (q.isLoading || q.isError || !q.data || !q.data.versions.length) return null;
  const versions = q.data.versions;
  return (
    <Panel
      className={className}
      title="Text versions on GovInfo"
      subtitle={`${versions.length} ${versions.length === 1 ? "version" : "versions"} in GovInfo's Congressional Bills collection, oldest first; checked daily`}
      footnote={
        <>
          Source: GovInfo Congressional Bills collection (U.S. Government Publishing Office). Each
          link opens the official package.
        </>
      }
    >
      <ul className="divide-y divide-border/60 text-[12.5px]">
        {versions.map((v) => (
          <li
            key={v.packageId}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-1.5"
          >
            <span className="min-w-0">
              <span className="font-medium">{v.label}</span>
              <span className="ml-2 text-muted-foreground">{fmtDay(v.date)}</span>
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                {v.packageId}
              </span>
            </span>
            <span className="flex flex-wrap gap-x-3">
              <SourceLink href={v.details}>Details</SourceLink>
              <SourceLink href={v.pdf}>PDF</SourceLink>
              {v.html ? <SourceLink href={v.html}>HTML</SourceLink> : null}
              {v.xml ? <SourceLink href={v.xml}>XML</SourceLink> : null}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
