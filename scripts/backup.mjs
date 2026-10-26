#!/usr/bin/env node
// Encrypted weekly backups of every Quemo D1 database into a private GitHub repo.
// The backups run ON CLOUDFLARE: the quemo-backup Worker has a weekly cron (Mondays 02:30 UTC).
//
//   node scripts/backup.mjs setup [repo]       create the private repo + an age key pair, store settings, set Worker secrets
//   node scripts/backup.mjs run                trigger a backup now (calls the deployed Worker)
//   node scripts/backup.mjs list [repo]        show backup history
//   node scripts/backup.mjs verify [repo]      decrypt the latest snapshots locally and check them
//   node scripts/backup.mjs restore <app> [--from <commit>] [repo]
//                                              restore one database into a NEW D1 database (never overwrites)
//
// repo defaults to <your-github-user>/quemo-backups. The private key lives in ~/.config/quemo/backup-key.txt:
// keep a copy somewhere safe (password manager). Without it, backups cannot be decrypted.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const APPS = ["auth", "budget", "workout", "health", "food"];
const KEY_DIR = join(homedir(), ".config", "quemo");
const KEY = join(KEY_DIR, "backup-key.txt");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], ...opts }).trim();
const gh = (...args) => run("gh", args);

function defaultRepo(arg) {
  if (arg && arg.includes("/")) return arg;
  const saved = existsSync(join(root, "deploy.config.json")) ? JSON.parse(readFileSync(join(root, "deploy.config.json"), "utf8")).backupRepo : undefined;
  if (!arg && saved) return saved;
  return `${gh("api", "user", "-q", ".login")}/${arg || "quemo-backups"}`;
}

function publicKey() {
  if (!existsSync(KEY)) {
    mkdirSync(KEY_DIR, { recursive: true });
    run("age-keygen", ["-o", KEY]);
    chmodSync(KEY, 0o600);
    console.log(`Created private key ${KEY}. Back it up somewhere safe now.`);
  }
  return readFileSync(KEY, "utf8").match(/public key: (age1\w+)/)[1];
}

function clone(repo) {
  const dir = mkdtempSync(join(tmpdir(), "quemo-backups-"));
  run("gh", ["repo", "clone", repo, dir, "--", "-q"]);
  return dir;
}

const CONFIG = join(root, "deploy.config.json");
const RUN_TOKEN = join(KEY_DIR, "backup-run-token");
const loadConfig = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});

function setup(repoArg) {
  const repo = defaultRepo(repoArg);
  const exists = (() => {
    try {
      return gh("repo", "view", repo, "--json", "visibility", "-q", ".visibility");
    } catch {
      return null;
    }
  })();
  if (exists && exists !== "PRIVATE") throw new Error(`${repo} exists and is ${exists}. Backups must go to a private repo.`);
  if (!exists) {
    console.log(`Creating private repo ${repo}`);
    gh("repo", "create", repo, "--private", "--add-readme", "--description", "Encrypted weekly Quemo database backups");
  }
  const recipient = publicKey();

  // README explaining the layout (the Worker needs an existing branch to commit onto).
  const dir = clone(repo);
  writeFileSync(
    join(dir, "README.md"),
    `# Quemo backups

Weekly snapshots of every Quemo D1 database, made on Cloudflare by the \`quemo-backup\` Worker (Mondays 02:30 UTC).
Each dump is gzip-compressed and encrypted with [age](https://age-encryption.org). Each commit is one restorable week;
\`MANIFEST.txt\` lists table/row counts and checksums. Weeks without changes are skipped.

Only the holder of the private key (\`~/.config/quemo/backup-key.txt\`) can decrypt them.
Restore with \`npm run backup:restore -- <app>\` from the quemo repo.
`,
  );
  run("git", ["-C", dir, "add", "-A"]);
  try {
    run("git", ["-C", dir, "-c", "user.name=quemo-backup", "-c", "user.email=quemo-backup@users.noreply.github.com", "commit", "-q", "-m", "Describe backup layout"]);
    run("git", ["-C", dir, "push", "-q", "origin", "HEAD"]);
  } catch {}
  rmSync(dir, { recursive: true, force: true });

  const c = loadConfig();
  c.backupRepo = repo;
  c.ageRecipient = recipient;
  writeFileSync(CONFIG, `${JSON.stringify(c, null, 2)}\n`);
  if (!existsSync(RUN_TOKEN)) {
    writeFileSync(RUN_TOKEN, randomBytes(24).toString("base64url"));
    chmodSync(RUN_TOKEN, 0o600);
  }
  console.log(`✓ Private repo ${repo} ready. Settings saved to deploy.config.json.

Next:
  1. Create a fine-grained GitHub token that can ONLY write to that repo:
     https://github.com/settings/personal-access-tokens/new
     → Repository access: Only select repositories → ${repo}
     → Permissions: Contents → Read and write → Generate
  2. Deploy the Worker and give it its secrets:
     node scripts/deploy.mjs backup
     npx wrangler secret put GITHUB_TOKEN -c apps/backup/wrangler.jsonc      (paste the token)
     npx wrangler secret put RUN_TOKEN -c apps/backup/wrangler.jsonc < ${RUN_TOKEN}
  3. Test it: npm run backup:run   then   npm run backup:verify

Keep a copy of ${KEY} in your password manager. Lose it and the backups are unreadable.`);
}

async function trigger() {
  const c = loadConfig();
  const url = c.urls?.backup ?? c.urls?.auth?.replace("quemo-auth", "quemo-backup");
  if (!url) throw new Error("Deploy first (node scripts/deploy.mjs all)");
  if (!existsSync(RUN_TOKEN)) throw new Error("No run token yet. Run: npm run backup:setup");
  const res = await fetch(`${url}/run`, { method: "POST", headers: { Authorization: `Bearer ${readFileSync(RUN_TOKEN, "utf8").trim()}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Backup failed (${res.status}): ${body}`);
  const r = JSON.parse(body);
  console.log(r.committed ? `✓ Backup committed (${r.sha.slice(0, 7)})\n${r.manifest}` : `✓ Nothing changed since the last backup.\n${r.manifest}`);
}

function list(repoArg) {
  const repo = defaultRepo(repoArg);
  console.log(gh("api", `repos/${repo}/commits?path=MANIFEST.txt&per_page=30`, "-q", '.[] | "\\(.sha[0:7])  \\(.commit.author.date)  \\(.commit.message)"'));
}

function decrypt(file) {
  if (!existsSync(KEY)) throw new Error(`Private key not found at ${KEY}`);
  return execFileSync("sh", ["-c", `age -d -i "${KEY}" "${file}" | gunzip`], { encoding: "utf8", maxBuffer: 1 << 30 });
}

function verify(repoArg) {
  const dir = clone(defaultRepo(repoArg));
  try {
    const manifest = existsSync(join(dir, "MANIFEST.txt")) ? readFileSync(join(dir, "MANIFEST.txt"), "utf8") : "";
    if (!manifest) throw new Error("No backups yet. Run: node scripts/backup.mjs run");
    for (const app of APPS) {
      const sql = decrypt(join(dir, "snapshots", `quemo-${app}.sql.gz.age`));
      const rows = (sql.match(/^INSERT/gm) || []).length;
      const expected = manifest.match(new RegExp(`quemo-${app} .*?rows=(\\d+)`))?.[1];
      const ok = String(rows) === expected && /CREATE TABLE/.test(sql);
      console.log(`${ok ? "✓" : "✗"} quemo-${app}: ${rows} rows${ok ? "" : ` (manifest says ${expected})`}`);
      if (!ok) process.exitCode = 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function restore(app, from, repoArg) {
  if (!APPS.includes(app)) throw new Error(`Unknown app "${app}". One of: ${APPS.join(", ")}`);
  const dir = clone(defaultRepo(repoArg));
  try {
    if (from) run("git", ["-C", dir, "checkout", "-q", from]);
    const sql = decrypt(join(dir, "snapshots", `quemo-${app}.sql.gz.age`));
    const file = join(dir, "restore.sql");
    writeFileSync(file, sql);
    const name = `quemo-${app}-restore-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    console.log(`Creating new database ${name} (your live database is not touched)`);
    run("npx", ["wrangler", "d1", "create", name], { cwd: root, stdio: "inherit" });
    run("npx", ["wrangler", "d1", "execute", name, "--remote", "--file", file, "-y"], { cwd: root, stdio: "inherit" });
    const id = JSON.parse(run("npx", ["wrangler", "d1", "list", "--json"], { cwd: root })).find((d) => d.name === name).uuid;
    console.log(`
✓ Restored into ${name} (${id}).
To switch the live Worker to it: put this id as "database_id" in apps/${app}/wrangler.jsonc, then run npm run deploy:${app}.
For mistakes in the last 30 days, Cloudflare's built-in Time Travel is faster:
  npx wrangler d1 time-travel restore quemo-${app} --timestamp=<ISO time>`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest.splice(i, 2)[1] : undefined;
};
try {
  if (cmd === "setup") setup(rest[0]);
  else if (cmd === "run") await trigger();
  else if (cmd === "list") list(rest[0]);
  else if (cmd === "verify") verify(rest[0]);
  else if (cmd === "restore") {
    const from = flag("--from");
    restore(rest[0], from, rest[1]);
  } else console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 13).join("\n").replace(/^\/\/ ?/gm, ""));
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
