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
      "One MDL number across the JPML pending reports, hearing sessions, GovInfo Panel orders, terminated-litigation statistics, the transferee court page, linked companies, regulator signal, flags and peers.",
    ),
  component: Page,
});

function Page() {
  const { mdl: raw } = Route.useParams();
  const mdl = parse(raw);
  return (
    <AppShell
      title={`MDL ${raw} case lens`}
      description="What the corpus records for one MDL number, joined by exact MDL number: report trajectory, court and judge, hearing sessions, Panel orders, terminated litigation, court page, companies, flags and peers."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Analytics", to: "/analytics" },
        { label: "Federal court analytics", to: "/courts/analytics" },
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
