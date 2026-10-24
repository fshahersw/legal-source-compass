/**
 * AI summary and Ask AI for one MDL, grounded in the figures the matter header shows: JPML action counts (the size of
 * the MDL, as of the report date) and the registry's partial counts (member-like dockets, docket entries, parties).
 * The registry counts are labelled partial so a summary never presents them as the size of the MDL.
 */
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { buildSectionContext, type FigureInput } from "@/components/kit/ai/buildSectionContext";
import { registryMetrics } from "@/lib/matters/registry";
import type { MatterOverviewPayload } from "@/lib/matters/types";

export function MatterAi({ payload }: { payload: MatterOverviewPayload }) {
  const o = payload.overview;
  const m = registryMetrics(payload.registry);
  const jpml = o.asOf ? `JPML report ${o.asOf}` : undefined;
  const figures: FigureInput[] = [
    { label: "JPML actions pending", value: o.actions.pending, unit: "actions", period: jpml },
    { label: "JPML actions in total (pending and closed)", value: o.actions.total, unit: "actions", period: jpml },
  ];
  if (m) {
    figures.push(
      {
        label: "Member-like dockets in the matter registry",
        value: m.dockets,
        unit: "dockets",
        note: "partial count, not the size of the MDL",
      },
      {
        label: "Master-docket entries captured",
        value: m.entries?.captured ?? null,
        unit: "entries",
        note:
          m.entries?.providerTotal != null
            ? `of ${m.entries.providerTotal.toLocaleString("en-US")} the provider reports`
            : undefined,
      },
      { label: "Parties on the master docket", value: m.parties?.published ?? null, unit: "parties" },
    );
  }
  if (figures.every((f) => f.value == null)) return null;
  const title = `MDL ${o.mdl}: headline figures`;
  const context = buildSectionContext({
    id: "matter-glance",
    title,
    scope: [o.title, o.court.shortName].filter(Boolean).join(" · "),
    source: m
      ? "Judicial Panel on Multidistrict Litigation; matter registry"
      : "Judicial Panel on Multidistrict Litigation",
    figures,
  });
  return (
    <AiSummary
      context={context}
      actions={
        <AskAiButton
          sectionId="matter-glance"
          title={title}
          context={context}
          questions={[
            "How large is this MDL, and is it growing?",
            "What do the registry counts cover, and what do they leave out?",
            "Where are the docket entries and documents for this MDL?",
          ]}
        />
      }
    />
  );
}
