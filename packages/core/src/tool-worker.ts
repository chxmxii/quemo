import { OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp";
import { loadReport, reportToHtml } from "./report";
import { htmlResponse, layout } from "./theme";
import { TOOLS, type ToolContext, type ToolEnv, type ToolId, type UserProps } from "./types";

export interface ToolDefinition<E extends ToolEnv> {
  id: ToolId;
  build(ctx: ToolContext<E>): McpServer;
  /** Tables holding per-user rows (column user_id), purged when an account is deleted. */
  userTables: string[];
}

const PURGE_WINDOW = 7 * 24 * 3600 * 1000;

/**
 * Turns a tool definition into a Worker:
 *  - /mcp           OAuth-protected MCP endpoint (tokens validated by quemo-auth over the AUTH binding)
 *  - /reports/:id   printable report pages (unguessable, expiring links)
 *  - /              redirects to the Quemo dashboard
 *  - scheduled()    purges data of accounts deleted in quemo-auth
 */
export function createToolWorker<E extends ToolEnv>(def: ToolDefinition<E>) {
  let resourceServer: OAuthResourceServer<E, UserProps> | undefined;

  const getResourceServer = (env: E) =>
    (resourceServer ??= new OAuthResourceServer<E, UserProps>({
      resourceMetadata: {
        resource: `${env.PUBLIC_URL.replace(/\/$/, "")}/mcp`,
        authorization_servers: [env.AUTH_URL.replace(/\/$/, "")],
        resource_name: TOOLS[def.id].name,
      },
      requiredScopes: [TOOLS[def.id].scope],
      validateToken: (env) => (resource, token) => env.AUTH.validateToken(resource, token),
      handler: {
        async fetch(request, env, ctx) {
          const user = await env.AUTH.getProfile(ctx.props.userId);
          if (!user) return new Response("Account not found", { status: 401 });
          const handler = createMcpHandler(() => def.build({ env, user }), { route: "/mcp" });
          return handler(request, env, ctx);
        },
      },
    }));

  return {
    async fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/") return Response.redirect(`${env.AUTH_URL.replace(/\/$/, "")}/dashboard`, 302);
      if (url.pathname === "/health") return new Response("ok");
      const report = url.pathname.match(/^\/reports\/([a-f0-9]{40})$/);
      if (report && request.method === "GET") {
        const r = await loadReport(env.DB, report[1]);
        return r
          ? htmlResponse(reportToHtml(r))
          : htmlResponse(layout({ title: "Report not found", body: `<h1>Report expired</h1><p class="muted">Ask your assistant to generate a new one.</p>` }), 404);
      }
      return getResourceServer(env).fetch(request, env, ctx);
    },

    async scheduled(_controller: ScheduledController, env: E): Promise<void> {
      await purgeDeletedUsers(env, def.userTables);
    },
  };
}

export async function purgeDeletedUsers(env: ToolEnv, tables: string[]): Promise<number> {
  const ids = await env.AUTH.deletedUsersSince(Date.now() - PURGE_WINDOW);
  if (!ids.length) return 0;
  const statements = ids.flatMap((uid) =>
    [...tables, "reports"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(uid)),
  );
  await env.DB.batch(statements);
  return ids.length;
}
