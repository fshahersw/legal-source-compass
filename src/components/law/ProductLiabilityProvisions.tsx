/**
 * /law/codes/$state (in-force view): the sections of the state's code in force whose text mentions "product
 * liability", most relevant first, each with its exact citation and a link into the code browser. A full-text hit is
 * not a doctrine classification. The source line is the in-force edition's own publisher, link and currency.
 */
import { useQuery } from "@tanstack/react-query";
import {
  AiSummary,
  AskAiButton,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { searchStateLaw } from "@/lib/law/stateLaw.functions";
import { currencyLine, snippetSegments, type StateLawEdition } from "@/lib/law/stateLawContract";
import { PRODUCT_LIABILITY_QUERY } from "./lawQueries";
const ID = "product-liability-provisions";
const fmt = (v: number) => v.toLocaleString("en-US");

export function ProductLiabilityProvisions({
  state,
  stateName,
  edition,
  onOpen,
  onSeeAll,
}: {
  state: string;
  stateName: string;
  /** The in-force edition the code browser reads: its publisher, link and currency are this block's source. */
  edition: Pick<
    StateLawEdition,
    | "codeName"
    | "publisher"
    | "publisherUrl"
    | "currencyStatement"
    | "editionLabel"
    | "currencyThrough"
    | "sourceLastModified"
  >;
  onOpen: (sectionId: string) => void;
  onSeeAll: () => void;
}) {
  const q = useQuery({
    queryKey: ["law", "product-liability", state],
    queryFn: () =>
      searchStateLaw({
        data: { state, q: PRODUCT_LIABILITY_QUERY, offset: 0, status: "in_force" },
      }),
    staleTime: 30 * 60 * 1000,
  });
  const r = q.data;
  if (q.isError || !r || !r.available) return null;
  const hits = r.hits.slice(0, 12);
  const codes = new Set(r.hits.map((h) => h.code).filter(Boolean));
  const source = {
    label: `${edition.codeName}${edition.publisher ? `, ${edition.publisher}` : ""}`,
    href: edition.publisherUrl,
  };
  const currency = currencyLine(edition);
  const context = buildSectionContext({
    id: ID,
    title: `${stateName} code sections mentioning product liability`,
    scope: `${stateName} statutes in force; sections whose text mentions "product liability"`,
    period: currency,
    source: source.label,
    figures: [
      {
        label: "Sections in force mentioning product liability",
        value: r.totalCapped ? "over 10,000" : r.total,
      },
      ...hits
        .slice(0, 8)
        .map((h) => ({ label: h.citation, value: h.heading ?? "Heading not recorded" })),
    ],
  });
  return (
    <Section
      id={ID}
      className="mb-6"
      title="Product liability provisions"
      description={`Sections of the ${stateName} code in force whose text mentions “product liability”, most relevant first.`}
      actions={
        <AskAiButton
          sectionId={ID}
          title="Product liability provisions"
          context={context}
          size="icon"
        />
      }
    >
      <KpiGrid columns={4} label="Product liability provisions">
        <KpiCard
          as="li"
          size="sm"
          label="Sections mentioning it"
          value={r.totalCapped ? "Over 10,000" : fmt(r.total)}
          meta="In force, full-text match"
          source={{
            source,
            period: currency,
            about:
              "A text match on the section's words (English stemming), not a legal classification of the section.",
          }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Codes among the top hits"
          value={fmt(codes.size)}
          meta={`Top ${fmt(r.hits.length)} hits`}
          source={{ source, period: currency }}
        />
      </KpiGrid>
      {hits.length ? (
        <ol className="m-0 mt-3 list-none divide-y divide-border/70 rounded-xl border border-border bg-card p-0 shadow-xs">
          {hits.map((h) => (
            <li key={h.sectionId}>
              <button
                type="button"
                onClick={() => onOpen(h.sectionId)}
                className="block w-full px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="text-body font-medium text-primary">{h.citation}</span>
                {h.heading ? (
                  <span className="block text-meta text-foreground">{h.heading}</span>
                ) : null}
                {h.snippet ? (
                  <span className="mt-0.5 block text-meta leading-relaxed text-muted-foreground">
                    {snippetSegments(h.snippet).map((seg, i) =>
                      seg.hit ? (
                        <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={i}>{seg.text}</span>
                      ),
                    )}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-meta text-muted-foreground">
          No section in force contains the phrase “product liability”.
        </p>
      )}
      {r.total > hits.length ? (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-2 text-meta font-medium text-primary hover:underline"
        >
          See all {r.totalCapped ? "matches" : fmt(r.total)} in the code search
        </button>
      ) : null}
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
