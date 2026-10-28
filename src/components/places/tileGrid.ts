/**
 * Equal-area tile layout for the 50 states and DC: every state is the same size, so Rhode Island, Delaware and DC are
 * as readable as Texas. Positions follow the common newsroom grid (11 columns × 8 rows) and only approximate
 * geography; the geographic map stays the default view. Pure and client-safe.
 */
export type TilePos = { usps: string; col: number; row: number };

export const TILE_COLS = 11;
export const TILE_ROWS = 8;

const ROWS: readonly (readonly [string, number][])[] = [
  [
    ["AK", 0],
    ["ME", 10],
  ],
  [
    ["WI", 5],
    ["VT", 9],
    ["NH", 10],
  ],
  [
    ["WA", 0],
    ["ID", 1],
    ["MT", 2],
    ["ND", 3],
    ["MN", 4],
    ["IL", 5],
    ["MI", 6],
    ["NY", 8],
    ["MA", 9],
  ],
  [
    ["OR", 0],
    ["NV", 1],
    ["WY", 2],
    ["SD", 3],
    ["IA", 4],
    ["IN", 5],
    ["OH", 6],
    ["PA", 7],
    ["NJ", 8],
    ["CT", 9],
    ["RI", 10],
  ],
  [
    ["CA", 0],
    ["UT", 1],
    ["CO", 2],
    ["NE", 3],
    ["MO", 4],
    ["KY", 5],
    ["WV", 6],
    ["VA", 7],
    ["MD", 8],
    ["DE", 9],
  ],
  [
    ["AZ", 1],
    ["NM", 2],
    ["KS", 3],
    ["AR", 4],
    ["TN", 5],
    ["NC", 6],
    ["SC", 7],
    ["DC", 8],
  ],
  [
    ["OK", 3],
    ["LA", 4],
    ["MS", 5],
    ["AL", 6],
    ["GA", 7],
  ],
  [
    ["HI", 0],
    ["TX", 3],
    ["FL", 8],
  ],
];

export const TILE_GRID: readonly TilePos[] = ROWS.flatMap((cells, row) =>
  cells.map(([usps, col]) => ({ usps, col, row })),
);

export const TILE_BY_USPS = new Map(TILE_GRID.map((t) => [t.usps, t]));

/** Which label ink a tile takes (`--map-ink-low` / `--map-ink-high`): the high ink from the middle of the ramp up. */
export const tileInk = (shade: number | null): "low" | "high" | "none" =>
  shade == null ? "none" : shade >= 50 ? "high" : "low";
