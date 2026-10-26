import type { ValidatedAccessToken } from "@cloudflare/workers-oauth-provider";
import type { AuthService, Profile, ProfilePatch, UserProps } from "@quemo/core";
import { isValidTimezone } from "@quemo/core";
import { WorkerEntrypoint } from "cloudflare:workers";
import { API_KEY_PREFIX, authServer, gatewayFetch, gatewayTarget, getProfile, now, sha256, TOOL_IDS, toolForResource, type Env } from "./lib";
import { handleWeb } from "./web";

/**
 * quemo-auth: the one place users register (email-only), approve AI apps and manage API keys.
 * Tool Workers reach the RPC methods below through their AUTH service binding.
 */
export default class QuemoAuth extends WorkerEntrypoint<Env> implements AuthService {
  async fetch(request: Request): Promise<Response> {
    const tool = gatewayTarget(this.env, new URL(request.url));
    if (tool) return gatewayFetch(this.env, tool, request);
    return (await handleWeb(request, this.env)) ?? authServer(this.env).fetch(request, this.env, this.ctx);
  }

  /** Validates an OAuth access token or a personal API key for one tool's MCP resource. */
  async validateToken(resource: string, token: string): Promise<ValidatedAccessToken<UserProps> | null> {
    if (token.startsWith(API_KEY_PREFIX)) return validateApiKey(this.env, resource, token);
    return authServer(this.env).validateToken(resource, token, this.env) as Promise<ValidatedAccessToken<UserProps> | null>;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    return getProfile(this.env, userId);
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<Profile | null> {
    const current = await getProfile(this.env, userId);
    if (!current) return null;
    const next = { ...current };
    if (patch.name !== undefined) next.name = patch.name?.trim().slice(0, 80) || null;
    if (patch.timezone && isValidTimezone(patch.timezone)) next.timezone = patch.timezone;
    if (patch.currency && /^[A-Za-z]{3}$/.test(patch.currency)) next.currency = patch.currency.toUpperCase();
    if (patch.units === "metric" || patch.units === "imperial") next.units = patch.units;
    await this.env.DB.prepare("UPDATE users SET name = ?, timezone = ?, currency = ?, units = ? WHERE id = ?")
      .bind(next.name, next.timezone, next.currency, next.units, userId)
      .run();
    return next;
  }

  async deletedUsersSince(sinceMs: number): Promise<string[]> {
    const { results } = await this.env.DB.prepare("SELECT user_id FROM deleted_users WHERE deleted_at >= ?").bind(sinceMs).all<{ user_id: string }>();
    return results.map((r) => r.user_id);
  }
}

export async function validateApiKey(env: Env, resource: string, token: string): Promise<ValidatedAccessToken<UserProps> | null> {
  if (!toolForResource(env, resource)) return null;
  const row = await env.DB.prepare(
    `SELECT k.id, u.id AS user_id, u.email FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
  )
    .bind(await sha256(token))
    .first<{ id: string; user_id: string; email: string }>();
  if (!row) return null;
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now(), row.id).run();
  return {
    props: { userId: row.user_id, email: row.email },
    audience: resource,
    expiresAt: Math.floor(now() / 1000) + 300,
    scope: [...TOOL_IDS],
    userId: row.user_id,
    clientId: `api-key:${row.id}`,
  };
}
