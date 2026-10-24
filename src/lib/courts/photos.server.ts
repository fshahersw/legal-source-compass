/**
 * Server-only reads of court building photographs (dataset court_images). One record per court id; a record that
 * fails validation is dropped (null), never repaired. Until the dataset is published the reads return nothing and
 * the pages show the seal-only header.
 */
import { restGet } from "@/lib/external/rest.server";
import {
  COURT_ID,
  parseCourtPhoto,
  toThumb,
  type CourtPhoto,
  type CourtPhotoThumb,
} from "./photos";

export const COURT_PHOTOS_DATASET = "court_images";
const LIST_LIMIT = 2000;

type Row = { id: string; p: unknown };

/**
 * Dev-only local build file, for screenshots before the lead publishes. On only when the Vite dev server runs
 * (`import.meta.env.DEV`, statically false in production builds, which drop this branch) AND the server was started
 * with COURT_PHOTOS_FIXTURE=1.
 */
async function fixtureRows(): Promise<Row[] | null> {
  if (!(import.meta.env.DEV && process.env["COURT_PHOTOS_FIXTURE"] === "1")) return null;
  const { readCourtPhotoFixture } = await import("./photos.fixture.server");
  return readCourtPhotoFixture();
}

export async function readCourtPhoto(id: string): Promise<CourtPhoto | null> {
  if (!COURT_ID.test(id)) return null;
  const fixture = await fixtureRows();
  const rows =
    fixture?.filter((r) => r.id === id) ??
    (
      await restGet<Row[]>(
        `corpus_records?select=id,p:item->photo&dataset=eq.${COURT_PHOTOS_DATASET}&id=eq.${id}&limit=1`,
      )
    ).rows;
  return rows.length === 1 && rows[0]!.id === id ? parseCourtPhoto(rows[0]!.p, id) : null;
}

export async function readCourtPhotoThumbs(): Promise<Record<string, CourtPhotoThumb>> {
  const rows =
    (await fixtureRows()) ??
    (
      await restGet<Row[]>(
        `corpus_records?select=id,p:item->photo&dataset=eq.${COURT_PHOTOS_DATASET}&order=id&limit=${LIST_LIMIT}`,
      )
    ).rows;
  const out: Record<string, CourtPhotoThumb> = {};
  for (const row of rows) {
    if (typeof row.id !== "string" || !COURT_ID.test(row.id)) continue;
    const photo = parseCourtPhoto(row.p, row.id);
    if (photo) out[row.id] = toThumb(photo);
  }
  return out;
}
