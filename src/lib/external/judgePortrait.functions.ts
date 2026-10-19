/** The public-domain portrait for a judge page, when the judge is linked to a CourtListener person who has one. Read-only. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { portraitForJudge, type JudgePortrait } from "@/lib/judges/portraits.server";

export type { JudgePortrait };

export const getJudgePortrait = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({ id: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/) })
      .strict()
      .parse(data),
  )
  .handler(async ({ data }): Promise<JudgePortrait | null> => portraitForJudge(data.id));
