/**
 * Dev-only fixture switch for screenshots before the insights data layer is live. On only when BOTH the Vite dev
 * server is running (`import.meta.env.DEV`, statically false in every production build, so the branch and the
 * fixture module it imports are removed from the bundle) AND the dev server was started with
 * `VITE_INSIGHTS_FIXTURES=1`. Production cannot enable it: there is no runtime flag, query parameter or storage key.
 */
export const INSIGHTS_FIXTURES: boolean =
  import.meta.env.DEV === true && import.meta.env["VITE_INSIGHTS_FIXTURES"] === "1";
