import { queryOptions } from "@tanstack/react-query";
import { getCourtPhoto, getCourtPhotoThumbs } from "@/lib/courts/photos.functions";

export const courtPhotoQuery = (courtId: string) =>
  queryOptions({
    queryKey: ["court-photo", courtId],
    queryFn: () => getCourtPhoto({ data: { id: courtId } }),
    staleTime: 30 * 60_000,
    retry: 1,
  });

export const courtPhotoThumbsQuery = queryOptions({
  queryKey: ["court-photo-thumbs"],
  queryFn: () => getCourtPhotoThumbs(),
  staleTime: 30 * 60_000,
  retry: 1,
});
