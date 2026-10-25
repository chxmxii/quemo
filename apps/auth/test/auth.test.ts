import { env, SELF } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import type { AuthService } from "@quemo/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const BASE = "http://localhost:8787";
const BUDGET = "http://localhost:8788/mcp";
const WORKOUT = "http://localhost:8789/mcp";
const auth = (exports as unknown as { default: AuthService }).default;

afterEach(() => vi.restoreAllMocks());

/** Captures the sign-in email the Worker "sends" (logged when RESEND_API_KEY is unset). */
function captureEmails() {
  const spy = vi.spyOn(console, "log");
  return () => {
    const line = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[quemo] sign-in")).pop()!;
    const [, code, link] = line.match(/code (\d{6}) · (\S+)/)!;
    return { code, link };
  };
}

function form(data: Record<string, string>, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", body: new URLSearchParams(data), redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers } };
}

const cookieOf = (res: Response) => res.headers.get("Set-Cookie")!.split(";")[0];

let seq = 0;
async function signUp(email = `rider${++seq}-${Date.now()}@quemo.test`, tz = "Europe/Berlin") {
  const lastEmail = captureEmails();
  await SELF.fetch(`${BASE}/auth/email`, form({ email, tz, next: "/dashboard" }));
  const { code } = lastEmail();
  const res = await SELF.fetch(`${BASE}/auth/code`, form({ email, code, next: "/dashboard" }));
  expect(res.status).toBe(303);
  const cookie = cookieOf(res);
  const user = (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!;
  return { email, cookie, userId: user.id };
}

describe("sign-up & sign-in with one email", () => {
  it("renders the city landing page", async () => {
    const html = await (await SELF.fetch(BASE)).text();
    expect(html).toContain("quemo");
    expect(html).toContain('name="email"');
    expect(html).toContain("Get my code");
    for (const tool of ["Budget", "Workout", "Health", "Food"]) expect(html).toContain(tool);
  });

  it("creates the account on first email, with the browser's time zone", async () => {
    const { userId } = await signUp(undefined, "America/New_York");
    expect(await auth.getProfile(userId)).toMatchObject({ timezone: "America/New_York", currency: "EUR", units: "metric" });
  });

  it("rejects an invalid email", async () => {
    const res = await SELF.fetch(`${BASE}/auth/email`, form({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("rate-limits repeated code requests", async () => {
    const email = `limit${Date.now()}@quemo.test`;
    await SELF.fetch(`${BASE}/auth/email`, form({ email }));
    const html = await (await SELF.fetch(`${BASE}/auth/email`, form({ email }))).text();
    expect(html).toContain("A code was sent moments ago");
  });

  it("locks a code after too many wrong attempts", async () => {
    const email = `brute${Date.now()}@quemo.test`;
    const lastEmail = captureEmails();
    await SELF.fetch(`${BASE}/auth/email`, form({ email }));
    const { code } = lastEmail();
    for (let i = 0; i < 5; i++) {
      const html = await (await SELF.fetch(`${BASE}/auth/code`, form({ email, code: "000000" === code ? "111111" : "000000" }))).text();
      expect(html).toMatch(/Wrong code/);
    }
    const res = await SELF.fetch(`${BASE}/auth/code`, form({ email, code }));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/too many attempts/);
  });

  it("magic link needs a click (scanner-safe) and works only once", async () => {
    const email = `link${Date.now()}@quemo.test`;
    const lastEmail = captureEmails();
    await SELF.fetch(`${BASE}/auth/email`, form({ email }));
    const url = new URL(lastEmail().link);
    const confirm = await (await SELF.fetch(url)).text(); // GET must not consume the token
    expect(confirm).toContain("Continue to quemo");
    const body = { token: url.searchParams.get("token")!, next: "/dashboard" };
    expect((await SELF.fetch(`${BASE}/auth/verify`, form(body))).status).toBe(303);
    expect((await SELF.fetch(`${BASE}/auth/verify`, form(body))).status).toBe(400);
  });

  it("never redirects off-site after sign-in", async () => {
    const email = `next${Date.now()}@quemo.test`;
    const lastEmail = captureEmails();
    await SELF.fetch(`${BASE}/auth/email`, form({ email, next: "//evil.example" }));
    const res = await SELF.fetch(`${BASE}/auth/code`, form({ email, code: lastEmail().code, next: "//evil.example" }));
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("blocks cross-site form posts", async () => {
    const res = await SELF.fetch(`${BASE}/auth/email`, form({ email: "x@quemo.test" }, { Origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("signs out", async () => {
    const { cookie } = await signUp();
    await SELF.fetch(`${BASE}/logout`, form({}, { Cookie: cookie }));
    const res = await SELF.fetch(`${BASE}/dashboard`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(res.headers.get("Location")).toBe("/");
  });
});

describe("dashboard, profile and API keys", () => {
  it("shows every tool's MCP URL and connect instructions", async () => {
    const { cookie } = await signUp();
    const html = await (await SELF.fetch(`${BASE}/dashboard`, { headers: { Cookie: cookie } })).text();
    for (const url of [BUDGET, WORKOUT, "http://localhost:8790/mcp", "http://localhost:8791/mcp"]) expect(html).toContain(url);
    expect(html).toContain("claude mcp add --transport http quemo-budget");
  });

  it("updates the shared profile and validates it", async () => {
    const { cookie, userId } = await signUp();
    const bad = await (await SELF.fetch(`${BASE}/dashboard/profile`, form({ timezone: "Mars/Base", currency: "EUR", units: "metric" }, { Cookie: cookie }))).text();
    expect(bad).toContain("Unknown time zone");
    await SELF.fetch(`${BASE}/dashboard/profile`, form({ name: "Mouhib", timezone: "Africa/Tunis", currency: "tnd", units: "imperial" }, { Cookie: cookie }));
    expect(await auth.getProfile(userId)).toMatchObject({ name: "Mouhib", timezone: "Africa/Tunis", currency: "TND", units: "imperial" });
    // tools update it over RPC too
    expect(await auth.updateProfile(userId, { currency: "usd", timezone: "Nope/Nope" })).toMatchObject({ currency: "USD", timezone: "Africa/Tunis" });
  });

  it("issues one API key that works for every tool until revoked", async () => {
    const { cookie, userId, email } = await signUp();
    const html = await (await SELF.fetch(`${BASE}/dashboard/keys`, form({ name: "Cursor" }, { Cookie: cookie }))).text();
    const key = html.match(/qmk_[A-Za-z0-9_-]{20,}/)![0];
    for (const resource of [BUDGET, WORKOUT]) {
      expect(await auth.validateToken(resource, key)).toMatchObject({ props: { userId, email }, audience: resource, userId });
    }
    expect(await auth.validateToken("https://evil.example/mcp", key)).toBeNull();
    expect(await auth.validateToken(BUDGET, "qmk_wrong")).toBeNull();

    const keyId = (await env.DB.prepare("SELECT id FROM api_keys WHERE user_id = ?").bind(userId).first<{ id: string }>())!.id;
    await SELF.fetch(`${BASE}/dashboard/keys/revoke`, form({ id: keyId }, { Cookie: cookie }));
    expect(await auth.validateToken(BUDGET, key)).toBeNull();
  });
});

// ---------- OAuth: what Claude.ai / ChatGPT do ----------

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function oauthClient() {
  const reg = await SELF.fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Test Chat AI", redirect_uris: ["https://chat.example/callback"], token_endpoint_auth_method: "none" }),
  });
  expect(reg.status).toBe(201);
  const { client_id } = await reg.json<{ client_id: string }>();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const authorizeUrl = (resource: string) =>
    `${BASE}/authorize?${new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "https://chat.example/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "st4te",
      scope: "budget",
      resource,
    })}`;
  return { client_id, verifier, authorizeUrl };
}

async function consent(url: string, cookie: string, decision: "approve" | "deny") {
  const page = await SELF.fetch(url, { headers: { Cookie: cookie } });
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)![1];
  const bound = page.headers.getSetCookie().map((c) => c.split(";")[0]);
  const res = await SELF.fetch(url, form({ handle, decision }, { Cookie: [cookie, ...bound].join("; ") }));
  return { html, res };
}

describe("OAuth for chat apps", () => {
  it("advertises all four tools as protected resources", async () => {
    const meta = await (await SELF.fetch(`${BASE}/.well-known/oauth-authorization-server`)).json<any>();
    expect(meta.protected_resources).toEqual([BUDGET, WORKOUT, "http://localhost:8790/mcp", "http://localhost:8791/mcp"]);
    expect(meta.scopes_supported).toEqual(["budget", "workout", "health", "food", "offline_access"]);
    expect(meta.registration_endpoint).toBe(`${BASE}/oauth/register`);
  });

  it("asks to sign in first, naming the tool being connected", async () => {
    const { authorizeUrl } = await oauthClient();
    const html = await (await SELF.fetch(authorizeUrl(BUDGET))).text();
    expect(html).toContain("Connecting Quemo Budget");
    expect(html).toContain('name="email"');
  });

  it("issues a token bound to the one tool the user approved", async () => {
    const { userId, cookie } = await signUp();
    const { client_id, verifier, authorizeUrl } = await oauthClient();
    const { html, res } = await consent(authorizeUrl(BUDGET), cookie, "approve");
    expect(html).toContain("Test Chat AI");
    expect(html).toContain("Quemo Budget");
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://chat.example/callback");
    expect(location.searchParams.get("state")).toBe("st4te");

    const tokenRes = await SELF.fetch(`${BASE}/oauth/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: location.searchParams.get("code")!,
        client_id,
        redirect_uri: "https://chat.example/callback",
        code_verifier: verifier,
        resource: BUDGET,
      }),
    });
    const tokens = await tokenRes.json<{ access_token: string; refresh_token: string }>();
    expect(tokens.refresh_token).toBeTruthy();

    expect(await auth.validateToken(BUDGET, tokens.access_token)).toMatchObject({ props: { userId }, audience: BUDGET });
    expect(await auth.validateToken(WORKOUT, tokens.access_token)).toBeNull(); // not valid for another tool

    const dash = await (await SELF.fetch(`${BASE}/dashboard`, { headers: { Cookie: cookie } })).text();
    expect(dash).toContain("1 app linked");
  });

  it("returns access_denied when the user declines", async () => {
    const { cookie } = await signUp();
    const { authorizeUrl } = await oauthClient();
    const { res } = await consent(authorizeUrl(WORKOUT), cookie, "deny");
    expect(new URL(res.headers.get("Location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("rejects unknown resources", async () => {
    const { cookie } = await signUp();
    const { authorizeUrl } = await oauthClient();
    const res = await SELF.fetch(authorizeUrl("https://evil.example/mcp"), { headers: { Cookie: cookie }, redirect: "manual" });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("Location") ?? "").not.toContain("code=");
  });
});

describe("account deletion", () => {
  it("requires the email, then removes the account, keys and tokens", async () => {
    const { cookie, userId, email } = await signUp();
    const html = await (await SELF.fetch(`${BASE}/dashboard/keys`, form({ name: "k" }, { Cookie: cookie }))).text();
    const key = html.match(/qmk_[A-Za-z0-9_-]{20,}/)![0];

    const wrong = await (await SELF.fetch(`${BASE}/dashboard/delete`, form({ confirm: "nope@x.y" }, { Cookie: cookie }))).text();
    expect(wrong).toContain("account was not deleted");
    expect(await auth.getProfile(userId)).not.toBeNull();

    await SELF.fetch(`${BASE}/dashboard/delete`, form({ confirm: email }, { Cookie: cookie }));
    expect(await auth.getProfile(userId)).toBeNull();
    expect(await auth.validateToken(BUDGET, key)).toBeNull();
    expect(await auth.deletedUsersSince(Date.now() - 60_000)).toContain(userId);
  });
});
