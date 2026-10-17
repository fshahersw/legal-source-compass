import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { PrototypeNotice } from "@/components/prototypes/PrototypeNotice";
import { JudgeProfilePrototype } from "@/components/prototypes/JudgeProfilePrototype";
import { getJudgeFjcProfile } from "@/lib/external/judgeProfiles.functions";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/prototypes/judge/$id")({
  head: () => pageHead("Judge profile prototype", "Design prototype of the judge profile page."),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["judge-fjc", id],
    queryFn: () => getJudgeFjcProfile({ data: { id } }),
  });
  return (
    <AppShell
      title="Judge profile — design prototype"
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Prototypes", to: "/prototypes" },
        { label: "Judge" },
      ]}
    >
      <PrototypeNotice />
      {q.isLoading ? (
        <div
          className="h-96 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
        />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          The judge record could not be loaded.
        </p>
      ) : q.data ? (
        <JudgeProfilePrototype profile={q.data} fjcUrl={`https://www.fjc.gov/node/${q.data.nid}`} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No Federal Judicial Center profile is linked to this judge.
        </p>
      )}
    </AppShell>
  );
}
