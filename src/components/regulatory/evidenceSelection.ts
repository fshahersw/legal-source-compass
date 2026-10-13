/** A deep-linked historical event must never silently display the latest evidence instead. */
export function selectEvidence<
  Event extends { id: string; payloadSha256: string; previousPayloadSha256: string | null },
  Version extends { payloadSha256: string },
>(
  detail: { events: Event[]; versions: Version[]; payloadSha256: string } | null | undefined,
  eventId: string | undefined,
  chosenHash: string | null,
) {
  const requestedEvent = eventId ? detail?.events.find((event) => event.id === eventId) : undefined;
  const hash =
    chosenHash ?? requestedEvent?.payloadSha256 ?? (!eventId ? detail?.payloadSha256 : undefined);
  const version = hash ? detail?.versions.find((item) => item.payloadSha256 === hash) : undefined;
  const event = hash
    ? detail?.events.find(
        (item) =>
          item.payloadSha256 === hash && (!eventId || chosenHash !== null || item.id === eventId),
      )
    : undefined;
  const previous = event?.previousPayloadSha256
    ? detail?.versions.find((item) => item.payloadSha256 === event.previousPayloadSha256)
    : undefined;
  return { hash, version, event, previous };
}
