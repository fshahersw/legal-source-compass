import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { VacanciesPage } from "@/components/judiciary/VacanciesPage";
import { vacanciesOverviewQuery } from "@/components/judiciary/judiciaryQueries";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/vacancies")({
  loader: ({ context }) => {
    const warm = context.queryClient.prefetchQuery(vacanciesOverviewQuery);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Judicial vacancies",
      "Current and announced vacancies in federal judgeships, judicial emergencies and pending nominees from the Administrative Office of the U.S. Courts lists of October 22, 2026, with the monthly vacancy history since 1981.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Judicial vacancies"
      description="Open and announced federal judgeship vacancies, judicial emergencies and the nominees pending for them, as listed by the Administrative Office of the U.S. Courts, with the monthly history since 1981."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Courts", to: "/courts" },
        { label: "Judicial vacancies" },
      ]}
    >
      <VacanciesPage />
    </AppShell>
  );
}
