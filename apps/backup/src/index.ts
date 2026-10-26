import { Encrypter } from "age-encryption";
import { dumpDatabase, gzip, sha256 } from "./dump";
import { github } from "./github";

/**
 * quemo-backup: every week (cron) it dumps all five Quemo D1 databases through their bindings,
 * gzips + encrypts each dump with age, and commits them to a private GitHub repo.
 * Weeks without data changes are skipped. Decrypt with the private key that never leaves your machine.
 */
export interface Env {
  AUTH_DB: D1Database;
  BUDGET_DB: D1Database;
  WORKOUT_DB: D1Database;
  HEALTH_DB: D1Database;
  FOOD_DB: D1Database;
  BACKUP_REPO: string; // owner/name of the private repo
  AGE_RECIPIENT: string; // age1… public key
  GITHUB_TOKEN: string; // fine-grained token: Contents read/write on BACKUP_REPO only
  RUN_TOKEN?: string; // optional: lets `npm run backup:run` trigger a backup over HTTPS
}

export const DATABASES = [
  ["quemo-auth", "AUTH_DB"],
  ["quemo-budget", "BUDGET_DB"],
  ["quemo-workout", "WORKOUT_DB"],
  ["quemo-health", "HEALTH_DB"],
  ["quemo-food", "FOOD_DB"],
] as const;

export interface BackupResult {
  committed: boolean;
  sha?: string;
  manifest: string;
}

export async function runBackup(env: Env, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<BackupResult> {
  if (!env.AGE_RECIPIENT?.startsWith("age1")) throw new Error("AGE_RECIPIENT is not set to an age public key");
  if (!env.GITHUB_TOKEN || !env.BACKUP_REPO) throw new Error("GITHUB_TOKEN and BACKUP_REPO are required");

  const files: Record<string, Uint8Array | string> = {};
  const lines: string[] = [];
  for (const [name, binding] of DATABASES) {
    const dump = await dumpDatabase(env[binding]);
    lines.push(`${name} tables=${dump.tables} rows=${dump.rows} sha256=${await sha256(dump.sql)}`);
    const enc = new Encrypter();
    enc.addRecipient(env.AGE_RECIPIENT);
    files[`snapshots/${name}.sql.gz.age`] = await enc.encrypt(await gzip(dump.sql));
  }
  const manifest = `${lines.join("\n")}\n`;

  const gh = github({ repo: env.BACKUP_REPO, token: env.GITHUB_TOKEN, fetch: fetchImpl });
  if ((await gh.readText("MANIFEST.txt")) === manifest) return { committed: false, manifest };
  files["MANIFEST.txt"] = manifest;
  const sha = await gh.commit(`backup ${now.toISOString().slice(0, 10)}`, files);
  return { committed: true, sha, manifest };
}

export default {
  // Awaited (not waitUntil) so a failure marks the cron run as failed in the Cloudflare dashboard.
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const r = await runBackup(env);
    console.log(r.committed ? `backup committed ${r.sha}` : "no changes since last backup");
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/run" && env.RUN_TOKEN && request.headers.get("Authorization") === `Bearer ${env.RUN_TOKEN}`) {
      try {
        return Response.json(await runBackup(env));
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
