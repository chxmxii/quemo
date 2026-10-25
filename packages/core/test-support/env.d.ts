import type { D1Migration } from "cloudflare:test";
import type { AuthService } from "../src/types";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      AUTH: AuthService;
      PUBLIC_URL: string;
      AUTH_URL: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
