/** Court building photographs (dataset court_images) for the court pages and court lists. Read-only. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { COURT_ID, type CourtPhoto, type CourtPhotoThumb } from "./photos";
import { readCourtPhoto, readCourtPhotoThumbs } from "./photos.server";

export const getCourtPhoto = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(({ data }): Promise<CourtPhoto | null> => readCourtPhoto(data.id));

export const getCourtPhotoThumbs = createServerFn({ method: "GET" }).handler(
  (): Promise<Record<string, CourtPhotoThumb>> => readCourtPhotoThumbs(),
);
