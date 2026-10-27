import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { pageHead } from "@/lib/corpus/head";

/**
 * The former MDL case lens. Its records (JPML series, hearings, Panel orders, terminated litigation, court page,
 * companies, signal, flags, peers) now sit on the MDL command page, which serves recorded MDLs too, so a valid MDL
 * number redirects to /matters/$id#mdl-jpml. The route stays: about 25 components, published records
 * (jpml_mdl_pending_series links) and insights facts carry this path. A value that is not an MDL number keeps its
 * message.
 */
const parse = (raw: string) => {
  const n = Number(raw);
  return /^\d{1,5}$/.test(raw) && Number.isInteger(n) && n > 0 && n < 100000 ? n : null;
};

export const Route = createFileRoute("/matters/lens/$mdl")({
  beforeLoad: ({ params }) => {
    const mdl = parse(params.mdl);
    if (mdl)
      throw redirect({
        to: "/matters/$id",
        params: { id: String(mdl) },
        hash: "mdl-jpml",
        replace: true,
      });
  },
  head: ({ params }) => pageHead(`MDL ${params.mdl}`, "Not an MDL number."),
  component: Page,
});

function Page() {
  const { mdl: raw } = Route.useParams();
  return (
    <AppShell
      title={`MDL ${raw}`}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Matters", to: "/matters" },
        { label: `MDL ${raw}` },
      ]}
    >
      <p className="text-sm text-muted-foreground">“{raw}” is not an MDL number.</p>
    </AppShell>
  );
}
