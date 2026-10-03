import { z } from "zod";
import { EntityType } from "./schema.ts";
const reportShape = z.object({
  passed: z.boolean(), regressions: z.array(z.string()),
  counts_by_type: z.record(z.object({ total: z.number().int().nonnegative(), invalid: z.number().int().nonnegative() })),
});
export function assertDeployReport(value: unknown) {
  const parsed = reportShape.safeParse(value);
  if (!parsed.success) throw Error("Legal corpus deployment gate has no valid report");
  const report = parsed.data;
  if (!report.passed || report.regressions.length) throw Error(`Legal corpus deployment gate failed: ${report.regressions.join("; ")}`);
  for (const type of [...EntityType.options, "unrecognized"]) {
    const counts = report.counts_by_type[type];
    if (!counts || counts.invalid > counts.total) throw Error(`Legal corpus deployment gate has no valid count for ${type}`);
  }
  return report;
}
