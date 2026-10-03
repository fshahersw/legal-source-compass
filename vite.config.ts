// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  vite: {
    server: {
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/private/**"] },
    },
    plugins: [{
      name: "atlas-private-data-boundary",
      buildStart() {
        if (existsSync(resolve("public/data"))) throw new Error("Atlas data must stay in private/data and use the authenticated snapshot API.");
      },
    }],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
