import { OAuthAuthorizationServer, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { TOOLS, type Profile, type ToolId, type Units } from "@quemo/core";

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  PUBLIC_URL: string;
  BUDGET_URL: string;
  WORKOUT_URL: string;
  HEALTH_URL: string;
  FOOD_URL: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  // Service bindings to the tool Workers, used when a tool is served under a path of this origin (/finance/mcp…).
  BUDGET_SVC?: Fetcher;
  WORKOUT_SVC?: Fetcher;
  HEALTH_SVC?: Fetcher;
  FOOD_SVC?: Fetcher;
}

const SERVICES: Record<ToolId, "BUDGET_SVC" | "WORKOUT_SVC" | "HEALTH_SVC" | "FOOD_SVC"> = {
  budget: "BUDGET_SVC",
  workout: "WORKOUT_SVC",
  health: "HEALTH_SVC",
  food: "FOOD_SVC",
};

/**
 * Gateway routing: when a tool's public URL is a path on this origin (e.g. BUDGET_URL = https://quemo-auth…/finance),
 * requests under that path, and its RFC 9728 metadata path, belong to that tool.
 */
export function gatewayTarget(env: Env, url: URL): ToolId | undefined {
  for (const tool of TOOL_IDS) {
    const t = new URL(toolUrls(env)[tool]);
    const base = t.pathname.replace(/\/$/, "");
    if (t.origin !== url.origin || !base) continue;
    const p = url.pathname;
    if (p === base || p.startsWith(`${base}/`) || p === `/.well-known/oauth-protected-resource${base}/mcp`) return tool;
  }
  return undefined;
}

export function gatewayFetch(env: Env, tool: ToolId, request: Request): Promise<Response> | Response {
  const svc = env[SERVICES[tool]];
  return svc ? svc.fetch(request) : new Response(`${tool} is not bound to the gateway`, { status: 502 });
}

export const TOOL_IDS: ToolId[] = ["budget", "workout", "health", "food"];
export const API_KEY_PREFIX = "qmk_";

const trim = (u: string) => u.replace(/\/$/, "");
export const issuer = (env: Env) => trim(env.PUBLIC_URL);

export function toolUrls(env: Env): Record<ToolId, string> {
  return { budget: trim(env.BUDGET_URL), workout: trim(env.WORKOUT_URL), health: trim(env.HEALTH_URL), food: trim(env.FOOD_URL) };
}

/** MCP endpoint (= OAuth resource) of each tool. */
export const mcpUrl = (env: Env, tool: ToolId) => `${toolUrls(env)[tool]}/mcp`;

export function toolForResource(env: Env, resource: string | undefined): ToolId | undefined {
  return TOOL_IDS.find((t) => mcpUrl(env, t).toLowerCase() === resource?.toLowerCase());
}

// Resources are fixed at construction and depend on env vars, so the server is built on first use.
let server: OAuthAuthorizationServer<Env> | undefined;

export function authServer(env: Env): OAuthAuthorizationServer<Env> {
  return (server ??= new OAuthAuthorizationServer<Env>({
    issuer: issuer(env),
    resources: TOOL_IDS.map((t) => mcpUrl(env, t)),
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...TOOL_IDS.map((t) => TOOLS[t].scope), "offline_access"],
    refreshTokenTTL: 90 * 24 * 3600,
  }));
}

export const oauth = (env: Env): OAuthHelpers => authServer(env).getOAuthApi(env);

export const now = () => Date.now();

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Only same-origin relative redirects ("/path?x"), never "//evil.com". */
export const safeNext = (next: string | null | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  currency: string;
  units: Units;
}

export async function getProfile(env: Env, userId: string): Promise<Profile | null> {
  const row = await env.DB.prepare("SELECT id, email, name, timezone, currency, units FROM users WHERE id = ?").bind(userId).first<UserRow>();
  return row ? { ...row } : null;
}
