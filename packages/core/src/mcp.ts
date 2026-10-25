import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isValidTimezone, localDate, localTime } from "./dates";
import type { ToolContext } from "./types";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** JSON result, optionally preceded by a one-line human summary the assistant can echo. */
export function ok(data: unknown, summary?: string): ToolResult {
  const json = JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: summary ? `${summary}\n\n${json}` : json }] };
}

export const text = (body: string): ToolResult => ({ content: [{ type: "text", text: body }] });

export const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

export const id = () => crypto.randomUUID();

export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Creates the MCP server for one tool with shared instructions and the profile tools every tool exposes. */
export function createToolServer(ctx: ToolContext, info: { name: string; instructions: string }): McpServer {
  const { user } = ctx;
  const server = new McpServer(
    { name: info.name, version: "1.0.0" },
    {
      instructions: `${info.instructions}

The user is ${user.name ?? user.email}; time zone ${user.timezone}, currency ${user.currency}, ${user.units} units. "Today" is ${localDate(user.timezone)} (${localTime(user.timezone)} local). Dates are YYYY-MM-DD.
When the user asks for a follow-up / check-in, call the follow_up tool. When they ask for a report or summary, call generate_report and show its Markdown as-is, including the printable link.`,
    },
  );

  server.registerTool(
    "get_profile",
    {
      title: "Get profile",
      description: "The user's Quemo profile (name, email, time zone, currency, units) shared by all Quemo tools.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => ok({ ...user, today: localDate(user.timezone), local_time: localTime(user.timezone) }),
  );

  server.registerTool(
    "update_profile",
    {
      title: "Update profile",
      description: "Change name, time zone (IANA, e.g. Europe/Berlin), currency (ISO code) or units (metric/imperial). Applies to every Quemo tool.",
      inputSchema: z.object({
        name: z.string().min(1).max(80).optional(),
        timezone: z.string().optional(),
        currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
        units: z.enum(["metric", "imperial"]).optional(),
      }),
    },
    async (patch) => {
      if (patch.timezone && !isValidTimezone(patch.timezone)) return { content: [{ type: "text", text: `Unknown time zone: ${patch.timezone}` }], isError: true };
      const updated = await ctx.env.AUTH.updateProfile(user.id, { ...patch, currency: patch.currency?.toUpperCase() });
      if (updated) Object.assign(user, updated);
      return ok(updated, "Profile updated.");
    },
  );

  return server;
}
