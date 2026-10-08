import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { RECORD_ID_MAX_LENGTH } from "@/lib/external/recordIdentity";
import type { SectionRuleLink } from "./sectionRules";

export type { SectionRuleLink } from "./sectionRules";

/** Time Limits rules that cite one full-code section (exact citation or recorded code-capture match). */
export const getLimitationRulesForSection = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({
        state: z.string().regex(/^[A-Z]{2}$/),
        nativeId: z.string().min(1).max(RECORD_ID_MAX_LENGTH),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ rules: SectionRuleLink[]; ruleVersion: string }> => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { requireCorpusAccess } = await import("@/lib/auth/access.server");
    await requireCorpusAccess(getRequest());
    setResponseHeader("Cache-Control", "private, no-store");
    const { loadLimitationsServer } = await import("./sectionRules.server");
    const { rulesCitingSection } = await import("./sectionRules");
    const snapshot = await loadLimitationsServer();
    return {
      rules: rulesCitingSection(snapshot, data.state, data.nativeId),
      ruleVersion: snapshot.ruleVersion,
    };
  });
