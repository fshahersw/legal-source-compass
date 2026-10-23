import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { stateLawSearch, stateLawSection, stateLawStates, stateLawTree } from "./stateLaw.server";
import { NODE_ID_MAX, SECTION_ID_MAX, STATE_LAW_STATUSES } from "./stateLawContract";

const state = z.string().regex(/^[A-Z]{2}$/);

/** Active in-force editions (one per state) with their currency statements. */
export const listStateLawEditions = createServerFn({ method: "GET" }).handler(async () =>
  stateLawStates(),
);

export const getStateLawTree = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({
        state,
        node: z.string().min(4).max(NODE_ID_MAX).nullable(),
        offset: z.number().int().min(0).max(100_000).default(0),
      })
      .parse(data),
  )
  .handler(async ({ data }) => stateLawTree(data.state, data.node, data.offset));

export const getStateLawSection = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ state, id: z.string().min(5).max(SECTION_ID_MAX) }).parse(data),
  )
  .handler(async ({ data }) => stateLawSection(data.state, data.id));

export const searchStateLaw = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({
        state,
        q: z.string().trim().min(2).max(200),
        offset: z.number().int().min(0).max(1000).default(0),
        status: z.enum(STATE_LAW_STATUSES).nullable().default(null),
      })
      .parse(data),
  )
  .handler(async ({ data }) => stateLawSearch(data.state, data.q, data.offset, data.status));
