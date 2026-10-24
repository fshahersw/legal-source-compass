/**
 * CSV for the data drawer's download: RFC 4180 quoting (a field with a comma, quote, CR or LF is quoted, quotes
 * doubled), CRLF line ends, a header row from the column labels. A missing value is an empty field, never 0, so a gap
 * stays a gap in the file. Leading =, +, - or @ in text is prefixed with an apostrophe so a spreadsheet never runs a
 * cell as a formula; numbers are written as numbers. Pure and tested (csv.test.ts).
 */

export type CsvValue = string | number | boolean | null | undefined;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** A safe file name: lower case, letters, digits and dashes, ending in .csv. */
export function csvFileName(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/\.csv$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "data";
  return `${base}.csv`;
}
