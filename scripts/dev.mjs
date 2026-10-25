#!/usr/bin/env node
// Runs all five Workers locally (auth :8787, budget :8788, workout :8789, health :8790, food :8791).
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const APPS = { auth: 8787, budget: 8788, workout: 8789, health: 8790, food: 8791 };
const colors = [35, 32, 33, 36, 31];

for (const app of Object.keys(APPS)) {
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], { cwd: `${root}/apps/${app}`, stdio: "ignore" });
}
Object.entries(APPS).forEach(([app, port], i) => {
  const p = spawn("npx", ["wrangler", "dev", "--port", String(port), "--inspector-port", String(port + 1000)], { cwd: `${root}/apps/${app}`, env: { ...process.env, NO_COLOR: "1" } });
  const tag = `\x1b[${colors[i]}m[${app}]\x1b[0m `;
  const pipe = (s) => s.on("data", (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, tag)));
  pipe(p.stdout);
  pipe(p.stderr);
});
console.log("Open http://localhost:8787, sign-in codes appear in the [auth] log.");
