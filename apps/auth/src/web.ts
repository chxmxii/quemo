import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { copyBlock, escapeHtml as e, htmlResponse, isValidTimezone, layout, TOOLS, type ToolId } from "@quemo/core";
import { sendSignInEmail } from "./email";
import {
  API_KEY_PREFIX,
  getProfile,
  isEmail,
  issuer,
  mcpUrl,
  normalizeEmail,
  now,
  oauth,
  randomToken,
  safeNext,
  sha256,
  TOOL_IDS,
  toolForResource,
  type Env,
} from "./lib";

const SESSION_COOKIE = "quemo_session";
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const LOGIN_TTL = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

interface SessionUser {
  id: string;
  email: string;
}

const DISTRICTS: Record<ToolId, { district: string; icon: string; examples: string[] }> = {
  budget: { district: "Vice Bank", icon: "💸", examples: ["spent 23€ on groceries", "how's my budget this month?"] },
  workout: { district: "Muscle Beach", icon: "🏋️", examples: ["log bench 4x8 at 70kg", "what are my PRs?"] },
  health: { district: "Ocean Clinic", icon: "💊", examples: ["took my morning meds", "BP 120/80 today"] },
  food: { district: "Neon Diner", icon: "🌮", examples: ["had a chicken wrap for lunch", "how much protein left today?"] },
};

/** Routes owned by quemo-auth itself; returns null for paths the OAuth server handles. */
export async function handleWeb(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (request.method === "POST" && !sameOrigin(request)) return text("Cross-site request blocked", 403);

  try {
    switch (route) {
      case "GET /":
        return (await currentUser(request, env)) ? redirect("/dashboard") : signInPage(url.searchParams.get("next"));
      case "POST /auth/email":
        return requestSignIn(request, env);
      case "GET /auth/verify":
        return verifyConfirmPage(url);
      case "POST /auth/verify":
        return verifyLink(request, env);
      case "POST /auth/code":
        return verifyCode(request, env);
      case "POST /logout":
        return logout(request, env);
      case "GET /dashboard":
        return dashboard(request, env);
      case "POST /dashboard/profile":
        return updateProfile(request, env);
      case "POST /dashboard/keys":
        return createKey(request, env);
      case "POST /dashboard/keys/revoke":
        return revokeKey(request, env);
      case "POST /dashboard/delete":
        return deleteAccount(request, env);
      case "GET /authorize":
      case "POST /authorize":
        return await authorize(request, env);
      case "GET /health":
        return text("ok");
    }
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302);
    if (err instanceof AuthorizationError || err instanceof CimdFetchError) {
      const msg = err instanceof AuthorizationError ? err.description : "This app could not be verified.";
      return messagePage("Access denied", msg ?? "Invalid request.", 400);
    }
    throw err;
  }
  return null;
}

// ---------- sign up / sign in: one email, no password ----------

async function requestSignIn(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const next = safeNext(String(form.get("next") ?? ""));
  const tz = String(form.get("tz") ?? "");
  if (!isEmail(email)) return signInPage(next, "That doesn't look like an email address.");

  // Registering and signing in are the same step: the first email creates the account.
  await env.DB.prepare("INSERT INTO users (id, email, timezone, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING")
    .bind(crypto.randomUUID(), email, isValidTimezone(tz) ? tz : "UTC", now())
    .run();
  const user = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!;

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM login_tokens WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - 3600_000)
    .first<{ n: number; last: number | null }>();
  if (recent && (recent.n >= 6 || (recent.last && now() - recent.last < 30_000))) {
    return checkInboxPage(email, next, "A code was sent moments ago — check your inbox (and spam) or wait 30 seconds.");
  }

  const token = randomToken();
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), await sha256(`${user.id}:${code}`), user.id, now(), now() + LOGIN_TTL)
    .run();
  const link = `${issuer(env)}/auth/verify?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
  await sendSignInEmail(env, email, link, code);
  return checkInboxPage(email, next);
}

/** Mail scanners pre-fetch links, so GET only renders a button and POST consumes the token. */
function verifyConfirmPage(url: URL): Response {
  return page(
    "Enter the city",
    `<section class="panel stack fade" style="max-width:520px;margin:12vh auto 0">
  <span class="kicker">Identity confirmed</span><h1 class="grad">One more step</h1>
  <form method="post" action="/auth/verify" class="stack">
    <input type="hidden" name="token" value="${e(url.searchParams.get("token") ?? "")}">
    <input type="hidden" name="next" value="${e(safeNext(url.searchParams.get("next")))}">
    <button>Enter Quemo City</button>
  </form></section>`,
    "hero",
  );
}

async function verifyLink(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const next = safeNext(String(form.get("next") ?? ""));
  const row = await env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id")
    .bind(now(), await sha256(String(form.get("token") ?? "")), now())
    .first<{ user_id: string }>();
  if (!row) return signInPage(next, "That link is invalid or expired. Request a fresh one.");
  return startSession(request, env, row.user_id, next);
}

async function verifyCode(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const next = safeNext(String(form.get("next") ?? ""));
  const latest = await env.DB.prepare(
    `SELECT t.token_hash, t.code_hash, t.attempts, t.user_id FROM login_tokens t JOIN users u ON u.id = t.user_id
     WHERE u.email = ? AND t.used_at IS NULL AND t.expires_at > ? ORDER BY t.created_at DESC LIMIT 1`,
  )
    .bind(email, now())
    .first<{ token_hash: string; code_hash: string; attempts: number; user_id: string }>();
  if (!latest || latest.attempts >= MAX_CODE_ATTEMPTS) return signInPage(next, "That code expired or had too many attempts. Request a new one.");
  if ((await sha256(`${latest.user_id}:${code}`)) !== latest.code_hash) {
    await env.DB.prepare("UPDATE login_tokens SET attempts = attempts + 1 WHERE token_hash = ?").bind(latest.token_hash).run();
    return checkInboxPage(email, next, `Wrong code. ${MAX_CODE_ATTEMPTS - latest.attempts - 1} attempts left.`);
  }
  await env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ?").bind(now(), latest.token_hash).run();
  return startSession(request, env, latest.user_id, next);
}

async function startSession(request: Request, env: Env, userId: string, next: string): Promise<Response> {
  const sid = randomToken();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET verified_at = COALESCE(verified_at, ?) WHERE id = ?").bind(now(), userId),
    env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(sid), userId, now() + SESSION_TTL),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()),
    env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now() - 86_400_000),
  ]);
  return redirect(next, { "Set-Cookie": cookie(request, sid, SESSION_TTL / 1000) });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const sid = readCookie(request, SESSION_COOKIE);
  if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(sid)).run();
  return redirect("/", { "Set-Cookie": cookie(request, "", 0) });
}

export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid) return null;
  return env.DB.prepare("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?")
    .bind(await sha256(sid), now())
    .first<SessionUser>();
}

// ---------- OAuth consent: how Claude, ChatGPT, Cursor… get access to one tool ----------

async function authorize(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  const api = oauth(env);

  if (request.method === "GET") {
    const authRequest = await api.parseAuthRequest(request); // validates client + redirect URI first
    const url = new URL(request.url);
    const tool = toolForResource(env, authRequest.resource);
    if (!user) return signInPage(url.pathname + url.search, undefined, tool);
    const details = await api.describeConsent(authRequest);
    const consent = await api.beginConsent(authRequest);
    const t = tool ? TOOLS[tool] : null;
    return page(
      `Connect ${details.clientName}`,
      `<section class="panel stack fade" style="max-width:620px;margin:8vh auto 0">
  <span class="kicker">Access request</span>
  <h1><span class="grad">${e(details.clientName)}</span> wants in</h1>
  ${t && tool ? `<div class="panel district d-${tool}" style="padding:16px"><h3>${DISTRICTS[tool].icon} ${e(t.name)}</h3><p class="muted small" style="margin:6px 0 0">${e(t.tagline)}</p></div>` : ""}
  <p>It will be able to <strong>read and update</strong> your ${t ? e(t.name) : "Quemo"} data for <strong>${e(user.email)}</strong>.</p>
  <p class="muted small">${details.clientDomain ? `Published by <strong>${e(details.clientDomain)}</strong>.` : "This app registered itself; its name isn't verified."} Access goes to <strong>${e(details.redirectHost)}</strong>.</p>
  ${details.redirectIsLoopback ? `<p class="notice small"><strong>This sends access to an app on your computer.</strong> Only continue if you just started connecting from it.</p>` : ""}
  <form method="post" class="row">
    <input type="hidden" name="handle" value="${e(consent.handle)}">
    <button name="decision" value="approve">Grant access</button>
    <button name="decision" value="deny" class="ghost">Deny</button>
  </form></section>`,
      "hero",
      200,
      consent.headers,
    );
  }

  if (!user) return redirect("/");
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") !== "approve") {
    const denied = await api.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await api.approveConsent(request, handle);
  const { redirectTo } = await api.completeAuthorization({
    request: approved.request,
    userId: user.id,
    metadata: { email: user.email, tool: toolForResource(env, approved.request.resource) },
    scope: approved.request.scope,
    props: { userId: user.id, email: user.email },
  });
  approved.headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

// ---------- dashboard ----------

async function dashboard(request: Request, env: Env, flash?: string): Promise<Response> {
  const session = await currentUser(request, env);
  if (!session) return redirect("/");
  const user = (await getProfile(env, session.id))!;
  const { results: keys } = await env.DB.prepare(
    "SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all<{ id: string; name: string; prefix: string; created_at: number; last_used_at: number | null }>();
  const grants = await oauth(env).listUserGrants(user.id);
  const connected = new Map<ToolId, number>();
  for (const g of grants.items) {
    const tool = (g.metadata as { tool?: ToolId } | undefined)?.tool;
    if (tool) connected.set(tool, (connected.get(tool) ?? 0) + 1);
  }

  const key = flash?.startsWith(API_KEY_PREFIX) ? flash : "qmk_YOUR_API_KEY";
  const fmt = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "never");
  const urls = Object.fromEntries(TOOL_IDS.map((t) => [t, mcpUrl(env, t)])) as Record<ToolId, string>;
  const claudeCode = TOOL_IDS.map((t) => `claude mcp add --transport http quemo-${t} ${urls[t]}`).join("\n");
  const httpJson = JSON.stringify(
    { mcpServers: Object.fromEntries(TOOL_IDS.map((t) => [`quemo-${t}`, { url: urls[t], headers: { Authorization: `Bearer ${key}` } }])) },
    null,
    2,
  );
  const stdioJson = JSON.stringify(
    {
      mcpServers: Object.fromEntries(
        TOOL_IDS.map((t) => [`quemo-${t}`, { command: "npx", args: ["-y", "mcp-remote", urls[t], "--header", `Authorization: Bearer ${key}`] }]),
      ),
    },
    null,
    2,
  );

  const districts = TOOL_IDS.map((t, i) => {
    const d = DISTRICTS[t];
    const n = connected.get(t) ?? 0;
    return `<article class="panel district d-${t} stack fade d${(i % 3) + 1}">
  <div class="row between"><span class="kicker" style="color:var(--c)">${e(d.district)}</span>${n ? `<span class="chip"><i></i>${n} app${n > 1 ? "s" : ""} linked</span>` : `<span class="chip">Not linked</span>`}</div>
  <h3>${d.icon} ${e(TOOLS[t].name)}</h3>
  <p class="muted small" style="margin:0">${e(TOOLS[t].tagline)}</p>
  ${copyBlock(`url-${t}`, urls[t])}
  <p class="small muted" style="margin:0">Try: “${e(d.examples[0])}” · “${e(d.examples[1])}”</p>
</article>`;
  }).join("");

  return page(
    "Dashboard",
    `<header class="row between fade" style="margin-bottom:24px">
  <span class="logo sm glitch" data-text="QUEMO">QUEMO</span>
  <form method="post" action="/logout" class="row"><span class="chip"><i></i>${e(user.email)}</span><button class="ghost mini">Sign out</button></form>
</header>
${flash && !flash.startsWith(API_KEY_PREFIX) ? `<p class="flash">${e(flash)}</p>` : ""}
${flash?.startsWith(API_KEY_PREFIX) ? `<section class="panel stack" style="margin-bottom:16px"><span class="kicker">New API key — shown once</span>${copyBlock("newkey", flash)}<p class="muted small" style="margin:0">Works with all four tools. Store it somewhere safe.</p></section>` : ""}

<span class="kicker">Welcome back${user.name ? `, ${e(user.name)}` : ""}</span>
<h1 style="margin:8px 0 20px">Your <span class="grad">districts</span></h1>
<div class="cards">${districts}</div>

<h2>Connect your AI</h2>
<details open><summary>Claude — claude.ai, Desktop & mobile (no key needed)</summary>
<p>Settings → Connectors → <em>Add custom connector</em>. Add each district URL above as its own connector, then sign in with your email when asked.</p></details>
<details><summary>ChatGPT (no key needed)</summary>
<p>Settings → Apps &amp; Connectors → Advanced → enable <em>Developer mode</em> → <em>Create</em>. Paste a district URL, choose OAuth, and repeat for each district.</p></details>
<details><summary>Claude Code</summary>${copyBlock("cc", claudeCode)}<p class="muted small">Then run <code>/mcp</code> to sign in. Or add <code>--header "Authorization: Bearer ${e(key)}"</code> to skip OAuth.</p></details>
<details><summary>Cursor, Windsurf, VS Code, LibreChat, any HTTP MCP client</summary>${copyBlock("http", httpJson)}</details>
<details><summary>Apps that only run local (stdio) servers</summary>${copyBlock("stdio", stdioJson)}</details>

<h2>Profile</h2>
<form method="post" action="/dashboard/profile" class="panel stack">
  <div class="cards">
    <label class="stack small">Name<input name="name" value="${e(user.name ?? "")}" maxlength="80" placeholder="What should your AI call you?"></label>
    <label class="stack small">Time zone<input name="timezone" value="${e(user.timezone)}" list="tzs" required></label>
    <label class="stack small">Currency<input name="currency" value="${e(user.currency)}" maxlength="3" pattern="[A-Za-z]{3}" required></label>
    <label class="stack small">Units<select name="units"><option value="metric"${user.units === "metric" ? " selected" : ""}>Metric (kg, cm, ml)</option><option value="imperial"${user.units === "imperial" ? " selected" : ""}>Imperial (lb, in, oz)</option></select></label>
  </div>
  <datalist id="tzs"></datalist>
  <div><button>Save profile</button></div>
</form>

<h2>API keys</h2>
<section class="panel stack">
  <p class="muted small" style="margin:0">For apps that can't do OAuth. One key unlocks all four tools — send it as <code>Authorization: Bearer &lt;key&gt;</code>.</p>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>
  ${keys.map((k) => `<tr><td>${e(k.name)}</td><td><code>${e(k.prefix)}…</code></td><td>${fmt(k.created_at)}</td><td>${fmt(k.last_used_at)}</td><td><form method="post" action="/dashboard/keys/revoke"><input type="hidden" name="id" value="${e(k.id)}"><button class="ghost mini">Revoke</button></form></td></tr>`).join("") || `<tr><td colspan="5" class="muted">No keys yet.</td></tr>`}
  </tbody></table></div>
  <form method="post" action="/dashboard/keys" class="row"><input name="name" placeholder="Key name, e.g. Cursor laptop" maxlength="60" required><button>Create key</button></form>
</section>

<h2>Danger zone</h2>
<details><summary class="bad">Delete my account and all data in every district</summary>
<form method="post" action="/dashboard/delete" class="row" style="margin-top:12px"><input name="confirm" placeholder="Type your email to confirm" required><button class="danger">Delete forever</button></form>
<p class="muted small">Linked apps lose access immediately; tool data is wiped within 24 hours.</p></details>
<script>try{const l=document.getElementById("tzs");for(const z of Intl.supportedValuesOf("timeZone")){const o=document.createElement("option");o.value=z;l.appendChild(o)}}catch{}</script>`,
  );
}

async function updateProfile(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return redirect("/");
  const form = await request.formData();
  const tz = String(form.get("timezone") ?? "");
  const currency = String(form.get("currency") ?? "").toUpperCase();
  const units = form.get("units") === "imperial" ? "imperial" : "metric";
  if (!isValidTimezone(tz)) return dashboard(request, env, `Unknown time zone "${tz}".`);
  if (!/^[A-Z]{3}$/.test(currency)) return dashboard(request, env, "Currency must be a 3-letter code like EUR.");
  await env.DB.prepare("UPDATE users SET name = ?, timezone = ?, currency = ?, units = ? WHERE id = ?")
    .bind(String(form.get("name") ?? "").trim().slice(0, 80) || null, tz, currency, units, user.id)
    .run();
  return dashboard(request, env, "Profile saved. Every district uses it from now on.");
}

async function createKey(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return redirect("/");
  const name = String((await request.formData()).get("name") ?? "").trim().slice(0, 60) || "API key";
  const key = API_KEY_PREFIX + randomToken(24);
  await env.DB.prepare("INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), user.id, name, key.slice(0, 10), await sha256(key), now())
    .run();
  return dashboard(request, env, key);
}

async function revokeKey(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return redirect("/");
  const id = String((await request.formData()).get("id") ?? "");
  await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ?").bind(now(), id, user.id).run();
  return redirect("/dashboard");
}

async function deleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return redirect("/");
  if (normalizeEmail(String((await request.formData()).get("confirm") ?? "")) !== user.email) {
    return dashboard(request, env, "Email didn't match — account not deleted.");
  }
  const api = oauth(env);
  let cursor: string | undefined;
  do {
    const grants = await api.listUserGrants(user.id, { cursor });
    await Promise.all(grants.items.map((g) => api.revokeGrant(g.id, user.id)));
    cursor = grants.cursor;
  } while (cursor);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO deleted_users (user_id, deleted_at) VALUES (?, ?)").bind(user.id, now()),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id), // keys, sessions, tokens cascade
  ]);
  return redirect("/", { "Set-Cookie": cookie(request, "", 0) });
}

// ---------- pages ----------

function signInPage(next: string | null, error?: string, tool?: ToolId): Response {
  const cards = TOOL_IDS.map(
    (t, i) => `<div class="panel district d-${t} fade d${(i % 3) + 1}" style="padding:16px"><span class="kicker" style="color:var(--c);font-size:10px">${e(DISTRICTS[t].district)}</span><h3 style="margin-top:6px">${DISTRICTS[t].icon} ${e(TOOLS[t].name.replace("Quemo ", ""))}</h3></div>`,
  ).join("");
  return page(
    "Quemo — enter the city",
    `<section style="margin-top:4vh" class="fade">
  <span class="kicker">${tool ? `Connecting ${e(TOOLS[tool].name)}` : "Welcome to Quemo City"}</span>
  <h1 class="logo glitch" data-text="QUEMO" style="margin-top:10px">QUEMO</h1>
  <p class="tag">Your money, muscles, meds and meals — tracked from <span class="grad">any AI chat</span>.</p>
</section>
<section class="panel stack fade d2" style="max-width:560px;margin-top:32px">
  <h2 style="margin:0">${tool ? "Sign in to continue" : "Enter the city"}</h2>
  <p class="muted small" style="margin:0">New or returning — it's the same step. We email you a code, no passwords ever.</p>
  ${error ? `<p class="notice small">${e(error)}</p>` : ""}
  <form method="post" action="/auth/email" class="stack">
    <input type="hidden" name="next" value="${e(safeNext(next))}"><input type="hidden" name="tz" id="tz">
    <input type="email" name="email" placeholder="you@email.com" autocomplete="email" required autofocus aria-label="Email">
    <button>Send my access code</button>
  </form>
</section>
<div class="cards fade d3" style="margin-top:28px;max-width:860px">${cards}</div>
<script>try{document.getElementById("tz").value=Intl.DateTimeFormat().resolvedOptions().timeZone}catch{}</script>`,
    "hero",
    error ? 400 : 200,
  );
}

function checkInboxPage(email: string, next: string, notice?: string): Response {
  return page(
    "Check your inbox",
    `<section class="panel stack fade" style="max-width:560px;margin:10vh auto 0">
  <span class="kicker">Transmission sent</span>
  <h1>Check your <span class="grad">inbox</span></h1>
  <p>We sent a 6-digit access code and a link to <strong>${e(email)}</strong>. Type the code here or tap the link — either works, even on another device.</p>
  ${notice ? `<p class="notice small">${e(notice)}</p>` : ""}
  <form method="post" action="/auth/code" class="stack">
    <input type="hidden" name="email" value="${e(email)}"><input type="hidden" name="next" value="${e(next)}">
    <input class="code-in" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" placeholder="••••••" required autofocus aria-label="6-digit code">
    <button>Unlock</button>
  </form>
  <form method="post" action="/auth/email"><input type="hidden" name="email" value="${e(email)}"><input type="hidden" name="next" value="${e(next)}"><button class="ghost mini">Send a new code</button></form>
</section>`,
    "hero",
  );
}

function messagePage(title: string, message: string, status: number): Response {
  return page(title, `<section class="panel stack" style="max-width:560px;margin:12vh auto 0"><span class="kicker">Signal lost</span><h1>${e(title)}</h1><p>${e(message)}</p><a class="btn ghost" href="/">Back to the city</a></section>`, "app", status);
}

function page(title: string, body: string, variant: "hero" | "app" = "app", status = 200, headers?: Headers): Response {
  return htmlResponse(layout({ title, body, variant }), status, headers);
}

// ---------- helpers ----------

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

const redirect = (location: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: location, ...headers } });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function readCookie(request: Request, name: string): string | null {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function cookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
