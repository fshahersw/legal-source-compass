import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { CaseCatalog } from "@/components/corpus/CaseCatalog";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/cases")({
  head: () => pageHead("Case catalog", "Tracked federal cases with judges, firms of record, status and linked MDLs."),
  component: () => (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Litigation", to: "/courts" }, { label: "Case catalog" }]} title="Case catalog" description="Tracked cases with judge, firms of record, status and MDL link. Click a firm or judge to narrow.">
      <CaseCatalog />
    </AppShell>
  ),
});
