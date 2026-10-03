import { z } from "zod";

export const DIRECTORY_PAGE_SIZE = 500;
export const directoryPageInput = z.object({
  offset: z.number().int().min(0).max(100000).multipleOf(DIRECTORY_PAGE_SIZE).default(0),
});
export type DirectoryPage<T> = { rows: T[]; nextOffset: number | null; pageSize: number };

/** Preserve the folder view's existing array contract, while every network response stays bounded. */
export async function collectDirectoryPages<T>(
  page: (options: { data: { offset: number } }) => Promise<DirectoryPage<T>>,
  maxRows: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let base = 0; base < maxRows; base += DIRECTORY_PAGE_SIZE * 6) {
    const pages = await Promise.all(
      Array.from(
        { length: Math.min(6, Math.ceil((maxRows - base) / DIRECTORY_PAGE_SIZE)) },
        (_, index) => page({ data: { offset: base + index * DIRECTORY_PAGE_SIZE } }),
      ),
    );
    for (const result of pages) {
      out.push(...result.rows);
      if (result.nextOffset === null) return out;
    }
  }
  throw new Error(
    "This directory exceeds the folder view's limit. Use the paginated data browser.",
  );
}
