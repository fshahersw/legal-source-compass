/**
 * Visual stories reads (database/contracts/visual-stories-v1.sql, mdl-atlas-v1.sql): the JPML pending-docket frames,
 * the defendant network and the MDL atlas (every MDL and district per report). Read-only, parsed server-side, cached for 10 minutes; a missing function returns null ("not published").
 */
import { createServerFn } from "@tanstack/react-start";
import { rpcPostOptional } from "./rest.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  parseDocket,
  parseNetwork,
  type Docket,
  type Network,
} from "@/components/stories/storiesModel";
import { parseAtlas, type Atlas } from "@/components/stories/atlasModel";

class NotPublished extends Error {}

const readDocket = memoAsync(READ_TTL_MS, async (): Promise<Docket> => {
  const raw = await rpcPostOptional<unknown>("corpus_mdl_docket_v1", { p_min_peak: 300 });
  if (raw === null) throw new NotPublished();
  return parseDocket(raw);
});

const readNetwork = memoAsync(READ_TTL_MS, async (): Promise<Network> => {
  const raw = await rpcPostOptional<unknown>("corpus_defendant_network_v1", {});
  if (raw === null) throw new NotPublished();
  return parseNetwork(raw);
});

export const getMdlDocket = createServerFn({ method: "GET" }).handler(
  async (): Promise<Docket | null> => {
    try {
      return await readDocket();
    } catch (error) {
      if (error instanceof NotPublished) return null;
      throw error;
    }
  },
);

export const getDefendantNetwork = createServerFn({ method: "GET" }).handler(
  async (): Promise<Network | null> => {
    try {
      return await readNetwork();
    } catch (error) {
      if (error instanceof NotPublished) return null;
      throw error;
    }
  },
);

const readAtlas = memoAsync(READ_TTL_MS, async (): Promise<Atlas> => {
  const raw = await rpcPostOptional<unknown>("corpus_mdl_atlas_v1", {});
  if (raw === null) throw new NotPublished();
  return parseAtlas(raw);
});

export const getMdlAtlas = createServerFn({ method: "GET" }).handler(
  async (): Promise<Atlas | null> => {
    try {
      return await readAtlas();
    } catch (error) {
      if (error instanceof NotPublished) return null;
      throw error;
    }
  },
);
