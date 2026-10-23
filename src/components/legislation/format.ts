export const NR = "Not recorded";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-05-16" -> "May 16, 2024"; anything else -> "Not recorded". */
export function fmtDay(d: string | null | undefined): string {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null;
  if (!m) return NR;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export const fmtN = (n: number | null | undefined) => (n == null ? NR : n.toLocaleString("en-US"));
