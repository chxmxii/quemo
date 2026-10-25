/** Test helpers shared by the tool Workers' vitest suites (not bundled into Workers). */
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import type { AuthService, Profile, ToolContext, ToolEnv } from "./types";

export const TEST_USER: Profile = {
  id: "user-1",
  email: "rider@quemo.test",
  name: "Rider",
  timezone: "Europe/Berlin",
  currency: "EUR",
  units: "metric",
};

/** In-process stand-in for the quemo-auth RPC binding. */
export function fakeAuth(user: Profile = TEST_USER, deleted: string[] = []): AuthService {
  return {
    async validateToken(resource, token) {
      return token === "good-token"
        ? { props: { userId: user.id, email: user.email }, audience: resource, expiresAt: Math.floor(Date.now() / 1000) + 3600, scope: [], userId: user.id, clientId: "test" }
        : null;
    },
    async getProfile(id) {
      return id === user.id ? { ...user } : null;
    },
    async updateProfile(_id, patch) {
      Object.assign(user, patch);
      return { ...user };
    },
    async deletedUsersSince() {
      return deleted;
    },
  };
}

export function testContext<E extends ToolEnv>(env: Omit<E, "AUTH" | "PUBLIC_URL" | "AUTH_URL"> & Partial<ToolEnv>, user: Profile = { ...TEST_USER }): ToolContext<E> {
  return {
    env: { PUBLIC_URL: "http://localhost:8788", AUTH_URL: "http://localhost:8787", AUTH: fakeAuth(user), ...env } as E,
    user,
  };
}

export interface Caller {
  client: Client;
  /** Calls a tool; returns parsed JSON when the result is JSON, else the raw text. Throws on tool errors. */
  call<T = any>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Calls a tool expecting an error; returns the error text. */
  callError(name: string, args?: Record<string, unknown>): Promise<string>;
  text(name: string, args?: Record<string, unknown>): Promise<string>;
}

export async function connect(server: McpServer): Promise<Caller> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "quemo-test", version: "1.0.0" });
  await client.connect(clientTransport);

  const raw = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text?: string }[]; isError?: boolean };
    return { text: res.content.map((c) => c.text ?? "").join("\n"), isError: !!res.isError };
  };
  const parse = (t: string) => {
    const start = t.search(/[[{]/);
    try {
      return start >= 0 ? JSON.parse(t.slice(start)) : t;
    } catch {
      return t;
    }
  };
  return {
    client,
    async call(name, args) {
      const r = await raw(name, args);
      if (r.isError) throw new Error(`${name} failed: ${r.text}`);
      return parse(r.text);
    },
    async callError(name, args) {
      const r = await raw(name, args);
      if (!r.isError) throw new Error(`${name} unexpectedly succeeded: ${r.text}`);
      return r.text;
    },
    async text(name, args) {
      const r = await raw(name, args);
      if (r.isError) throw new Error(`${name} failed: ${r.text}`);
      return r.text;
    },
  };
}
