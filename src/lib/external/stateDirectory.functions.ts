import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canonicalState } from "@/lib/corpus/stateHub";
import { directoryPageInput, type DirectoryPage } from "./directoryPaging";
import type { CourtRow, JudgeRow } from "./directoryTree";
import { readStateDirectoryPage } from "./stateDirectory.reads.server";
const input = directoryPageInput.extend({
  state: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase())
    .refine((s) => !!canonicalState(s), "Unknown state"),
});
export const listStateCourtDirectoryPage = createServerFn({ method: "GET" })
  .inputValidator((data) => input.parse(data))
  .handler(
    async ({ data }): Promise<DirectoryPage<CourtRow>> =>
      readStateDirectoryPage("court_spine", data.state, data.offset) as Promise<
        DirectoryPage<CourtRow>
      >,
  );
export const listStateJudgeDirectoryPage = createServerFn({ method: "GET" })
  .inputValidator((data) => input.parse(data))
  .handler(
    async ({ data }): Promise<DirectoryPage<JudgeRow>> =>
      readStateDirectoryPage("judges", data.state, data.offset) as Promise<DirectoryPage<JudgeRow>>,
  );
/** Most state directories fit one bounded response. Fetch more only when the server says to. */
async function collectState<T extends { id: string }>(
  read: (offset: number) => Promise<DirectoryPage<T>>,
  max: number,
): Promise<T[]> {
  const rows: T[] = [],
    ids = new Set<string>();
  let offset = 0;
  while (offset < max) {
    const page = await read(offset);
    for (const row of page.rows) {
      if (ids.has(row.id)) throw new Error("Directory changed while loading; retry to refresh.");
      ids.add(row.id);
      rows.push(row);
    }
    if (page.nextOffset === null) return rows;
    if (page.nextOffset <= offset || page.nextOffset > offset + 500)
      throw new Error("Invalid directory continuation.");
    offset = page.nextOffset;
  }
  throw new Error("This state directory exceeds the available page limit.");
}
export const listStateCourtDirectory = (state: string) =>
  collectState((offset) => listStateCourtDirectoryPage({ data: { state, offset } }), 20000);
export const listStateJudgeDirectory = (state: string) =>
  collectState((offset) => listStateJudgeDirectoryPage({ data: { state, offset } }), 40000);
