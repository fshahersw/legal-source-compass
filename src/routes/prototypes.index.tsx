import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { PrototypeNotice } from "@/components/prototypes/PrototypeNotice";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/prototypes/")({
  head: () =>
    pageHead("Design prototypes", "Proposed court, judge and MDL page designs on live data."),
  component: Page,
});

const EXAMPLES = [
  {
    title: "Court profile",
    note: "Caseload vital signs with national position, six-year trend, nature of suit, MDLs and sitting judges.",
    links: [
      { label: "D. New Jersey", to: "/prototypes/court/$id", id: "njd" },
      { label: "N.D. California", to: "/prototypes/court/$id", id: "cand" },
      { label: "S.D. Ohio", to: "/prototypes/court/$id", id: "ohsd" },
    ],
  },
  {
    title: "Judge profile",
    note: "Appointment record, service timeline, education and career, MDL docket and court workload.",
    links: [
      {
        label: "Michael A. Shipp",
        to: "/prototypes/judge/$id",
        id: "2bd1f904b1639f16cc7e65e218c52997",
      },
      {
        label: "Yvonne Gonzalez Rogers",
        to: "/prototypes/judge/$id",
        id: "dbd3b16a5816cbc8aeccdf0875a2e973",
      },
    ],
  },
  {
    title: "MDL dossier",
    note: "Trajectory, momentum, position among peers and the product-safety signal for one MDL.",
    links: [
      { label: "MDL 2738 · Talc", to: "/prototypes/mdl/$id", id: "2738" },
      { label: "MDL 3094 · GLP-1", to: "/prototypes/mdl/$id", id: "3094" },
      { label: "MDL 3140 · Depo-Provera", to: "/prototypes/mdl/$id", id: "3140" },
    ],
  },
] as const;

function Page() {
  return (
    <AppShell
      title="Design prototypes"
      description="Proposed page designs rendered on live corpus data."
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Prototypes" }]}
    >
      <PrototypeNotice />
      <div className="grid gap-3 lg:grid-cols-3">
        {EXAMPLES.map((e) => (
          <section
            key={e.title}
            className="rounded-xl border border-border bg-card shadow-xs p-4"
            aria-label={e.title}
          >
            <h2 className="text-heading font-semibold text-foreground">{e.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {e.links.map((l) => (
                <li key={l.id}>
                  <Link to={l.to} params={{ id: l.id }} className="text-primary hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
