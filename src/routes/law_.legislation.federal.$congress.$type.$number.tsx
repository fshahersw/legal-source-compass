import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { StateNote } from "@/components/enforcement/parts";
import { FederalBillView } from "@/components/legislation/FederalBillView";
import { BillTextVersions } from "@/components/apiLaw/BillTextVersions";
import { RelatedPanel } from "@/components/semantic/RelatedPanel";
import { pageHead } from "@/lib/corpus/head";
import {
  BILL_NUMBER,
  BILL_TYPES,
  CONGRESS,
  TYPE_CITE,
  displayCitation,
  type BillType,
} from "@/lib/external/legislation";
import { getFederalBill } from "@/lib/external/legislation.functions";

const isType = (t: string): t is BillType => (BILL_TYPES as readonly string[]).includes(t);

export const Route = createFileRoute("/law_/legislation/federal/$congress/$type/$number")({
  head: ({ params }) => {
    const cite =
      isType(params.type) && CONGRESS.test(params.congress)
        ? displayCitation(params.type, params.number, Number(params.congress))
        : "Federal bill";
    return pageHead(
      cite,
      `${cite}: titles, sponsor and cosponsors, actions, votes, CRS summary, text versions and resulting law from GovInfo Bill Status.`,
    );
  },
  component: FederalBillPage,
});

function FederalBillPage() {
  const { congress, type, number } = Route.useParams();
  const valid = CONGRESS.test(congress) && isType(type) && BILL_NUMBER.test(number);
  const fn = useServerFn(getFederalBill);
  const q = useQuery({
    queryKey: ["federal-bill", congress, type, number],
    queryFn: () => fn({ data: { congress, type: type as BillType, number } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const cite = valid
    ? displayCitation(type as BillType, number, Number(congress))
    : `${type.toUpperCase()} ${number}`;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: cite },
      ]}
      title={cite}
      {...(q.data?.bill ? { description: q.data.bill.title } : {})}
    >
      {!valid ? (
        <StateNote>
          “{type} {number}” in the “{congress}” Congress is not a measure this collection covers
          (the 108th–119th Congress; types {Object.values(TYPE_CITE).join(", ")}).{" "}
          <Link to="/law/legislation" className="text-primary underline">
            Search legislation
          </Link>
        </StateNote>
      ) : q.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the bill">
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted/60" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="h-80 animate-pulse rounded-md border border-border bg-muted/40" />
            <div className="h-80 animate-pulse rounded-md border border-border bg-muted/40" />
          </div>
        </div>
      ) : q.isError ? (
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              className="text-primary underline"
              onClick={() => void q.refetch()}
            >
              Retry
            </button>
          }
        >
          This bill could not be loaded.
        </StateNote>
      ) : q.data ? (
        <>
          <FederalBillView bill={q.data.bill} crs={q.data.crs} crsFailed={q.data.crsFailed} />
          <BillTextVersions billId={`${congress}-${type}-${number}`} className="mt-4" />
          <RelatedPanel
            dataset="congress_bills"
            recordId={`${congress}-${type}-${number}`}
            quiet
            className="mt-6"
          />
        </>
      ) : (
        <>
          <StateNote>
            No Bill Status record for {cite} is stored. GovInfo publishes every numbered measure of
            the 108th–119th Congress; a number that was never introduced has no record.{" "}
            <Link
              to="/law/legislation"
              search={{ q: `${TYPE_CITE[type as BillType]} ${number}`, congress }}
              className="text-primary underline"
            >
              Search instead
            </Link>
          </StateNote>
          <BillTextVersions billId={`${congress}-${type}-${number}`} className="mt-4" />
        </>
      )}
    </AppShell>
  );
}
