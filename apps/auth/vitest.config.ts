import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
        // Stand-ins for the tool Workers behind the gateway: echo which tool and path they received.
        workers: ["budget", "workout", "health", "food"].map((t) => ({
          name: `quemo-${t}`,
          modules: true,
          script: `export default { fetch(r) { return new Response("${t}:" + new URL(r.url).pathname) } }`,
          compatibilityDate: "2026-08-15",
        })),
      },
    }),
  ],
  test: { setupFiles: ["../../packages/core/test-support/setup.ts"] },
}));
