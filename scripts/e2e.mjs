#!/usr/bin/env node
// End-to-end smoke test: boots all five Workers with `wrangler dev` (service bindings via the
// local dev registry) and walks the real user journey across them.
//   node scripts/e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const APPS = { auth: 8787, budget: 8788, workout: 8789, health: 8790, food: 8791 };
const TOOLS = ["budget", "workout", "health", "food"];
const url = (app) => `http://localhost:${APPS[app]}`;
const procs = [];
let authLog = "";
let passed = 0;

function check(cond, label, detail = "") {
  if (!cond) throw new Error(`✗ ${label}${detail ? `\n${String(detail).slice(0, 800)}` : ""}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

function cleanup() {
  for (const p of procs) {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {}
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

async function waitFor(u) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${u}/health`)).ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${u} did not start`);
}

async function boot() {
  console.log("▶ migrating local databases");
  for (const app of Object.keys(APPS)) {
    execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", ".wrangler/e2e"], { cwd: `${root}/apps/${app}`, stdio: "ignore" });
  }
  console.log("▶ starting workers");
  for (const [app, port] of Object.entries(APPS)) {
    const p = spawn("npx", ["wrangler", "dev", "--port", String(port), "--persist-to", ".wrangler/e2e", "--inspector-port", String(port + 1000)], {
      cwd: `${root}/apps/${app}`,
      detached: true,
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (app === "auth") p.stdout.on("data", (d) => (authLog += d));
    procs.push(p);
  }
  await Promise.all(Object.keys(APPS).map((a) => waitFor(url(a))));
}

const post = (u, data, headers = {}) =>
  fetch(u, { method: "POST", body: new URLSearchParams(data), redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers } });

async function mcp(tool, token, method, params = {}) {
  const res = await fetch(`${url(tool)}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  return { status: res.status, json: line ? JSON.parse(line.slice(6)) : body ? JSON.parse(body) : null };
}

async function callTool(tool, token, name, args = {}) {
  const r = await mcp(tool, token, "tools/call", { name, arguments: args });
  const result = r.json?.result;
  if (!result || result.isError) throw new Error(`${tool}.${name} failed: ${JSON.stringify(r.json).slice(0, 600)}`);
  return result.content.map((c) => c.text).join("\n");
}

async function main() {
  await boot();
  const email = `e2e-${Date.now()}@quemo.test`;

  console.log("▶ one-email sign-up");
  const landing = await (await fetch(url("auth"))).text();
  check(landing.includes("quemo") && landing.includes("Get my code"), "landing page renders");
  await post(`${url("auth")}/auth/email`, { email, tz: "Europe/Berlin", next: "/dashboard" });
  await sleep(500);
  const code = authLog.match(new RegExp(`sign-in for ${email.replace(/[.+]/g, "\\$&")}: code (\\d{6})`))?.[1];
  check(!!code, "sign-in code emailed (logged in dev)");
  const signedIn = await post(`${url("auth")}/auth/code`, { email, code, next: "/dashboard" });
  check(signedIn.status === 303, "code accepted, session started");
  const cookie = signedIn.headers.get("set-cookie").split(";")[0];

  const keyPage = await (await post(`${url("auth")}/dashboard/keys`, { name: "e2e" }, { Cookie: cookie })).text();
  const key = keyPage.match(/qmk_[A-Za-z0-9_-]{20,}/)?.[0];
  check(!!key, "API key created on the dashboard");

  console.log("▶ every tool, one key");
  for (const tool of TOOLS) {
    const unauth = await mcp(tool, "bad", "tools/list");
    check(unauth.status === 401, `${tool}: rejects bad token`);
    const list = await mcp(tool, key, "tools/list");
    const names = list.json.result.tools.map((t) => t.name);
    check(["follow_up", "generate_report", "get_profile"].every((n) => names.includes(n)), `${tool}: ${names.length} tools incl. follow_up + generate_report`);
    const profile = JSON.parse(await callTool(tool, key, "get_profile"));
    check(profile.email === email && profile.timezone === "Europe/Berlin", `${tool}: shared profile via auth RPC`);
  }

  console.log("▶ realistic usage");
  await callTool("budget", key, "add_transaction", { amount: 42.5, category: "Groceries", merchant: "Rewe" });
  await callTool("budget", key, "set_budget", { category: "Groceries", amount: 300 });
  const status = JSON.parse(await callTool("budget", key, "budget_status"));
  check(status.categories[0]?.category === "Groceries" && status.categories[0].spent === 42.5 && status.categories[0].budget === 300, "budget: transaction counted against its budget");

  const workoutTools = (await mcp("workout", key, "tools/list")).json.result.tools.map((t) => t.name);
  check(workoutTools.includes("log_workout"), "workout: log_workout available");
  const healthTools = (await mcp("health", key, "tools/list")).json.result.tools.map((t) => t.name);
  check(healthTools.some((t) => t.includes("medication")), "health: medication tools available");
  const foodTools = (await mcp("food", key, "tools/list")).json.result.tools.map((t) => t.name);
  check(foodTools.includes("log_meal"), "food: log_meal available");

  await callTool("budget", key, "update_profile", { currency: "USD" });
  check(JSON.parse(await callTool("food", key, "get_profile")).currency === "USD", "profile change in one tool applies to all");

  console.log("▶ reports");
  for (const tool of TOOLS) {
    const md = await callTool(tool, key, "generate_report", { period: "this_month" });
    const link = md.match(/http:\/\/localhost:\d+\/reports\/[a-f0-9]{40}/)?.[0];
    check(md.startsWith("# ") && !!link, `${tool}: Markdown report + printable link`);
    const page = await fetch(link);
    check(page.ok && (await page.text()).includes("@media print"), `${tool}: printable report page`);
    const followUp = await callTool(tool, key, "follow_up");
    check(followUp.includes("nudges"), `${tool}: follow-up check-in`);
  }

  console.log("▶ OAuth (what Claude.ai / ChatGPT do)");
  const meta = await (await fetch(`${url("health")}/.well-known/oauth-protected-resource/mcp`)).json();
  check(meta.authorization_servers[0] === url("auth"), "tool points clients to quemo-auth");
  const reg = await (
    await fetch(`${url("auth")}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "E2E Chat", redirect_uris: ["https://chat.example/cb"], token_endpoint_auth_method: "none" }),
    })
  ).json();
  const b64 = (b) => Buffer.from(b).toString("base64url");
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const authorize = `${url("auth")}/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: "https://chat.example/cb",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s",
    scope: "health",
    resource: `${url("health")}/mcp`,
  })}`;
  const consentPage = await fetch(authorize, { headers: { Cookie: cookie } });
  const html = await consentPage.text();
  check(html.includes("Quemo Health") && html.includes("E2E Chat"), "consent screen names app + tool");
  const handle = html.match(/name="handle" value="([^"]+)"/)[1];
  const bound = consentPage.headers.getSetCookie().map((c) => c.split(";")[0]);
  const approved = await post(authorize, { handle, decision: "approve" }, { Cookie: [cookie, ...bound].join("; ") });
  const codeParam = new URL(approved.headers.get("location")).searchParams.get("code");
  const tokens = await (
    await fetch(`${url("auth")}/oauth/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: codeParam, client_id: reg.client_id, redirect_uri: "https://chat.example/cb", code_verifier: verifier, resource: `${url("health")}/mcp` }),
    })
  ).json();
  check(!!tokens.access_token, "token issued");
  check(JSON.parse(await callTool("health", tokens.access_token, "get_profile")).email === email, "OAuth token works on Quemo Health");
  check((await mcp("budget", tokens.access_token, "tools/list")).status === 401, "…and is rejected by Quemo Budget (audience-bound)");

  console.log(`\n✅ e2e passed: ${passed} checks`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
