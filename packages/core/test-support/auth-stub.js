// Minimal stand-in for quemo-auth used by tool Workers' integration tests.
import { WorkerEntrypoint } from "cloudflare:workers";

const USER = { id: "http-user", email: "http@quemo.test", name: "Http", timezone: "Europe/Berlin", currency: "EUR", units: "metric" };

export default class AuthStub extends WorkerEntrypoint {
  fetch() {
    return new Response("auth stub");
  }
  async validateToken(resource, token) {
    if (token !== "good-token") return null;
    return { props: { userId: USER.id, email: USER.email }, audience: resource, expiresAt: Math.floor(Date.now() / 1000) + 3600, scope: [], userId: USER.id, clientId: "stub" };
  }
  async getProfile(id) {
    return id === USER.id ? { ...USER } : null;
  }
  async updateProfile(id, patch) {
    return id === USER.id ? { ...USER, ...patch } : null;
  }
  async deletedUsersSince() {
    return ["deleted-user"];
  }
}
