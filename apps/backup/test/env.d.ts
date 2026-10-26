import type { D1Migration } from "cloudflare:test";
import type { Env as BackupEnv } from "../src/index";

declare global {
  namespace Cloudflare {
    interface Env extends BackupEnv {
      RESTORE_DB: D1Database;
      MIGRATIONS_AUTH: D1Migration[];
      MIGRATIONS_BUDGET: D1Migration[];
      MIGRATIONS_WORKOUT: D1Migration[];
      MIGRATIONS_HEALTH: D1Migration[];
      MIGRATIONS_FOOD: D1Migration[];
    }
  }
}
