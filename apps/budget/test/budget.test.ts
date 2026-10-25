import { env } from "cloudflare:test";
import { addDays, localDate, purgeDeletedUsers } from "@quemo/core";
import { connect, fakeAuth, TEST_USER, testContext, type Caller } from "@quemo/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer, nextDue, type Env } from "../src/server";

let n = 0;
async function newUser(): Promise<{ mcp: Caller; userId: string }> {
  const userId = `budget-user-${++n}-${crypto.randomUUID()}`;
  const ctx = testContext<Env>({ DB: env.DB }, { ...TEST_USER, id: userId });
  return { mcp: await connect(buildServer(ctx)), userId };
}

const today = () => localDate("Europe/Berlin");
const month = () => today().slice(0, 7);

describe("transactions", () => {
  let mcp: Caller;
  beforeEach(async () => ({ mcp } = await newUser()));

  it("logs an expense and auto-creates its category", async () => {
    const tx = await mcp.call("add_transaction", { amount: 12.5, category: "Groceries", merchant: "Rewe", tags: ["Food", "weekly"] });
    expect(tx).toMatchObject({ kind: "expense", amount: 12.5, category: "Groceries", merchant: "Rewe", date: today(), tags: ["food", "weekly"] });
    const cats = await mcp.call("list_categories");
    expect(cats).toEqual([{ name: "Groceries", kind: "expense", monthly_budget: null, transactions: 1 }]);
  });

  it("matches category names case-insensitively", async () => {
    await mcp.call("add_transaction", { amount: 5, category: "Coffee" });
    await mcp.call("add_transaction", { amount: 3, category: "coffee" });
    const cats = await mcp.call("list_categories");
    expect(cats).toHaveLength(1);
    expect(cats[0].transactions).toBe(2);
  });

  it("stores cents exactly", async () => {
    for (const amount of [0.1, 0.2, 0.3]) await mcp.call("add_transaction", { amount, category: "Snacks" });
    const s = await mcp.call("spending_summary", { period: "this_month" });
    expect(s.total).toBe(0.6);
  });

  it("filters, updates and deletes", async () => {
    await mcp.call("add_transaction", { amount: 40, category: "Fuel", merchant: "Shell", date: addDays(today(), -1) });
    const lidl = await mcp.call("add_transaction", { amount: 20, category: "Groceries", merchant: "Lidl", description: "weekly shop" });
    await mcp.call("add_transaction", { amount: 2000, kind: "income", category: "Salary" });

    expect((await mcp.call("list_transactions", { period: "last_30_days", search: "weekly" })).count).toBe(1);
    expect((await mcp.call("list_transactions", { period: "last_30_days", kind: "income" })).transactions[0].amount).toBe(2000);
    expect((await mcp.call("list_transactions", { period: "last_30_days", min_amount: 30, max_amount: 100 })).transactions[0].merchant).toBe("Shell");

    const updated = await mcp.call("update_transaction", { id: lidl.id, amount: 25, category: "Household" });
    expect(updated).toMatchObject({ amount: 25, category: "Household", merchant: "Lidl" });

    await mcp.call("delete_transaction", { id: lidl.id });
    expect(await mcp.callError("delete_transaction", { id: lidl.id })).toMatch(/not found/);
  });

  it("bulk-adds transactions", async () => {
    const res = await mcp.call("add_transactions", {
      transactions: [
        { amount: 3.2, category: "Groceries", description: "milk" },
        { amount: 1.1, category: "Groceries", description: "bread" },
        { amount: 50, kind: "income", category: "Gift" },
      ],
    });
    expect(res.added).toBe(3);
  });

  it("rejects invalid input", async () => {
    await expect(mcp.call("add_transaction", { amount: -5, category: "X" })).rejects.toThrow();
    await expect(mcp.call("add_transaction", { amount: 5, category: "X", date: "25/10/2026" })).rejects.toThrow();
    expect(await mcp.callError("add_transaction", { amount: 5, kind: "transfer", account: "Cash" })).toMatch(/to_account/);
  });
});

describe("accounts and transfers", () => {
  it("tracks balances across income, expenses and transfers", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_account", { name: "Checking", opening_balance: 1000 });
    await mcp.call("add_account", { name: "Savings", type: "savings" });
    await mcp.call("add_transaction", { amount: 2500, kind: "income", category: "Salary", account: "Checking" });
    await mcp.call("add_transaction", { amount: 100, category: "Groceries", account: "Checking" });
    await mcp.call("add_transaction", { amount: 500, kind: "transfer", account: "Checking", to_account: "Savings" });
    const accounts = await mcp.call("list_accounts");
    expect(accounts).toEqual([
      { name: "Checking", type: "checking", balance: 2900 },
      { name: "Savings", type: "savings", balance: 500 },
    ]);
    // transfers are neither income nor expense
    const status = await mcp.call("budget_status");
    expect(status).toMatchObject({ income: 2500, expense: 100, net: 2400 });
  });
});

describe("budgets", () => {
  it("reports usage, overspending and month overrides", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_budget", { category: "Groceries", amount: 100 });
    await mcp.call("set_budget", { category: "Fun", amount: 50 });
    await mcp.call("set_budget", { category: "Fun", amount: 80, month: month() });
    await mcp.call("add_transaction", { amount: 107.35, category: "Groceries" });
    await mcp.call("add_transaction", { amount: 20, category: "Fun" });

    const s = await mcp.call("budget_status");
    const groceries = s.categories.find((c: any) => c.category === "Groceries");
    const fun = s.categories.find((c: any) => c.category === "Fun");
    expect(groceries).toMatchObject({ budget: 100, spent: 107.35, remaining: -7.35, percent_used: 107, over_budget: true });
    expect(fun).toMatchObject({ budget: 80, spent: 20, over_budget: false });
    expect(s.projected_expense).toBeGreaterThanOrEqual(127.35);

    await mcp.call("set_budget", { category: "Fun", amount: 0, month: month(), remove: true });
    const after = await mcp.call("budget_status");
    expect(after.categories.find((c: any) => c.category === "Fun").budget).toBe(50);
  });

  it("merges categories on rename", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_transaction", { amount: 10, category: "Supermarket" });
    await mcp.call("add_transaction", { amount: 5, category: "Groceries" });
    await mcp.call("rename_category", { from: "Supermarket", to: "Groceries" });
    const cats = await mcp.call("list_categories");
    expect(cats).toEqual([expect.objectContaining({ name: "Groceries", transactions: 2 })]);
  });
});

describe("recurring bills", () => {
  it("computes next due dates", () => {
    expect(nextDue("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDue("2026-10-25", "weekly")).toBe("2026-11-01");
    expect(nextDue("2026-11-15", "quarterly")).toBe("2027-02-15");
    expect(nextDue("2024-02-29", "yearly")).toBe("2025-02-28");
  });

  it("shows due bills in follow-up and logs them when paid", async () => {
    const { mcp } = await newUser();
    const rent = await mcp.call("add_recurring", { name: "Rent", amount: 950, category: "Housing", next_due: addDays(today(), 2) });
    await mcp.call("add_recurring", { name: "Netflix", amount: 12.99, next_due: addDays(today(), -1) });
    await mcp.call("add_recurring", { name: "Insurance", amount: 300, frequency: "yearly", next_due: addDays(today(), 90) });

    const list = await mcp.call("list_recurring");
    expect(list.items).toHaveLength(3);
    expect(list.monthly_fixed_costs).toBeCloseTo(950 + 12.99 + 25, 1);

    const f = await mcp.call("follow_up");
    expect(f.bills_due.map((b: any) => b.name).sort()).toEqual(["Netflix", "Rent"]);
    expect(f.bills_due.find((b: any) => b.name === "Netflix").overdue).toBe(true);
    expect(f.nudges.join(" ")).toMatch(/Netflix is overdue/);

    const paid = await mcp.call("mark_recurring_paid", { id: rent.id });
    expect(paid.next_due).toBe(nextDue(addDays(today(), 2), "monthly"));
    const txs = await mcp.call("list_transactions", { category: "Housing" });
    expect(txs.transactions[0]).toMatchObject({ amount: 950, description: "Rent" });

    await mcp.call("update_recurring", { id: rent.id, active: false });
    expect((await mcp.call("list_recurring")).items).toHaveLength(2);
  });
});

describe("savings goals", () => {
  it("tracks contributions and monthly need", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_savings_goal", { name: "Vacation", target: 1200, deadline: addDays(today(), 365) });
    const g = await mcp.call("contribute_to_goal", { goal: "vacation", amount: 300 });
    expect(g).toMatchObject({ name: "Vacation", saved: 300, remaining: 900, percent: 25 });
    expect(g.monthly_needed).toBeGreaterThan(60);
    expect(g.monthly_needed).toBeLessThan(80);
    await mcp.call("contribute_to_goal", { goal: "Vacation", amount: -1000 });
    expect((await mcp.call("list_savings_goals"))[0].saved).toBe(0);
    expect(await mcp.callError("contribute_to_goal", { goal: "Car", amount: 5 })).toMatch(/No savings goal/);
  });
});

describe("summaries, follow-up and reports", () => {
  it("groups spending by merchant, tag and month", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_transaction", { amount: 10, category: "Food", merchant: "Rewe", tags: ["home"] });
    await mcp.call("add_transaction", { amount: 15, category: "Food", merchant: "Rewe", tags: ["home", "party"] });
    await mcp.call("add_transaction", { amount: 30, category: "Fun", merchant: "Cinema", tags: ["party"] });
    const byMerchant = await mcp.call("spending_summary", { group_by: "merchant" });
    expect(byMerchant.rows[0]).toMatchObject({ merchant: "Cinema", total: 30 });
    expect(byMerchant.rows[1]).toMatchObject({ merchant: "Rewe", total: 25, count: 2 });
    const byTag = await mcp.call("spending_summary", { group_by: "tag" });
    expect(byTag.rows).toEqual([
      expect.objectContaining({ tag: "party", total: 45 }),
      expect.objectContaining({ tag: "home", total: 25 }),
    ]);
  });

  it("nudges a brand-new user", async () => {
    const { mcp } = await newUser();
    const f = await mcp.call("follow_up");
    expect(f.nudges.join(" ")).toMatch(/No transactions yet/);
  });

  it("generates an organized report with a printable link", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_budget", { category: "Groceries", amount: 50 });
    await mcp.call("add_transaction", { amount: 80, category: "Groceries", merchant: "Rewe" });
    await mcp.call("add_transaction", { amount: 2000, kind: "income", category: "Salary" });
    await mcp.call("set_savings_goal", { name: "Car", target: 5000, already_saved: 1000 });
    const md = await mcp.text("generate_report", { period: "this_month" });
    for (const heading of ["# Budget Report", "## Spending by category", "## Budgets", "## Income", "## Top merchants", "## Largest expenses", "## Accounts", "## Savings goals"]) {
      expect(md).toContain(heading);
    }
    expect(md).toMatch(/Groceries went over budget/);
    expect(md).toMatch(/You kept 96% of your income/);
    expect(md).toMatch(/http:\/\/localhost:8788\/reports\/[a-f0-9]{40}/);
  });

  it("includes a monthly trend for long periods", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_transaction", { amount: 10, category: "Food", date: addDays(today(), -60) });
    await mcp.call("add_transaction", { amount: 20, category: "Food" });
    const md = await mcp.text("generate_report", { period: "last_90_days" });
    expect(md).toContain("## Monthly trend");
  });
});

describe("isolation and lifecycle", () => {
  it("never shows one user's data to another", async () => {
    const a = await newUser();
    const b = await newUser();
    const tx = await a.mcp.call("add_transaction", { amount: 99, category: "Secret" });
    expect((await b.mcp.call("list_transactions")).count).toBe(0);
    expect(await b.mcp.callError("delete_transaction", { id: tx.id })).toMatch(/not found/);
    expect(await b.mcp.callError("update_transaction", { id: tx.id, amount: 1 })).toMatch(/not found/);
    expect(await b.mcp.call("list_categories")).toEqual([]);
  });

  it("purges data of deleted accounts", async () => {
    const { mcp, userId } = await newUser();
    await mcp.call("add_transaction", { amount: 5, category: "Gone" });
    const removed = await purgeDeletedUsers({ DB: env.DB, AUTH: fakeAuth(TEST_USER, [userId]), PUBLIC_URL: "", AUTH_URL: "" }, [
      "transactions",
      "budgets",
      "recurring",
      "savings_goals",
      "categories",
      "accounts",
    ]);
    expect(removed).toBe(1);
    expect((await mcp.call("list_transactions")).count).toBe(0);
  });

  it("validates profile updates", async () => {
    const { mcp } = await newUser();
    expect(await mcp.callError("update_profile", { timezone: "Mars/Olympus" })).toMatch(/Unknown time zone/);
    const p = await mcp.call("update_profile", { currency: "usd" });
    expect(p.currency).toBe("USD");
  });
});
