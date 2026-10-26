#!/usr/bin/env node
// Encrypted backups of every Quemo D1 database into a private GitHub repo.
//
//   node scripts/backup.mjs setup [repo]       create the private repo, an age key pair, the nightly workflow and secrets
//   node scripts/backup.mjs run [repo]         trigger a backup now (GitHub Actions)
//   node scripts/backup.mjs list [repo]        show backup history
//   node scripts/backup.mjs verify [repo]      decrypt the latest snapshots locally and check them
//   node scripts/backup.mjs restore <app> [--from <commit>] [repo]
//                                              restore one database into a NEW D1 database (never overwrites)
//
// repo defaults to <your-github-user>/quemo-backups. The private key lives in ~/.config/quemo/backup-key.txt:
// keep a copy somewhere safe (password manager). Without it, backups cannot be decrypted.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    gh("repo", "create", repo, "--private", "--description", "Encrypted Quemo database backups");
  }
  const recipient = publicKey();

  const dir = clone(repo);
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "backup.yml"), readFileSync(join(root, "backup", "backup.yml")));
  writeFileSync(
    join(dir, "README.md"),
    `# Quemo backups

Nightly snapshots of every Quemo D1 database, gzip-compressed and encrypted with [age](https://age-encryption.org).
Each commit is one day's backup; \`MANIFEST.txt\` lists row counts and checksums. Days without changes are skipped.

Only the holder of the private key (\`~/.config/quemo/backup-key.txt\`) can decrypt them.
Restore with \`node scripts/backup.mjs restore <app>\` from the quemo repo.
`,
  );
  run("git", ["-C", dir, "add", "-A"]);
  try {
    run("git", ["-C", dir, "-c", "user.name=quemo-backup", "-c", "user.email=quemo-backup@users.noreply.github.com", "commit", "-q", "-m", "Install nightly backup workflow"]);
    run("git", ["-C", dir, "push", "-q", "origin", "HEAD"]);
  } catch {
    console.log("Workflow already up to date.");
  }
  rmSync(dir, { recursive: true, force: true });

  gh("secret", "set", "AGE_RECIPIENT", "-R", repo, "-b", recipient);
  console.log(`✓ ${repo} is ready (workflow + AGE_RECIPIENT secret).`);

  const missing = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter((s) => !gh("secret", "list", "-R", repo).includes(s));
  if (missing.length) {
    console.log(`
Two secrets left (they come from your Cloudflare account):
  1. Create an API token at https://dash.cloudflare.com/profile/api-tokens
     → Custom token → Permissions: Account · D1 · Edit → Create
  2. Run:
     gh secret set CLOUDFLARE_API_TOKEN -R ${repo}
     gh secret set CLOUDFLARE_ACCOUNT_ID -R ${repo} -b "$(npx wrangler whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)"
  3. Test it: node scripts/backup.mjs run`);
  }
  console.log(`\nKeep a copy of ${KEY} in your password manager. Lose it and the backups are unreadable.`);
}

function trigger(repoArg) {
  const repo = defaultRepo(repoArg);
  gh("workflow", "run", "backup", "-R", repo);
  console.log(`Backup started. Watch it with: gh run watch -R ${repo}`);
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
      const expected = manifest.match(new RegExp(`quemo-${app} rows=(\\d+)`))?.[1];
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
  else if (cmd === "run") trigger(rest[0]);
  else if (cmd === "list") list(rest[0]);
  else if (cmd === "verify") verify(rest[0]);
  else if (cmd === "restore") {
    const from = flag("--from");
    restore(rest[0], from, rest[1]);
  } else console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).join("\n").replace(/^\/\/ ?/gm, ""));
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
