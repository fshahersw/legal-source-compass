/**
 * Where a dropdown panel sits relative to its trigger. The panel starts at the trigger's left edge; when that would
 * push it past the window it moves left just enough to keep `edge` px inside, and when it is wider than the window it
 * starts at `edge`. Returns the horizontal offset in px to apply to the panel (0 = aligned with the trigger).
 */
export function panelOffset({
  triggerLeft,
  windowWidth,
  panelWidth,
  edge = 16,
}: {
  triggerLeft: number;
  windowWidth: number;
  panelWidth: number;
  edge?: number;
}): number {
  const furthestLeft = Math.max(edge, windowWidth - edge - panelWidth);
  const left = Math.min(Math.max(triggerLeft, edge), furthestLeft);
  return Math.round(left - triggerLeft);
}
