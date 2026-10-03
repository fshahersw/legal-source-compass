import { createServerFn } from "@tanstack/react-start";
import type { CourtRow, JudgeRow } from "./directoryTree";
import { collectDirectoryPages, directoryPageInput, type DirectoryPage } from "./directoryPaging";
import { readDirectoryPage } from "./directory.reads.server";

/** Authenticated 500-row pages; no HTTP endpoint returns the entire directory. */
export const listCourtDirectoryPage = createServerFn({ method: "GET" })
  .inputValidator((data) => directoryPageInput.parse(data))
  .handler(
    async ({ data }): Promise<DirectoryPage<CourtRow>> =>
      readDirectoryPage("court_spine", data.offset) as Promise<DirectoryPage<CourtRow>>,
  );

export const listJudgeDirectoryPage = createServerFn({ method: "GET" })
  .inputValidator((data) => directoryPageInput.parse(data))
  .handler(
    async ({ data }): Promise<DirectoryPage<JudgeRow>> =>
      readDirectoryPage("judges", data.offset) as Promise<DirectoryPage<JudgeRow>>,
  );

export const listCourtDirectory = (): Promise<CourtRow[]> =>
  collectDirectoryPages(listCourtDirectoryPage, 20000);
export const listJudgeDirectory = (): Promise<JudgeRow[]> =>
  collectDirectoryPages(listJudgeDirectoryPage, 40000);
