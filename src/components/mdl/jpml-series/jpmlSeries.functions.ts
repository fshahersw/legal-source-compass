/** Server functions for the JPML statistics series panels (read-only). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MdlSeries, National } from "./model";
import { readMdlSeries, readNational } from "./jpmlSeries.server";

const fail = (what: string) => (e: unknown) => {
  console.error(`jpml series ${what}`, e);
  throw new Error(`The JPML ${what} could not be read just now.`);
};

export const getJpmlNational = createServerFn({ method: "GET" }).handler(
  (): Promise<National | null> => readNational().catch(fail("statistics series")),
);

export const getJpmlMdlSeries = createServerFn({ method: "GET" })
  .inputValidator((d: { mdl: number }) =>
    z.object({ mdl: z.number().int().min(1).max(99999) }).parse(d),
  )
  .handler(({ data }): Promise<MdlSeries | null> =>
    readMdlSeries(data.mdl).catch(fail("report series for this MDL")),
  );
