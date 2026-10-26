import { env, SELF } from "cloudflare:test";
import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { beforeAll, describe, expect, it } from "vitest";
import { gunzip } from "../src/dump";
import { DATABASES, runBackup, type Env } from "../src/index";

/** In-memory stand-in for the GitHub API pieces the backup uses. */
function fakeGitHub() {
  const files = new Map<string, Uint8Array | string>();
  const commits: { message: string; paths: string[] }[] = [];
  const blobs = new Map<string, Uint8Array | string>();
  let head = "c0";
  let n = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/repos\/me\/quemo-backups/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (!String((init?.headers as Record<string, string>)?.Authorization).includes("gh-token")) return json({ message: "Bad credentials" }, 401);
    if (method === "GET" && path.startsWith("/contents/")) {
      const f = files.get(path.slice("/contents/".length));
      return f === undefined ? new Response("", { status: 404 }) : new Response(f);
    }
    if (method === "GET" && path === "/git/ref/heads/main") return json({ object: { sha: head } });
    if (method === "GET" && path.startsWith("/git/commits/")) return json({ tree: { sha: `t-${head}` } });
    if (method === "POST" && path === "/git/blobs") {
      const sha = `b${++n}`;
      blobs.set(sha, body.encoding === "base64" ? Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)) : body.content);
      return json({ sha }, 201);
    }
    if (method === "POST" && path === "/git/trees") {
      for (const e of body.tree) files.set(e.path, blobs.get(e.sha)!);
      return json({ sha: `t${++n}`, paths: body.tree.map((e: { path: string }) => e.path) }, 201);
    }
    if (method === "POST" && path === "/git/commits") {
      commits.push({ message: body.message, paths: [] });
      return json({ sha: `c${++n}` }, 201);
    }
    if (method === "PATCH" && path === "/git/refs/heads/main") {
      head = body.sha;
      return json({ ref: "refs/heads/main" });
    }
    return json({ message: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, files, commits };
}

/** Splits a dump into statements, respecting quoted strings (values may contain ; and newlines). */
function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    cur += c;
    if (c === "'") inStr = !inStr;
    else if (c === ";" && !inStr) {
      if (cur.trim() !== ";") out.push(cur.trim());
      cur = "";
    }
  }
  return out;
}

let identity: string;
let backupEnv: Env;
const decrypt = async (bytes: Uint8Array) => {
  const d = new Decrypter();
  d.addIdentity(identity);
  return gunzip(await d.decrypt(bytes));
};

beforeAll(async () => {
  identity = await generateX25519Identity();
  backupEnv = { ...env, AGE_RECIPIENT: await identityToRecipient(identity), GITHUB_TOKEN: "gh-token", BACKUP_REPO: "me/quemo-backups" };
  await env.AUTH_DB.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'rider@quemo.test', 1)").run();
  await env.BUDGET_DB.batch([
    env.BUDGET_DB.prepare("INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('c1', 'u1', 'Café ☕', 'expense', 1)"),
    env.BUDGET_DB.prepare(
      "INSERT INTO transactions (id, user_id, kind, amount_cents, category_id, description, occurred_on, created_at) VALUES ('t1', 'u1', 'expense', 1250, 'c1', ?, '2026-10-26', 2)",
    ).bind("it's; tricky\nmultiline 'quotes'"),
    env.BUDGET_DB.prepare(
      "INSERT INTO transactions (id, user_id, kind, amount_cents, category_id, description, occurred_on, created_at) VALUES ('t2', 'u1', 'income', 300000, NULL, NULL, '2026-10-25', 3)",
    ),
  ]);
});

describe("weekly backup", () => {
  it("encrypts every database and commits them in one commit", async () => {
    const gh = fakeGitHub();
    const r = await runBackup(backupEnv, gh.impl, new Date("2026-10-26T02:30:00Z"));
    expect(r.committed).toBe(true);
    expect(gh.commits).toEqual([{ message: "backup 2026-10-26", paths: [] }]);
    expect([...gh.files.keys()].sort()).toEqual([...DATABASES.map(([n]) => `snapshots/${n}.sql.gz.age`), "MANIFEST.txt"].sort());
    expect(r.manifest).toMatch(/^quemo-budget tables=\d+ rows=\d+ sha256=[0-9a-f]{64}$/m);

    const cipher = gh.files.get("snapshots/quemo-budget.sql.gz.age") as Uint8Array;
    expect(new TextDecoder().decode(cipher.slice(0, 21))).toBe("age-encryption.org/v1");
    expect(new TextDecoder().decode(cipher)).not.toContain("tricky");
  });

  it("produces dumps that restore exactly into an empty database", async () => {
    const gh = fakeGitHub();
    await runBackup(backupEnv, gh.impl);
    const sql = await decrypt(gh.files.get("snapshots/quemo-budget.sql.gz.age") as Uint8Array);
    expect(sql).toContain("CREATE TABLE transactions");
    await env.RESTORE_DB.batch(statements(sql).map((s) => env.RESTORE_DB.prepare(s)));
    const rows = await env.RESTORE_DB.prepare("SELECT id, amount_cents, description, category_id FROM transactions ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: "t1", amount_cents: 1250, description: "it's; tricky\nmultiline 'quotes'", category_id: "c1" },
      { id: "t2", amount_cents: 300000, description: null, category_id: null },
    ]);
    expect(await env.RESTORE_DB.prepare("SELECT name FROM categories").first("name")).toBe("Café ☕");
    const idx = await env.RESTORE_DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_tx_user_date'").first("n");
    expect(idx).toBe(1);
  });

  it("skips the commit when nothing changed, and commits again after a change", async () => {
    const gh = fakeGitHub();
    expect((await runBackup(backupEnv, gh.impl)).committed).toBe(true);
    expect((await runBackup(backupEnv, gh.impl)).committed).toBe(false);
    await env.FOOD_DB.prepare("INSERT INTO water_logs (id, user_id, date, time, amount_ml, created_at) VALUES ('w1', 'u1', '2026-10-26', '10:00', 500, 1)").run();
    expect((await runBackup(backupEnv, gh.impl)).committed).toBe(true);
    expect(gh.commits).toHaveLength(2);
  });

  it("refuses to run without an encryption key or GitHub access", async () => {
    await expect(runBackup({ ...backupEnv, AGE_RECIPIENT: "" }, fakeGitHub().impl)).rejects.toThrow(/AGE_RECIPIENT/);
    await expect(runBackup({ ...backupEnv, GITHUB_TOKEN: "wrong" }, fakeGitHub().impl)).rejects.toThrow(/401/);
  });

  it("only exposes a token-protected manual trigger over HTTP", async () => {
    expect((await SELF.fetch("https://backup.test/")).status).toBe(404);
    expect((await SELF.fetch("https://backup.test/run", { method: "POST" })).status).toBe(404);
    expect((await SELF.fetch("https://backup.test/run", { method: "POST", headers: { Authorization: "Bearer guess" } })).status).toBe(404);
  });
});
