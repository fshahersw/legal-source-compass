/**
 * Server function behind the FTC consumer-protection section of the Analytics overview. A failed read of every part
 * throws, so the section shows its error state with a retry; a failed part is listed in `unavailable` and the rest renders.
 */
import { createServerFn } from "@tanstack/react-start";
import { readFtcConsumerOverview, type FtcConsumerOverview } from "./ftcConsumer.server";

export type { FtcConsumerOverview } from "./ftcConsumer.server";

export const getFtcConsumerOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<FtcConsumerOverview> => {
    try {
      return await readFtcConsumerOverview();
    } catch (error) {
      console.error(
        `FTC consumer overview failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      throw new Error("This section could not be read.");
    }
  },
);
