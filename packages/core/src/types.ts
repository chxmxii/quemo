import type { ValidatedAccessToken } from "@cloudflare/workers-oauth-provider";

export type ToolId = "budget" | "workout" | "health" | "food";

/** Stored in every OAuth grant / API key and handed to tool Workers as ctx.props. */
export interface UserProps {
  userId: string;
  email: string;
}

export type Units = "metric" | "imperial";

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  currency: string;
  units: Units;
}

export type ProfilePatch = Partial<Pick<Profile, "name" | "timezone" | "currency" | "units">>;

/** RPC surface of the quemo-auth Worker, reached from tool Workers through the AUTH service binding. */
export interface AuthService {
  validateToken(resource: string, token: string): Promise<ValidatedAccessToken<UserProps> | null>;
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<Profile | null>;
  deletedUsersSince(sinceMs: number): Promise<string[]>;
}

export interface ToolEnv {
  DB: D1Database;
  AUTH: AuthService;
  /** Public origin of this tool Worker, e.g. https://quemo-budget.example.workers.dev */
  PUBLIC_URL: string;
  /** Public origin of quemo-auth. */
  AUTH_URL: string;
}

export interface ToolContext<E extends ToolEnv = ToolEnv> {
  env: E;
  user: Profile;
}

export const TOOLS: Record<ToolId, { name: string; tagline: string; scope: ToolId }> = {
  budget: { name: "Quemo Budget", tagline: "Money in, money out, budgets, bills and savings goals", scope: "budget" },
  workout: { name: "Quemo Workout", tagline: "Gym sessions, sets, PRs, routines and body metrics", scope: "workout" },
  health: { name: "Quemo Health", tagline: "Medications, doses, vitals, symptoms and appointments", scope: "health" },
  food: { name: "Quemo Food", tagline: "Meals, macros, water and nutrition goals", scope: "food" },
};
