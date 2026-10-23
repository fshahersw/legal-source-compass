import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { StateNote } from "@/components/enforcement/parts";
import { MemberView } from "@/components/legislation/MemberView";
import { pageHead } from "@/lib/corpus/head";
import { BIOGUIDE } from "@/lib/external/congressMembers";
import { getMember } from "@/lib/external/congressMembers.functions";

export const Route = createFileRoute("/law_/legislation/members/$bioguide")({
  head: () =>
    pageHead(
      "Member of Congress",
      "A member of Congress as the Congress.gov API publishes them: terms by Congress, party history, official website, and the bills sponsored and cosponsored.",
    ),
  component: MemberPage,
});

function MemberPage() {
  const { bioguide } = Route.useParams();
  const valid = BIOGUIDE.test(bioguide);
  const fn = useServerFn(getMember);
  const q = useQuery({
    queryKey: ["congress-member", bioguide],
    queryFn: () => fn({ data: { bioguide } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const label = q.data ? (q.data.directName ?? q.data.name) : valid ? "Member" : "Member not found";
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "Members of Congress", to: "/law/legislation/members" },
        { label },
      ]}
      title={label}
      {...(q.data?.years ? { description: q.data.years } : {})}
    >
      {!valid ? (
        <StateNote>
          “{bioguide}” is not a Bioguide ID (one capital letter and six digits, such as A000055).{" "}
          <Link to="/law/legislation/members" className="text-primary underline">
            Search members
          </Link>
        </StateNote>
      ) : q.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the member">
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
          This member could not be loaded.
        </StateNote>
      ) : q.data ? (
        <MemberView member={q.data} />
      ) : (
        <StateNote>
          No member with Bioguide ID {bioguide} is stored. The collection holds the members the
          Congress.gov API lists.{" "}
          <Link
            to="/law/legislation/members"
            search={{ q: bioguide, status: "all" }}
            className="text-primary underline"
          >
            Search instead
          </Link>
        </StateNote>
      )}
    </AppShell>
  );
}
