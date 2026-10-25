import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Shared vitest config for a tool Worker: real D1 with migrations + a stub quemo-auth service. */
export function toolTestConfig(appDir: string) {
  return defineConfig(async () => ({
    plugins: [
      cloudflareTest({
        wrangler: { configPath: `${appDir}/wrangler.jsonc` },
        miniflare: {
          bindings: { TEST_MIGRATIONS: await readD1Migrations(`${appDir}/migrations`) },
          workers: [
            {
              name: "quemo-auth",
              modulesRoot: fileURLToPath(new URL(".", import.meta.url)),
              modules: [{ type: "ESModule", path: fileURLToPath(new URL("./auth-stub.js", import.meta.url)) }],
              compatibilityDate: "2026-08-15",
            },
          ],
        },
      }),
    ],
    test: { setupFiles: [fileURLToPath(new URL("./setup.ts", import.meta.url))] },
  }));
}
