import { applyD1Migrations, env } from "cloudflare:test";

for (const app of ["AUTH", "BUDGET", "WORKOUT", "HEALTH", "FOOD"] as const) {
  await applyD1Migrations(env[`${app}_DB`], env[`MIGRATIONS_${app}`]);
}
