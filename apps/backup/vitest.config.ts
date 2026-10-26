import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const APPS = ["auth", "budget", "workout", "health", "food"];

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["RESTORE_DB"],
        bindings: Object.fromEntries(await Promise.all(APPS.map(async (a) => [`MIGRATIONS_${a.toUpperCase()}`, await readD1Migrations(`../${a}/migrations`)]))),
      },
    }),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
}));
