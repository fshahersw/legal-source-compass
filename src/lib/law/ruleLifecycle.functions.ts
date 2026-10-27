/**
 * Proposal-to-final pace (law_rule_lifecycle_v1). The RPC is drafted for the lead; until it is applied this answers
 * null and the page shows nothing for it.
 */
import { createServerFn } from "@tanstack/react-start";
import { rpcPostOptional } from "@/lib/external/rest.server";
import { memoAsync } from "@/lib/insights/readers/cache";
import { parseRuleLifecycle, type RuleLifecycle } from "./ruleLifecycle";

const read = memoAsync(30 * 60 * 1000, async (): Promise<RuleLifecycle | null> => {
  const raw = await rpcPostOptional<unknown>("law_rule_lifecycle_v1", {});
  return raw === null ? null : parseRuleLifecycle(raw);
});

export const getRuleLifecycle = createServerFn({ method: "GET" }).handler(
  async (): Promise<RuleLifecycle | null> =>
    read().catch((e: unknown) => {
      console.error("rule lifecycle", e);
      return null;
    }),
);
