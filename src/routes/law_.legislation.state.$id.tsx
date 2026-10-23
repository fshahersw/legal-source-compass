import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { StateNote } from "@/components/enforcement/parts";
import { StateBillView } from "@/components/legislation/StateBillView";
import { pageHead } from "@/lib/corpus/head";
import { STATE_BILL_ID } from "@/lib/external/legislation";
import { getStateBill } from "@/lib/external/legislation.functions";

export const Route = createFileRoute("/law_/legislation/state/$id")({
  head: () =>
    pageHead(
      "State bill",
      "A state bill from Open States public data: title, sponsors, actions, milestones, versions and the legislature's own page.",
    ),
  component: StateBillPage,
});

function StateBillPage() {
  const { id } = Route.useParams();
  const valid = STATE_BILL_ID.test(id);
  const fn = useServerFn(getStateBill);
  const q = useQuery({
    queryKey: ["state-bill", id],
    queryFn: () => fn({ data: { id } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const b = q.data;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        ...(b ? [{ label: b.stateName, to: `/law/legislation?scope=state&state=${b.state}` }] : []),
        { label: b ? b.identifier : "State bill" },
      ]}
      title={b ? `${b.identifier} · ${b.stateName}` : "State bill"}
      {...(b ? { description: b.session.name } : {})}
    >
      {!valid ? (
        <StateNote>
          “{id}” is not a state bill identifier in this collection.{" "}
          <Link
            to="/law/legislation"
            search={{ scope: "state" }}
            className="text-primary underline"
          >
            Search state bills
          </Link>
        </StateNote>
      ) : q.isLoading ? (
        <div
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
          aria-busy="true"
          aria-label="Loading the bill"
        >
          <div className="h-80 animate-pulse rounded-md border border-border bg-muted/40" />
          <div className="h-80 animate-pulse rounded-md border border-border bg-muted/40" />
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
      ) : b ? (
        <StateBillView bill={b} />
      ) : (
        <StateNote>
          No state bill “{id}” is stored. The collection holds each legislature's current and
          preceding regular session.{" "}
          <Link
            to="/law/legislation"
            search={{ scope: "state" }}
            className="text-primary underline"
          >
            Search state bills
          </Link>
        </StateNote>
      )}
    </AppShell>
  );
}
