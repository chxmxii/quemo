import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { gatewayFetch, gatewayTarget, type Env } from "../src/lib";

const A = "https://quemo-auth.example.dev";
const pathEnv = { ...env, PUBLIC_URL: A, BUDGET_URL: `${A}/finance`, WORKOUT_URL: `${A}/workout`, HEALTH_URL: `${A}/health`, FOOD_URL: `${A}/food` } as Env;

describe("path gateway", () => {
  it("routes each tool path, its subpaths and its OAuth metadata to that tool", () => {
    expect(gatewayTarget(pathEnv, new URL(`${A}/finance/mcp`))).toBe("budget");
    expect(gatewayTarget(pathEnv, new URL(`${A}/finance/reports/abc`))).toBe("budget");
    expect(gatewayTarget(pathEnv, new URL(`${A}/.well-known/oauth-protected-resource/health/mcp`))).toBe("health");
    expect(gatewayTarget(pathEnv, new URL(`${A}/workout`))).toBe("workout");
  });

  it("leaves the sign-in service's own pages alone", () => {
    for (const p of ["/", "/dashboard", "/authorize", "/oauth/token", "/.well-known/oauth-authorization-server", "/financeX/mcp", "/foodie"]) {
      expect(gatewayTarget(pathEnv, new URL(`${A}${p}`))).toBeUndefined();
    }
  });

  it("is inactive when tools have their own origins (local dev)", () => {
    expect(gatewayTarget(env as unknown as Env, new URL("http://localhost:8787/budget/mcp"))).toBeUndefined();
  });

  it("forwards the original request to the tool Worker", async () => {
    const res = await gatewayFetch(pathEnv, "food", new Request(`${A}/food/mcp`, { method: "POST" }));
    expect(await res.text()).toBe("food:/food/mcp");
  });
});
