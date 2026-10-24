import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ChartGallery } from "@/components/charts/gallery/ChartGallery";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/prototypes/charts")({
  head: () =>
    pageHead(
      "Chart kit",
      "Every chart primitive of the platform on published data, with its loading, empty, error and partial states.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Chart kit"
      description="Every chart primitive on published data, with its states."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Prototypes", to: "/prototypes" },
        { label: "Chart kit" },
      ]}
    >
      <ChartGallery />
    </AppShell>
  );
}
