import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { htmlResponse, isValidTimezone, type ToolId } from "@quemo/core";
import { sendSignInEmail } from "./email";
import { checkInboxView, confirmView, consentView, dashboardView, messageView, signInView } from "./views";
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
    return checkInboxPage(email, next, "A code was sent moments ago. Check your inbox (and spam) or wait 30 seconds.");
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
  return htmlResponse(confirmView(url.searchParams.get("token") ?? "", url.searchParams.get("next") ?? ""));
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
    return htmlResponse(consentView(details, tool, user.email, consent.handle), 200, consent.headers);
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

  return htmlResponse(dashboardView({ user, keys, connected, urls: Object.fromEntries(TOOL_IDS.map((t) => [t, mcpUrl(env, t)])) as Record<ToolId, string>, flash }));
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
    return dashboard(request, env, "Email didn't match, so the account was not deleted.");
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
  return htmlResponse(signInView(next, error, tool), error ? 400 : 200);
}

function checkInboxPage(email: string, next: string, notice?: string): Response {
  return htmlResponse(checkInboxView(email, next, notice));
}

function messagePage(title: string, message: string, status: number): Response {
  return htmlResponse(messageView(title, message), status);
}

// ---------- helpers ----------

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

const redirect = (location: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: location, ...headers } });

/**
 * Blocks form posts from other sites. Browsers send Sec-Fetch-Site on every request; when it's missing
 * (old browsers, curl) fall back to Origin. Origin can legitimately be "null" for same-site forms
 * under strict referrer policies, so "null" alone is not treated as cross-site.
 */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("Origin");
  return !origin || origin === "null" || origin === new URL(request.url).origin;
}

function readCookie(request: Request, name: string): string | null {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function cookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
