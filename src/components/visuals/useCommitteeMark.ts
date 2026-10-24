import { useQuery } from "@tanstack/react-query";
import { COMMITTEE_CODE } from "@/lib/external/congressMembers";
import { useImageFailed } from "./failedImages";
import { committeeMarkQuery } from "./queries";

/** The committee's recorded mark (dataset committee_marks), or null. */
export function useMark(code: string) {
  const valid = COMMITTEE_CODE.test(code);
  const q = useQuery({ ...committeeMarkQuery(code), enabled: valid });
  return valid ? (q.data ?? null) : null;
}

/**
 * True when the committee has a recorded mark that has not failed to load, so the page passes an emblem to the
 * header only then (an empty emblem slot would still take space).
 */
export function useCommitteeMarkShown(code: string): boolean {
  const mark = useMark(code);
  const failed = useImageFailed(mark?.url);
  return !!mark && !failed;
}
