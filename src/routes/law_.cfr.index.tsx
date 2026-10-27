import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { parseCitation } from "@/lib/external/ecfrFull";
import { getCfrCollection } from "@/lib/external/ecfrFull.functions";
import { CfrAgencyIndex } from "@/components/authorities/AgencyPanels";
import { LawAtlas } from "@/components/lawviz/LawAtlas";
import { CfrChangeRadar } from "@/components/law/CfrChangeRadar";
import { cfrRadarQuery } from "@/components/law/lawQueries";
import { SectionIndex } from "@/components/kit";

export const Route = createFileRoute("/law_/cfr/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(cfrRadarQuery);
  },
  head: () =>
    pageHead(
      "Code of Federal Regulations",
      "Full current text of the Code of Federal Regulations from the eCFR, with each section's change history since 2017.",
    ),
  component: CfrIndexPage,
});

function CfrIndexPage() {
  const fn = useServerFn(getCfrCollection);
  const q = useQuery({
    queryKey: ["cfr-collection"],
    queryFn: () => fn(),
    staleTime: 10 * 60 * 1000,
  });
  const navigate = useNavigate();
  const [cite, setCite] = useState("");
  const [bad, setBad] = useState(false);
  const go = () => {
    const c = parseCitation(cite);
    if (!c) {
      setBad(true);
      return;
    }
    setBad(false);
    if (c.section)
      void navigate({
        to: "/law/cfr/$title/$section",
        params: { title: c.title, section: c.section },
      });
    else if (c.part)
      void navigate({ to: "/law/cfr/$title/part/$part", params: { title: c.title, part: c.part } });
  };
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Code of Federal Regulations" },
      ]}
      title="Code of Federal Regulations"
      description="Full current text from the eCFR, section by section, with each section's change history since 2017 and the text as of any past date."
    >
      <SectionIndex
        items={[
          { id: "cfr-radar", label: "Change radar" },
          { id: "cfr-browse", label: "Browse titles" },
          { id: "cfr-atlas", label: "Atlas and agencies" },
        ]}
      />
      <div className="stack-block">
        <CfrChangeRadar />
      </div>
      <h2 id="cfr-browse" className="mb-3 mt-8 scroll-mt-16 text-heading text-foreground">
        Browse the CFR
      </h2>
      <form
        role="search"
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label className="sr-only" htmlFor="cfr-cite">
          Go to a citation
        </label>
        <input
          id="cfr-cite"
          value={cite}
          onChange={(e) => setCite(e.target.value)}
          placeholder="Citation, e.g. 21 CFR 314.70 or 40 CFR part 60"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          Go
        </button>
        {bad ? (
          <span className="text-[12px] text-destructive">
            Write a citation like “21 CFR 314.70” or “40 CFR part 60”.
          </span>
        ) : null}
      </form>
      {q.isLoading ? (
        <div
          className="h-48 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading"
        />
      ) : q.error ? (
        <ExternalError error={q.error} />
      ) : !q.data ? (
        <p className="text-[13px] text-muted-foreground">
          The full CFR text collection is not published yet.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[12px] text-muted-foreground">
            {q.data.upToDateAsOf.length
              ? `eCFR text up to date as of ${q.data.upToDateAsOf.join(", ")}. `
              : ""}
            {q.data.ready === false
              ? "The collection is still being loaded; some titles may be incomplete. "
              : ""}
            The eCFR is an authoritative but unofficial compilation; the official legal edition is
            the annual CFR.
          </p>
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.titles.map((t) => (
              <li key={t.title}>
                <Link
                  to="/law/cfr/$title"
                  params={{ title: t.title }}
                  className="flex h-full items-baseline gap-3 rounded-xl border border-border bg-card shadow-xs px-3 py-2 text-[13px] hover:bg-muted/50"
                >
                  <span className="w-8 shrink-0 font-semibold tabular-nums">{t.title}</span>
                  <span className="min-w-0 flex-1">{t.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {t.rows.toLocaleString("en-US")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Counts are sections, appendices and parts stored for each title.
          </p>
        </>
      )}
      <div id="cfr-atlas" className="mt-6 scroll-mt-16">
        <LawAtlas corpus="cfr" />
      </div>
      <div className="mt-4">
        <CfrAgencyIndex />
      </div>
    </AppShell>
  );
}
