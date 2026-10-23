/**
 * Life expectancy lookup in the NCHS United States life tables (econ_nchs_life_tables). Pure.
 *
 * The tables are period life tables with single-year age intervals "0-1" … "99-100" and an open "100 and over" row.
 * The lookup reads the row of the person's age at last birthday (completed years) and returns e(x) as stored in the
 * NCHS workbook, the one-decimal figure the report prints, and the age that implies (x + e(x)). Nothing is
 * interpolated between ages or years; a table year or group NCHS did not publish is "Not recorded".
 */
import type { MethodStep } from "./types";

export const LIFE_GROUPS = {
  total: "Total population",
  hispanic: "Hispanic",
  nh_white: "Non-Hispanic White",
  nh_black: "Non-Hispanic Black",
  nh_asian: "Non-Hispanic Asian",
  nh_aian: "Non-Hispanic American Indian and Alaska Native",
} as const;
export type LifeGroup = keyof typeof LIFE_GROUPS;
export const LIFE_SEXES = { total: "Both sexes", male: "Male", female: "Female" } as const;
export type LifeSex = keyof typeof LIFE_SEXES;

export type LifeTable = {
  year: number;
  report: string;
  reportUrl: string;
  table: number;
  title: string;
  group: LifeGroup;
  sex: LifeSex;
  /** [age, qx, lx, dx, Lx, Tx, ex] as stored. */
  rows: string[][];
  sourceUrl: string;
};

export type LifeResult =
  | {
      ok: true;
      table: LifeTable;
      age: number;
      ageRow: string;
      ex: string;
      exDisplay: string;
      expectedAge: number;
      lx: string;
      qx: string;
      method: MethodStep[];
    }
  | { ok: false; reason: string };

/** e(x) rounded half up to one decimal, from the stored text (decimal arithmetic on the digits, no float drift). */
export function oneDecimal(v: string): string {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(v.trim());
  if (!m) return v;
  const intPart = m[1]!;
  const frac = (m[2] ?? "").padEnd(2, "0");
  let tenths = Number(intPart) * 10 + Number(frac[0]);
  if (Number(frac[1]) >= 5) tenths += 1;
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function rowForAge(rows: string[][], age: number): string[] | null {
  if (!Number.isInteger(age) || age < 0) return null;
  const open = rows.at(-1);
  const openStart = open
    ? Number(/^(\d+) and (?:over|older)$/.exec(open[0] ?? "")?.[1] ?? NaN)
    : NaN;
  if (Number.isFinite(openStart) && age >= openStart) return open!;
  return rows.find((r) => r[0] === `${age}-${age + 1}`) ?? null;
}

export function lifeExpectancy(table: LifeTable | null, age: number): LifeResult {
  if (!table)
    return {
      ok: false,
      reason: "Not recorded: NCHS did not publish a table for that year and group.",
    };
  if (!Number.isInteger(age) || age < 0 || age > 120)
    return { ok: false, reason: "Enter the age at last birthday as a whole number from 0 to 120." };
  const row = rowForAge(table.rows, age);
  if (!row) return { ok: false, reason: `Not recorded: the table has no row for age ${age}.` };
  const ex = row[6]!;
  return {
    ok: true,
    table,
    age,
    ageRow: row[0]!,
    ex,
    exDisplay: oneDecimal(ex),
    expectedAge: age + Number(ex),
    lx: row[2]!,
    qx: row[1]!,
    method: [
      {
        label: "Table",
        detail: `${table.title} (${table.report}, Table ${table.table}).`,
      },
      {
        label: "Row",
        detail: `Age interval ${row[0]} (age at last birthday ${age}); e(x) as stored in the NCHS workbook is ${ex}, printed in the report as ${oneDecimal(ex)}.`,
      },
      {
        label: "Reading",
        detail:
          "A period life table: the average remaining years for a person of this age if the mortality rates of the table year held for the rest of their life. It is not a forecast for an individual.",
      },
    ],
  };
}
