import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { RECORD_ID_MAX_LENGTH } from "@/lib/external/recordIdentity";
import {
  listFullStateCodes,
  projectedOutline,
  searchFullStateCodes,
  stateCodeChapters,
  stateCodeCoverage,
  stateCodeSection,
  stateCodeSectionList,
  stateCodeTitles,
} from "./stateCodeCatalog.server";
import type { HierarchyStep } from "./stateCodeContract";

export type { SectionFields, StateCodeHit, StateCodeListing } from "./stateCodeContract";

const stateCode = z.string().regex(/^[A-Z]{2}$/);

/** States that currently have a full code: snapshot bundles and ready section datasets. */
export const listStateCodes = createServerFn({ method: "GET" }).handler(async () =>
  listFullStateCodes(),
);

export const getStateCodeTitles = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ state: stateCode }).parse(data))
  .handler(async ({ data }) => stateCodeTitles(data.state));

export const getStateCodeChapters = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ state: stateCode, title: z.string().min(1).max(200) }).parse(data),
  )
  .handler(async ({ data }) => stateCodeChapters(data.state, data.title));

export const getStateCodeSectionList = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({ state: stateCode, title: z.string().min(1).max(200), chapter: z.string().max(400) })
      .parse(data),
  )
  .handler(async ({ data }) => stateCodeSectionList(data.state, data.title, data.chapter));

export const getStateCodeSection = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ state: stateCode, id: z.string().min(1).max(RECORD_ID_MAX_LENGTH) }).parse(data),
  )
  .handler(async ({ data }) => stateCodeSection(data.state, data.id));

const step = z.object({
  level: z.string().regex(/^[a-z][a-z_]{1,40}$/),
  number: z.string().max(300).nullable(),
});

export const getProjectedOutline = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ state: stateCode, path: z.array(step).max(12) }).parse(data),
  )
  .handler(async ({ data }) => projectedOutline(data.state, data.path as HierarchyStep[]));

export const getStateCodeCoverage = createServerFn({ method: "GET" }).handler(async () =>
  stateCodeCoverage(),
);

export const searchStateCodes = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ q: z.string().trim().min(2).max(120), state: stateCode.optional() }).parse(data),
  )
  .handler(async ({ data }) => searchFullStateCodes(data.q, data.state));
