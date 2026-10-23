/**
 * Server function behind the Analytics overview: `getAnalyticsBlock({ data: { id } })` returns one block's trend,
 * or an explicit "empty" result when its dataset holds nothing usable. A failed read throws, so the page shows that
 * block's error state with a retry while the other blocks stay on screen. Read-only; results are cached on the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BLOCK_IDS } from "./registry";
import { readBlock } from "./overview.server";
import type { AnalyticsBlockResult } from "./trend";

export const getAnalyticsBlock = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.enum(BLOCK_IDS) }).parse(d))
  .handler(async ({ data }): Promise<AnalyticsBlockResult> => {
    try {
      const block = await readBlock(data.id);
      return block
        ? { status: "ok", id: data.id, data: block }
        : { status: "empty", id: data.id, reason: "The published data for this block is empty." };
    } catch (error) {
      console.error(
        `Analytics block ${data.id} failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      throw new Error("This block could not be read.");
    }
  });
