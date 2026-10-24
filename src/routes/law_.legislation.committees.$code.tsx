import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { StateNote } from "@/components/enforcement/parts";
import { CommitteeView } from "@/components/legislation/CommitteeView";
import { CommitteeMarkCaption, CommitteeMarkEmblem } from "@/components/visuals/CommitteeMark";
import { useCommitteeMarkShown } from "@/components/visuals/useCommitteeMark";
import { pageHead } from "@/lib/corpus/head";
import { COMMITTEE_CODE } from "@/lib/external/congressMembers";
import { getCommittee } from "@/lib/external/congressMembers.functions";

export const Route = createFileRoute("/law_/legislation/committees/$code")({
  head: () =>
    pageHead(
      "Congressional committee",
      "A House, Senate or joint committee or subcommittee as the Congress.gov API publishes it: type, parent, subcommittees, name history and the Congresses that list it.",
    ),
  component: CommitteePage,
});

function CommitteePage() {
  const { code } = Route.useParams();
  const valid = COMMITTEE_CODE.test(code);
  const fn = useServerFn(getCommittee);
  const q = useQuery({
    queryKey: ["congress-committee", code],
    queryFn: () => fn({ data: { code } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const label = q.data ? q.data.committee.name : valid ? "Committee" : "Committee not found";
  const markShown = useCommitteeMarkShown(code);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "Committees", to: "/law/legislation/committees" },
        { label },
      ]}
      title={label}
      emblem={
        q.data && markShown ? (
          <CommitteeMarkEmblem code={code} name={q.data.committee.name} />
        ) : undefined
      }
    >
      {!valid ? (
        <StateNote>
          “{code}” is not a committee system code (for example hsju00).{" "}
          <Link to="/law/legislation/committees" className="text-primary underline">
            Search committees
          </Link>
        </StateNote>
      ) : q.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the committee">
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
          This committee could not be loaded.
        </StateNote>
      ) : q.data ? (
        <>
          <CommitteeMarkCaption code={code} className="mb-3" />
          <CommitteeView committee={q.data.committee}>{q.data.children}</CommitteeView>
        </>
      ) : (
        <StateNote>
          No committee with system code {code} is stored. The collection holds the committees the
          Congress.gov API lists.{" "}
          <Link
            to="/law/legislation/committees"
            search={{ q: code, status: "all" }}
            className="text-primary underline"
          >
            Search instead
          </Link>
        </StateNote>
      )}
    </AppShell>
  );
}
