#!/usr/bin/env node
// Quemo deploy helper. Each Worker deploys on its own; this script only wires them together.
//
//   node scripts/deploy.mjs setup            create D1 databases + KV, write their ids, run remote migrations
//   node scripts/deploy.mjs all              deploy auth, then the four tools
//   node scripts/deploy.mjs <app> [...]      deploy only these (auth | budget | workout | health | food | backup)
//   node scripts/deploy.mjs migrate [app]    apply remote D1 migrations
//   node scripts/deploy.mjs urls             print the public URLs
//
// Public URLs and tool paths are kept in deploy.config.json (gitignored) and passed as --var at deploy time,
// so wrangler.jsonc keeps localhost defaults for `wrangler dev` and tests. Edit that file to use custom domains.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const APPS = ["auth", "budget", "workout", "health", "food"];
const TOOLS = APPS.slice(1);
const CONFIG = `${root}/deploy.config.json`;

const wrangler = (args, opts = {}) =>
  execFileSync("npx", ["wrangler", ...args], { cwd: root, encoding: "utf8", stdio: opts.inherit ? "inherit" : ["inherit", "pipe", "inherit"], ...opts });
const cfgPath = (app) => `${root}/apps/${app}/wrangler.jsonc`;
const loadConfig = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});
const saveConfig = (c) => writeFileSync(CONFIG, `${JSON.stringify(c, null, 2)}\n`);

function patch(app, pattern, value) {
  const file = cfgPath(app);
  writeFileSync(file, readFileSync(file, "utf8").replace(pattern, value));
}

function setup() {
  const dbs = JSON.parse(wrangler(["d1", "list", "--json"]));
  for (const app of APPS) {
    const name = `quemo-${app}`;
    let db = dbs.find((d) => d.name === name);
    if (!db) {
      console.log(`Creating D1 database ${name}`);
      wrangler(["d1", "create", name]);
      db = JSON.parse(wrangler(["d1", "list", "--json"])).find((d) => d.name === name);
    }
    const byName = new RegExp(`("database_name": "${name}", "database_id": ")[^"]+(")`);
    patch(app, byName, `$1${db.uuid}$2`);
    patch("backup", byName, `$1${db.uuid}$2`); // the backup Worker binds every database
    console.log(`✓ ${name} → ${db.uuid}`);
  }
  const kvs = JSON.parse(wrangler(["kv", "namespace", "list"]));
  let kv = kvs.find((k) => k.title === "quemo-oauth");
  if (!kv) {
    console.log("Creating KV namespace quemo-oauth");
    wrangler(["kv", "namespace", "create", "quemo-oauth"]);
    kv = JSON.parse(wrangler(["kv", "namespace", "list"])).find((k) => k.title === "quemo-oauth");
  }
  patch("auth", /("binding": "OAUTH_KV", "id": ")[^"]+(")/, `$1${kv.id}$2`);
  console.log(`✓ KV quemo-oauth → ${kv.id}`);
  migrate(APPS);
}

function migrate(apps) {
  for (const app of apps) {
    console.log(`Migrating quemo-${app} (remote)`);
    wrangler(["d1", "migrations", "apply", "DB", "--remote", "-c", cfgPath(app)], { inherit: true, env: { ...process.env, CI: "1" } });
  }
}

// Tools are served as paths of the quemo-auth origin: https://quemo-auth.<you>.workers.dev/<slug>/mcp
// Edit "routes" in deploy.config.json to rename a path (e.g. budget → "finance").
const DEFAULT_ROUTES = { budget: "finance", workout: "workout", health: "health", food: "food" };
const RESERVED = ["auth", "authorize", "oauth", "dashboard", "logout", "health-check", ".well-known"];

/** Learns the account's workers.dev subdomain from the first auth deploy, then derives every URL. */
function urls() {
  const c = loadConfig();
  if (!c.urls?.auth) {
    console.log("First deploy of quemo-auth to discover your workers.dev subdomain…");
    const out = wrangler(["deploy", "-c", cfgPath("auth")]);
    const sub = out.match(/https:\/\/quemo-auth\.([a-z0-9-]+)\.workers\.dev/)?.[1];
    if (!sub) throw new Error(`Could not find the workers.dev URL in:\n${out}`);
    c.urls = { auth: `https://quemo-auth.${sub}.workers.dev`, backup: `https://quemo-backup.${sub}.workers.dev` };
  }
  c.routes = { ...DEFAULT_ROUTES, ...c.routes };
  for (const [tool, slug] of Object.entries(c.routes)) {
    if (!/^[a-z][a-z0-9-]*$/.test(slug) || RESERVED.includes(slug)) throw new Error(`Invalid path "${slug}" for ${tool}`);
    c.urls[tool] = `${c.urls.auth}/${slug}`;
  }
  saveConfig(c);
  return c.urls;
}

function backupVars() {
  const c = loadConfig();
  if (!c.backupRepo || !c.ageRecipient) throw new Error("Backups aren't set up yet. Run: npm run backup:setup");
  return { BACKUP_REPO: c.backupRepo, AGE_RECIPIENT: c.ageRecipient };
}

function deploy(app) {
  const u = urls();
  const vars =
    app === "auth"
      ? { PUBLIC_URL: u.auth, BUDGET_URL: u.budget, WORKOUT_URL: u.workout, HEALTH_URL: u.health, FOOD_URL: u.food, ...(loadConfig().emailFrom ? { EMAIL_FROM: loadConfig().emailFrom } : {}) }
      : app === "backup"
        ? backupVars()
        : { PUBLIC_URL: u[app], AUTH_URL: u.auth };
  console.log(`\nDeploying quemo-${app} → ${u[app]}`);
  wrangler(["deploy", "-c", cfgPath(app), ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { inherit: true });
}

const [cmd = "help", ...rest] = process.argv.slice(2);
if (cmd === "setup") setup();
else if (cmd === "migrate") migrate(rest.length ? rest : APPS);
else if (cmd === "urls") console.log(urls());
else if (cmd === "all") ["auth", ...TOOLS, ...(loadConfig().backupRepo ? ["backup"] : [])].forEach(deploy);
else if ([...APPS, "backup"].includes(cmd)) [cmd, ...rest].forEach(deploy);
else console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).join("\n").replace(/^\/\/ ?/gm, ""));
