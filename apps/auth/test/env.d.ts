import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      OAUTH_KV: KVNamespace;
      PUBLIC_URL: string;
      BUDGET_URL: string;
      WORKOUT_URL: string;
      HEALTH_URL: string;
      FOOD_URL: string;
      EMAIL_FROM: string;
      TEST_MIGRATIONS: D1Migration[];
      BUDGET_SVC: Fetcher;
      WORKOUT_SVC: Fetcher;
      HEALTH_SVC: Fetcher;
      FOOD_SVC: Fetcher;
    }
  }
}
