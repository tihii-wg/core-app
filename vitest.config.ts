import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the `@` alias from vite.config.ts / tsconfig.app.json (ui/alert, ui/badge import "@/lib/utils").
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/tests/setup.ts",
    exclude: [...configDefaults.exclude, "supabase/tests/**"],
    // Integration UI flows regularly exceed the 5s default under full-suite load.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Cap parallelism — full-suite contention otherwise flakes findBy/waitFor in jsdom.
    maxWorkers: 4,
  },
});
