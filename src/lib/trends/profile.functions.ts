/**
 * Server function behind the profile trend cards: `getProfileTrend({ data: { kind, key } })` returns one card's trend,
 * or an explicit "empty" result when the corpus holds nothing to plot for that profile. A failed read throws, so the
 * page shows that card's error state with a retry while the other cards stay on screen. Read-only; cached on the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isProfileKey, PROFILE_KIND_IDS, type ProfileTrendResult } from "./profile";
import { EMPTY_REASON, readProfileTrend } from "./profile.server";

export const getProfileTrend = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({ kind: z.enum(PROFILE_KIND_IDS), key: z.string().min(1).max(40) })
      .refine((v) => isProfileKey(v.kind, v.key), { message: "Unknown profile key" })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ProfileTrendResult> => {
    try {
      const block = await readProfileTrend(data.kind, data.key);
      return block
        ? { status: "ok", data: block }
        : { status: "empty", reason: EMPTY_REASON[data.kind] };
    } catch (error) {
      console.error(
        `Profile trend ${data.kind} ${data.key} failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      throw new Error("This card could not be read.");
    }
  });
