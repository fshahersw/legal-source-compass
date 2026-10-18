/**
 * The registry of insight sections and sources. To add candidates for a section, write a pure generator in
 * `generators/` and a reader in `readers/`, then add ONE `defineSource(...)` line to that section below. To add a
 * section, add one entry to SECTIONS. A source whose dataset is missing or unreadable as published yields zero
 * candidates (the reader returns null); a source that throws only drops its own candidates.
 *
 * Datasets being published later this session (NEISS, SaferProducts, OSHA, settlements, federal-court workload)
 * are deliberately not read here: their shapes are not final, so no generator is written for them yet.
 */
import type { Insight } from "./types";
import { generateCourtInsights } from "./generators/court";
import {
  generateCfpbInsights,
  generateEpaInsights,
  generateRulemakingInsights,
} from "./generators/enforcement";
import { generateJudgeInsights } from "./generators/judge";
import { generateMdlInsights } from "./generators/mdl";
import { generatePaymentsInsights } from "./generators/payments";
import {
  generateCaersInsights,
  generateCpscInsights,
  generateFaersInsights,
  generateMaudeInsights,
  generateNhtsaInsights,
} from "./generators/safety";
import {
  generateCfpbStateInsights,
  generateEpaStateInsights,
  generateStateMetricInsights,
} from "./generators/state";
import { readCourtOverview } from "./readers/court";
import { readCfpb, readEpaNational, readRulemaking } from "./readers/enforcement";
import { readJudges } from "./readers/judge";
import { readMdl } from "./readers/mdl";
import { readPayments } from "./readers/payments";
import { readCaers, readCpsc, readFaers, readMaude, readNhtsa } from "./readers/safety";
import { readEpa } from "./readers/shared";
import { readStateMetrics } from "./readers/state";
import type { SectionMeta } from "./pipeline";

export type SourceDef = { id: string; run: () => Promise<Insight[]> };
export type SectionDef = SectionMeta & { sources: SourceDef[] };

/** One source: how to read a dataset (null when it is not published) and how to turn it into candidates. */
export function defineSource<D>(
  id: string,
  read: () => Promise<D | null>,
  generate: (data: D) => Insight[],
): SourceDef {
  return {
    id,
    run: async () => {
      const data = await read();
      return data == null ? [] : generate(data);
    },
  };
}

export const SECTIONS: readonly SectionDef[] = [
  {
    id: "state",
    title: "State analytics",
    href: "/places/analytics",
    chartsLabel: "Open state charts",
    sources: [
      defineSource("state.metrics", readStateMetrics, generateStateMetricInsights),
      defineSource("state.cfpb", readCfpb, generateCfpbStateInsights),
      defineSource("state.epa", readEpa, generateEpaStateInsights),
    ],
  },
  {
    id: "court",
    title: "Court analytics",
    href: "/courts/analytics",
    chartsLabel: "Open court charts",
    sources: [defineSource("court.federal", readCourtOverview, generateCourtInsights)],
  },
  {
    id: "judge",
    title: "Judge analytics",
    href: "/judges/analytics",
    chartsLabel: "Open judge charts",
    sources: [defineSource("judge.mdl", readJudges, generateJudgeInsights)],
  },
  {
    id: "mdl",
    title: "MDL and matter analytics",
    href: "/matters/analytics",
    chartsLabel: "Open MDL charts",
    sources: [defineSource("mdl.jpml", readMdl, generateMdlInsights)],
  },
  {
    id: "enforcement",
    title: "Enforcement",
    href: "/law/enforcement",
    chartsLabel: "Open enforcement charts",
    sources: [
      defineSource("enforcement.cfpb", readCfpb, generateCfpbInsights),
      defineSource("enforcement.epa", readEpaNational, generateEpaInsights),
      defineSource("enforcement.rulemaking", readRulemaking, generateRulemakingInsights),
    ],
  },
  {
    id: "safety",
    title: "Product safety",
    href: "/safety",
    chartsLabel: "Open product safety charts",
    sources: [
      defineSource("safety.faers", readFaers, generateFaersInsights),
      defineSource("safety.maude", readMaude, generateMaudeInsights),
      defineSource("safety.caers", readCaers, generateCaersInsights),
      defineSource("safety.cpsc", readCpsc, generateCpscInsights),
      defineSource("safety.nhtsa", readNhtsa, generateNhtsaInsights),
    ],
  },
  {
    id: "payments",
    title: "Industry payments",
    href: "/companies/payments",
    chartsLabel: "Open payments charts",
    sources: [defineSource("payments.openpayments", readPayments, generatePaymentsInsights)],
  },
];

export const SECTION_IDS: readonly string[] = SECTIONS.map((s) => s.id);
