import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { Section, SectionIndex } from "@/components/kit";
import { VacanciesPage } from "@/components/judiciary/VacanciesPage";
import { VacancyMdlBoard } from "@/components/judiciary/VacancyMdlBoard";
import { vacanciesOverviewQuery } from "@/components/judiciary/judiciaryQueries";
import { vacancyBoardQuery } from "@/components/courts/venue/venueQueries";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/vacancies")({
  loader: ({ context }) => {
    const warm = Promise.all([
      context.queryClient.prefetchQuery(vacancyBoardQuery),
      context.queryClient.prefetchQuery(vacanciesOverviewQuery),
    ]);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Judicial vacancies",
      "Current and announced vacancies in federal judgeships, the MDL districts they affect, judicial emergencies and pending nominees from the Administrative Office of the U.S. Courts lists of October 22, 2026, with the monthly vacancy history since 1981.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Judicial vacancies"
      description="Open and announced federal judgeship vacancies, the MDL districts they affect, and pending nominees."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Courts", to: "/courts" },
        { label: "Judicial vacancies" },
      ]}
    >
      <SectionIndex
        items={[
          { id: "vacancy-mdl", label: "Vacancies and MDLs" },
          { id: "vacancy-lists", label: "Vacancy lists" },
        ]}
      />
      <div className="stack-block space-y-10">
        <VacancyMdlBoard />
        <Section
          id="vacancy-lists"
          title="Vacancy lists"
          description="Every open, announced and emergency vacancy as the Administrative Office lists it."
        >
          <VacanciesPage />
        </Section>
      </div>
    </AppShell>
  );
}
