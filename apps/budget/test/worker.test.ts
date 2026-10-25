import { env, SELF } from "cloudflare:test";
import { purgeDeletedUsers } from "@quemo/core";
import { describe, expect, it } from "vitest";

const BASE = "http://localhost:8788";

async function rpc(method: string, params: unknown, token = "good-token") {
  const res = await SELF.fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      Host: "localhost:8788",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  return { status: res.status, json: data ? JSON.parse(data.slice(6)) : body ? JSON.parse(body) : null };
}

describe("worker over HTTP", () => {
  it("challenges unauthenticated MCP requests with OAuth discovery info", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/resource_metadata="http:\/\/localhost:8788\/\.well-known\/oauth-protected-resource\/mcp".*scope="budget"/);
    const meta = await (await SELF.fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json<any>();
    expect(meta).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: ["http://localhost:8787"], scopes_supported: ["budget"] });
  });

  it("rejects a bad token", async () => {
    expect((await rpc("tools/list", {}, "nope")).status).toBe(401);
  });

  it("serves MCP tools to a valid token (validated by quemo-auth over RPC)", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.json.result.serverInfo.name).toBe("quemo-budget");
    const tools = await rpc("tools/list", {});
    const names = tools.json.result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["add_transaction", "budget_status", "follow_up", "generate_report", "get_profile", "update_profile"]));
    const added = await rpc("tools/call", { name: "add_transaction", arguments: { amount: 9.99, category: "Music" } });
    expect(added.json.result.content[0].text).toMatch(/Logged expense of €9\.99 in Music/);
  });

  it("serves printable reports and 404s unknown ones", async () => {
    const report = await rpc("tools/call", { name: "generate_report", arguments: { period: "this_month" } });
    const url = report.json.result.content[0].text.match(/http:\/\/localhost:8788\/reports\/[a-f0-9]{40}/)[0];
    const page = await SELF.fetch(url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Budget Report");
    expect(html).toContain("Spending by category");
    expect((await SELF.fetch(`${BASE}/reports/${"0".repeat(40)}`)).status).toBe(404);
  });

  it("redirects the root to the Quemo dashboard", async () => {
    const res = await SELF.fetch(`${BASE}/`, { redirect: "manual" });
    expect(res.headers.get("Location")).toBe("http://localhost:8787/dashboard");
  });

  it("purges deleted users via the auth service", async () => {
    await env.DB.prepare("INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('c-del', 'deleted-user', 'X', 'expense', 0)").run();
    expect(await purgeDeletedUsers(env, ["categories"])).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM categories WHERE user_id = 'deleted-user'").first("n")).toBe(0);
  });
});
