import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { MdlLens, mdlLensQuery } from "@/components/lens/MdlLens";
import { pageHead } from "@/lib/corpus/head";

const parse = (raw: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : null;
};

export const Route = createFileRoute("/matters/lens/$mdl")({
  loader: ({ context, params }) => {
    const mdl = parse(params.mdl);
    return mdl ? context.queryClient.prefetchQuery(mdlLensQuery(mdl)) : undefined;
  },
  head: ({ params }) =>
    pageHead(
      `MDL ${params.mdl} case lens`,
      "One MDL across JPML trajectory, transferee court, judge, regulator signal, flags and peers.",
    ),
  component: Page,
});

function Page() {
  const { mdl: raw } = Route.useParams();
  const mdl = parse(raw);
  return (
    <AppShell
      title={`MDL ${raw} case lens`}
      description="Trajectory, court, judge, regulator, automated flags and peers for one MDL, joined by MDL number."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "MDL analytics", to: "/matters/analytics" },
        { label: `MDL ${raw}` },
      ]}
    >
      {mdl ? (
        <MdlLens mdl={mdl} />
      ) : (
        <p className="text-sm text-muted-foreground">“{raw}” is not an MDL number.</p>
      )}
    </AppShell>
  );
}
