import { env, SELF } from "cloudflare:test";
import { purgeDeletedUsers } from "@quemo/core";
import { describe, expect, it } from "vitest";

const BASE = "http://localhost:8789";

async function rpc(method: string, params: unknown, token = "good-token") {
  const res = await SELF.fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      Host: "localhost:8789",
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
    expect(res.headers.get("WWW-Authenticate")).toMatch(/resource_metadata="http:\/\/localhost:8789\/\.well-known\/oauth-protected-resource\/mcp".*scope="workout"/);
    const meta = await (await SELF.fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json<any>();
    expect(meta).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: ["http://localhost:8787"], scopes_supported: ["workout"] });
  });

  it("rejects a bad token", async () => {
    expect((await rpc("tools/list", {}, "nope")).status).toBe(401);
  });

  it("serves MCP tools to a valid token (validated by quemo-auth over RPC)", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.json.result.serverInfo.name).toBe("quemo-workout");
    expect(init.json.result.instructions).toMatch(/bench 4x8 at 70/);
    const tools = await rpc("tools/list", {});
    const names = tools.json.result.tools.map((t: any) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "log_workout",
        "add_sets",
        "list_workouts",
        "get_workout",
        "update_workout",
        "delete_workout",
        "delete_set",
        "list_exercises",
        "personal_records",
        "exercise_progress",
        "create_routine",
        "list_routines",
        "delete_routine",
        "start_routine_workout",
        "log_body_metric",
        "body_metrics_history",
        "set_goal",
        "list_goals",
        "delete_goal",
        "follow_up",
        "generate_report",
        "get_profile",
        "update_profile",
      ]),
    );
    const logged = await rpc("tools/call", { name: "log_workout", arguments: { name: "Push day", exercises: [{ exercise: "Bench Press", sets: [{ reps: 8, weight: 70, count: 4 }] }] } });
    expect(logged.json.result.content[0].text).toMatch(/Logged Push day on \d{4}-\d{2}-\d{2}: 1 exercise, 4 working sets, 2,240 kg volume\./);
  });

  it("serves printable reports and 404s unknown ones", async () => {
    const report = await rpc("tools/call", { name: "generate_report", arguments: { period: "this_month" } });
    const url = report.json.result.content[0].text.match(/http:\/\/localhost:8789\/reports\/[a-f0-9]{40}/)[0];
    const page = await SELF.fetch(url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Workout Report");
    expect(html).toContain("Training volume by muscle group");
    expect((await SELF.fetch(`${BASE}/reports/${"0".repeat(40)}`)).status).toBe(404);
  });

  it("redirects the root to the Quemo dashboard", async () => {
    const res = await SELF.fetch(`${BASE}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://localhost:8787/dashboard");
  });

  it("purges deleted users via the auth service", async () => {
    await env.DB.prepare("INSERT INTO exercises (id, user_id, name, type, created_at) VALUES ('e-del', 'deleted-user', 'X', 'strength', 0)").run();
    await env.DB.prepare("INSERT INTO workouts (id, user_id, name, date, created_at) VALUES ('w-del', 'deleted-user', 'X', '2026-01-01', 0)").run();
    expect(await purgeDeletedUsers(env, ["workout_sets", "workouts", "exercises"])).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM exercises WHERE user_id = 'deleted-user'").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id = 'deleted-user'").first("n")).toBe(0);
  });
});
