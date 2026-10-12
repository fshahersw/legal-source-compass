import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { privateVitestFiles } from "./scripts/test/private-vitest-files";

// This suite deliberately fails if its protected fixtures are missing. Never substitute generated legal rows.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: privateVitestFiles,
    passWithNoTests: false,
  },
});
