import {
  addDays,
  addMonths,
  createToolServer,
  daysBetween,
  fail,
  id,
  localDate,
  monthEnd,
  ok,
  reportResult,
  resolvePeriod,
  zDate,
  zMonth,
  zPeriodInput,
  type ToolContext,
  type ToolEnv,
} from "@quemo/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildReport } from "./report";

export type Env = ToolEnv;
export type Kind = "expense" | "income";
type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

const kind = z.enum(["expense", "income"]);
const amount = z.number().positive().max(1e10);
const name = z.string().trim().min(1).max(60);

export const toCents = (n: number) => Math.round(n * 100);
export const fromCents = (c: number | null | undefined) => (c ?? 0) / 100;

export function money(cents: number | null | undefined, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(fromCents(cents));
  } catch {
    return `${fromCents(cents).toFixed(2)} ${currency}`;
  }
}

export function nextDue(date: string, frequency: Frequency): string {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "yearly":
      return addMonths(date, 12);
  }
}

const normTags = (tags?: string[]) => (tags?.length ? [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].join(",") : null);

export interface TxRow {
  id: string;
  kind: "expense" | "income" | "transfer";
  amount_cents: number;
  category: string | null;
  account: string | null;
  to_account: string | null;
  merchant: string | null;
  description: string | null;
  tags: string | null;
  occurred_on: string;
}

const TX_SELECT = `SELECT t.id, t.kind, t.amount_cents, c.name AS category, a.name AS account, ta.name AS to_account,
  t.merchant, t.description, t.tags, t.occurred_on
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id`;

export function buildServer(ctx: ToolContext<Env>): McpServer {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const cur = () => user.currency;
  const today = () => localDate(user.timezone);

  const server = createToolServer(ctx, {
    name: "quemo-budget",
    instructions:
      "Quemo Budget: personal finance tracker. Amounts are plain positive numbers in the user's currency; the `kind` says whether money comes in or goes out. " +
      "Log spending with add_transaction (categories, accounts and tags are created on the fly, reuse existing names from list_categories when they fit). " +
      "Use add_transactions for several at once (e.g. a receipt or bank statement). Bills/subscriptions/salary go in add_recurring; mark_recurring_paid logs them. " +
      "budget_status answers 'how am I doing this month', follow_up gives a check-in, generate_report a full organized report.",
  });

  const fmtTx = (t: TxRow) => ({
    id: t.id,
    date: t.occurred_on,
    kind: t.kind,
    amount: fromCents(t.amount_cents),
    category: t.category,
    account: t.account,
    ...(t.kind === "transfer" ? { to_account: t.to_account } : {}),
    merchant: t.merchant,
    description: t.description,
    tags: t.tags ? t.tags.split(",") : [],
  });

  async function categoryId(catName: string, k: Kind): Promise<string> {
    const found = await db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = ? AND kind = ?").bind(uid, catName.trim(), k).first<{ id: string }>();
    if (found) return found.id;
    const cid = id();
    await db.prepare("INSERT INTO categories (id, user_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)").bind(cid, uid, catName.trim(), k, Date.now()).run();
    return cid;
  }

  async function accountId(accName: string | undefined | null): Promise<string | null> {
    if (!accName) return null;
    const found = await db.prepare("SELECT id FROM accounts WHERE user_id = ? AND name = ?").bind(uid, accName.trim()).first<{ id: string }>();
    if (found) return found.id;
    const aid = id();
    await db.prepare("INSERT INTO accounts (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").bind(aid, uid, accName.trim(), Date.now()).run();
    return aid;
  }

  const getTx = (txId: string) => db.prepare(`${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`).bind(txId, uid).first<TxRow>();

  const txInput = z.object({
    amount: amount.describe("Positive amount, e.g. 12.5"),
    kind: z.enum(["expense", "income", "transfer"]).default("expense"),
    category: name.optional().describe("e.g. Groceries, Rent, Salary. Not used for transfers. Defaults to 'Other'."),
    description: z.string().max(500).optional(),
    merchant: z.string().max(120).optional().describe("Shop / payee / payer, e.g. Rewe, Netflix, Employer"),
    account: name.optional().describe("Account paid from / received into, e.g. Cash, N26, Visa"),
    to_account: name.optional().describe("Destination account (transfers only)"),
    tags: z.array(z.string().max(30)).max(10).optional(),
    date: zDate.optional().describe("Defaults to today"),
  });

  async function insertTx(a: z.infer<typeof txInput>, recurringId: string | null = null): Promise<string> {
    if (a.kind === "transfer" && (!a.account || !a.to_account)) throw new Error("Transfers need both account and to_account");
    const txId = id();
    await db
      .prepare(
        `INSERT INTO transactions (id, user_id, kind, amount_cents, category_id, account_id, to_account_id, merchant, description, tags, occurred_on, recurring_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        txId,
        uid,
        a.kind,
        toCents(a.amount),
        a.kind === "transfer" ? null : await categoryId(a.category ?? "Other", a.kind),
        await accountId(a.account),
        a.kind === "transfer" ? await accountId(a.to_account) : null,
        a.merchant ?? null,
        a.description ?? null,
        normTags(a.tags),
        a.date ?? today(),
        recurringId,
        Date.now(),
      )
      .run();
    return txId;
  }

  // ---------- transactions ----------

  server.registerTool(
    "add_transaction",
    { title: "Add transaction", description: "Record an expense, income or transfer between accounts.", inputSchema: txInput },
    async (a) => {
      try {
        const tx = fmtTx((await getTx(await insertTx(a)))!);
        return ok(tx, `Logged ${tx.kind} of ${money(toCents(tx.amount), cur())}${tx.category ? ` in ${tx.category}` : ""} on ${tx.date}.`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "add_transactions",
    {
      title: "Add several transactions",
      description: "Record up to 100 transactions at once (receipt lines, bank statement rows…).",
      inputSchema: z.object({ transactions: z.array(txInput).min(1).max(100) }),
    },
    async ({ transactions }) => {
      const ids: string[] = [];
      for (const t of transactions) {
        try {
          ids.push(await insertTx(t));
        } catch (err) {
          return fail(`Stopped after ${ids.length} transactions: ${(err as Error).message}`);
        }
      }
      const total = transactions.reduce((s, t) => s + (t.kind === "income" ? 1 : t.kind === "expense" ? -1 : 0) * toCents(t.amount), 0);
      return ok({ added: ids.length, ids }, `Logged ${ids.length} transactions (net ${money(total, cur())}).`);
    },
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description: "Transactions newest first, filtered by period, kind, category, account, merchant, tag or text.",
      inputSchema: z.object({
        ...zPeriodInput,
        kind: z.enum(["expense", "income", "transfer"]).optional(),
        category: z.string().optional(),
        account: z.string().optional(),
        merchant: z.string().optional(),
        tag: z.string().optional(),
        search: z.string().optional().describe("Substring match on description or merchant"),
        min_amount: z.number().optional(),
        max_amount: z.number().optional(),
        limit: z.number().int().min(1).max(500).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const { results } = await db
        .prepare(
          `${TX_SELECT} WHERE t.user_id = ?1 AND t.occurred_on BETWEEN ?2 AND ?3
             AND (?4 IS NULL OR t.kind = ?4) AND (?5 IS NULL OR c.name = ?5 COLLATE NOCASE)
             AND (?6 IS NULL OR a.name = ?6 COLLATE NOCASE OR ta.name = ?6 COLLATE NOCASE)
             AND (?7 IS NULL OR t.merchant LIKE '%' || ?7 || '%')
             AND (?8 IS NULL OR ',' || t.tags || ',' LIKE '%,' || lower(?8) || ',%')
             AND (?9 IS NULL OR t.description LIKE '%' || ?9 || '%' OR t.merchant LIKE '%' || ?9 || '%')
             AND (?10 IS NULL OR t.amount_cents >= ?10) AND (?11 IS NULL OR t.amount_cents <= ?11)
           ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT ?12`,
        )
        .bind(
          uid,
          r.from,
          r.to,
          a.kind ?? null,
          a.category ?? null,
          a.account ?? null,
          a.merchant ?? null,
          a.tag ?? null,
          a.search ?? null,
          a.min_amount !== undefined ? toCents(a.min_amount) : null,
          a.max_amount !== undefined ? toCents(a.max_amount) : null,
          a.limit,
        )
        .all<TxRow>();
      return ok({ period: r, count: results.length, transactions: results.map(fmtTx) });
    },
  );

  server.registerTool(
    "update_transaction",
    {
      title: "Update transaction",
      description: "Change fields of an existing transaction (id from list_transactions).",
      inputSchema: z.object({
        id: z.string(),
        amount: amount.optional(),
        kind: kind.optional(),
        category: name.optional(),
        account: name.optional(),
        merchant: z.string().max(120).optional(),
        description: z.string().max(500).optional(),
        tags: z.array(z.string().max(30)).max(10).optional(),
        date: zDate.optional(),
      }),
    },
    async (a) => {
      const tx = await getTx(a.id);
      if (!tx) return fail(`Transaction ${a.id} not found`);
      const k = (a.kind ?? tx.kind) as Kind | "transfer";
      const cat = a.category ?? tx.category;
      await db
        .prepare(
          `UPDATE transactions SET kind = ?, amount_cents = ?, category_id = ?, account_id = COALESCE(?, account_id), merchant = ?, description = ?, tags = ?, occurred_on = ?
           WHERE id = ? AND user_id = ?`,
        )
        .bind(
          k,
          a.amount !== undefined ? toCents(a.amount) : tx.amount_cents,
          k !== "transfer" && cat ? await categoryId(cat, k) : null,
          a.account ? await accountId(a.account) : null,
          a.merchant ?? tx.merchant,
          a.description ?? tx.description,
          a.tags ? normTags(a.tags) : tx.tags,
          a.date ?? tx.occurred_on,
          a.id,
          uid,
        )
        .run();
      return ok(fmtTx((await getTx(a.id))!), "Transaction updated.");
    },
  );

  server.registerTool(
    "delete_transaction",
    { title: "Delete transaction", description: "Delete a transaction by id.", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async ({ id: txId }) => {
      const res = await db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").bind(txId, uid).run();
      return res.meta.changes ? ok({ deleted: txId }, "Deleted.") : fail(`Transaction ${txId} not found`);
    },
  );

  // ---------- categories & accounts ----------

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description: "Categories with their default monthly budget and how often they're used.",
      inputSchema: z.object({ kind: kind.optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ kind: k }) => {
      const { results } = await db
        .prepare(
          `SELECT c.name, c.kind, b.amount_cents AS budget_cents, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS uses
           FROM categories c LEFT JOIN budgets b ON b.category_id = c.id AND b.month = '*'
           WHERE c.user_id = ?1 AND (?2 IS NULL OR c.kind = ?2) ORDER BY c.kind, uses DESC, c.name`,
        )
        .bind(uid, k ?? null)
        .all<{ name: string; kind: Kind; budget_cents: number | null; uses: number }>();
      return ok(results.map((r) => ({ name: r.name, kind: r.kind, monthly_budget: r.budget_cents === null ? null : fromCents(r.budget_cents), transactions: r.uses })));
    },
  );

  server.registerTool(
    "rename_category",
    {
      title: "Rename or merge category",
      description: "Rename a category. If the new name already exists, the two are merged (transactions and budgets move over).",
      inputSchema: z.object({ from: name, to: name, kind: kind.default("expense") }),
    },
    async (a) => {
      const src = await db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = ? AND kind = ?").bind(uid, a.from, a.kind).first<{ id: string }>();
      if (!src) return fail(`No ${a.kind} category named ${a.from}`);
      const dst = await db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = ? AND kind = ?").bind(uid, a.to, a.kind).first<{ id: string }>();
      if (!dst || dst.id === src.id) {
        await db.prepare("UPDATE categories SET name = ? WHERE id = ?").bind(a.to, src.id).run();
        return ok({ renamed: a.from, to: a.to });
      }
      await db.batch([
        db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ? AND user_id = ?").bind(dst.id, src.id, uid),
        db.prepare("UPDATE recurring SET category_id = ? WHERE category_id = ? AND user_id = ?").bind(dst.id, src.id, uid),
        db.prepare("INSERT OR IGNORE INTO budgets (user_id, category_id, month, amount_cents) SELECT user_id, ?, month, amount_cents FROM budgets WHERE category_id = ?").bind(dst.id, src.id),
        db.prepare("DELETE FROM categories WHERE id = ?").bind(src.id),
      ]);
      return ok({ merged: a.from, into: a.to });
    },
  );

  server.registerTool(
    "add_account",
    {
      title: "Add account",
      description: "Add a bank account, card, cash wallet or savings pot, with an optional current/opening balance.",
      inputSchema: z.object({
        name,
        type: z.enum(["checking", "savings", "cash", "credit", "investment", "other"]).default("checking"),
        opening_balance: z.number().default(0).describe("Balance before any logged transactions (negative for credit card debt)"),
      }),
    },
    async (a) => {
      await db
        .prepare(
          `INSERT INTO accounts (id, user_id, name, type, opening_balance_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, name) DO UPDATE SET type = excluded.type, opening_balance_cents = excluded.opening_balance_cents, archived = 0`,
        )
        .bind(id(), uid, a.name, a.type, toCents(a.opening_balance), Date.now())
        .run();
      return ok({ account: a.name, type: a.type, opening_balance: a.opening_balance });
    },
  );

  server.registerTool(
    "list_accounts",
    { title: "List accounts", description: "Accounts with their current balances.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => ok(await accountBalances(db, uid)),
  );

  // ---------- budgets ----------

  server.registerTool(
    "set_budget",
    {
      title: "Set budget",
      description: "Monthly spending limit for an expense category. Without month it applies to every month; with month it overrides that month only. remove=true deletes it.",
      inputSchema: z.object({ category: name, amount: z.number().min(0).max(1e10), month: zMonth.optional(), remove: z.boolean().default(false) }),
    },
    async (a) => {
      const cat = await categoryId(a.category, "expense");
      const m = a.month ?? "*";
      if (a.remove) {
        await db.prepare("DELETE FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?").bind(uid, cat, m).run();
        return ok({ removed: { category: a.category, month: a.month ?? "default" } });
      }
      await db
        .prepare(
          `INSERT INTO budgets (user_id, category_id, month, amount_cents) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents`,
        )
        .bind(uid, cat, m, toCents(a.amount))
        .run();
      return ok({ category: a.category, month: a.month ?? "every month", budget: a.amount }, `Budget set: ${a.category} ${money(toCents(a.amount), cur())}/month.`);
    },
  );

  server.registerTool(
    "budget_status",
    {
      title: "Budget status",
      description: "Budget vs. actual per expense category for a month, with totals and an end-of-month projection.",
      inputSchema: z.object({ month: zMonth.optional().describe("Defaults to the current month") }),
      annotations: { readOnlyHint: true },
    },
    async (a) => ok(await budgetStatus(db, uid, a.month ?? today().slice(0, 7), today())),
  );

  // ---------- recurring bills / income ----------

  server.registerTool(
    "add_recurring",
    {
      title: "Add recurring bill or income",
      description: "Track something that repeats (rent, Netflix, salary, insurance). It shows up in follow_up when due.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(80),
        amount,
        kind: kind.default("expense"),
        category: name.optional(),
        account: name.optional(),
        frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
        next_due: zDate.describe("Next date it is due"),
      }),
    },
    async (a) => {
      const rid = id();
      await db
        .prepare(
          `INSERT INTO recurring (id, user_id, name, kind, amount_cents, category_id, account_id, frequency, next_due, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(rid, uid, a.name, a.kind, toCents(a.amount), await categoryId(a.category ?? a.name, a.kind), await accountId(a.account), a.frequency, a.next_due, Date.now())
        .run();
      return ok({ id: rid, ...a }, `Tracking ${a.name}: ${money(toCents(a.amount), cur())} ${a.frequency}, next due ${a.next_due}.`);
    },
  );

  server.registerTool(
    "list_recurring",
    {
      title: "List recurring",
      description: "Recurring bills and income with next due dates and their monthly cost.",
      inputSchema: z.object({ include_inactive: z.boolean().default(false) }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const rows = await recurringRows(db, uid, a.include_inactive);
      const monthly = (r: { amount_cents: number; frequency: Frequency }) =>
        r.amount_cents * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 } as const)[r.frequency];
      const out = rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        amount: fromCents(r.amount_cents),
        frequency: r.frequency,
        next_due: r.next_due,
        days_until_due: daysBetween(today(), r.next_due),
        category: r.category,
        active: !!r.active,
      }));
      const fixedCosts = rows.filter((r) => r.active && r.kind === "expense").reduce((s, r) => s + monthly(r), 0);
      return ok({ monthly_fixed_costs: fromCents(Math.round(fixedCosts)), items: out });
    },
  );

  server.registerTool(
    "mark_recurring_paid",
    {
      title: "Mark recurring paid",
      description: "Log the payment (or income) for a recurring item and move its due date forward.",
      inputSchema: z.object({ id: z.string(), date: zDate.optional(), amount: amount.optional().describe("If it differed this time") }),
    },
    async (a) => {
      const r = await db
        .prepare(
          `SELECT r.*, c.name AS category, ac.name AS account FROM recurring r LEFT JOIN categories c ON c.id = r.category_id
           LEFT JOIN accounts ac ON ac.id = r.account_id WHERE r.id = ? AND r.user_id = ?`,
        )
        .bind(a.id, uid)
        .first<{ name: string; kind: Kind; amount_cents: number; category: string | null; account: string | null; frequency: Frequency; next_due: string }>();
      if (!r) return fail(`Recurring item ${a.id} not found`);
      const txId = await insertTx(
        { amount: a.amount ?? fromCents(r.amount_cents), kind: r.kind, category: r.category ?? r.name, account: r.account ?? undefined, description: r.name, date: a.date ?? today() },
        a.id,
      );
      const due = nextDue(r.next_due, r.frequency);
      await db.prepare("UPDATE recurring SET next_due = ? WHERE id = ?").bind(due, a.id).run();
      return ok({ transaction_id: txId, next_due: due }, `${r.name} logged; next due ${due}.`);
    },
  );

  server.registerTool(
    "update_recurring",
    {
      title: "Update or stop recurring",
      description: "Change amount, frequency or next due date of a recurring item, or deactivate it (cancelled subscription).",
      inputSchema: z.object({
        id: z.string(),
        amount: amount.optional(),
        frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional(),
        next_due: zDate.optional(),
        active: z.boolean().optional(),
      }),
    },
    async (a) => {
      const res = await db
        .prepare(
          `UPDATE recurring SET amount_cents = COALESCE(?, amount_cents), frequency = COALESCE(?, frequency), next_due = COALESCE(?, next_due), active = COALESCE(?, active)
           WHERE id = ? AND user_id = ?`,
        )
        .bind(a.amount !== undefined ? toCents(a.amount) : null, a.frequency ?? null, a.next_due ?? null, a.active === undefined ? null : a.active ? 1 : 0, a.id, uid)
        .run();
      return res.meta.changes ? ok({ updated: a.id }) : fail(`Recurring item ${a.id} not found`);
    },
  );

  // ---------- savings goals ----------

  server.registerTool(
    "set_savings_goal",
    {
      title: "Set savings goal",
      description: "Create or update a savings goal (e.g. Vacation 1500 by 2027-06-01).",
      inputSchema: z.object({ name, target: amount, deadline: zDate.optional(), already_saved: z.number().min(0).optional() }),
    },
    async (a) => {
      await db
        .prepare(
          `INSERT INTO savings_goals (id, user_id, name, target_cents, saved_cents, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, name) DO UPDATE SET target_cents = excluded.target_cents, deadline = COALESCE(excluded.deadline, deadline),
             saved_cents = CASE WHEN ?8 IS NULL THEN saved_cents ELSE excluded.saved_cents END`,
        )
        .bind(id(), uid, a.name, toCents(a.target), toCents(a.already_saved ?? 0), a.deadline ?? null, Date.now(), a.already_saved ?? null)
        .run();
      return ok((await goals(db, uid, today())).find((g) => g.name.toLowerCase() === a.name.toLowerCase()));
    },
  );

  server.registerTool(
    "contribute_to_goal",
    {
      title: "Contribute to goal",
      description: "Add (or withdraw with a negative amount) money to a savings goal.",
      inputSchema: z.object({ goal: name, amount: z.number().refine((n) => n !== 0, "Amount can't be 0") }),
    },
    async (a) => {
      const res = await db
        .prepare("UPDATE savings_goals SET saved_cents = MAX(0, saved_cents + ?) WHERE user_id = ? AND name = ?")
        .bind(toCents(a.amount), uid, a.goal)
        .run();
      if (!res.meta.changes) return fail(`No savings goal named ${a.goal}`);
      const g = (await goals(db, uid, today())).find((x) => x.name.toLowerCase() === a.goal.toLowerCase())!;
      return ok(g, `${g.name}: ${money(toCents(g.saved), cur())} of ${money(toCents(g.target), cur())} (${g.percent}%).`);
    },
  );

  server.registerTool(
    "list_savings_goals",
    { title: "List savings goals", description: "Savings goals with progress and the monthly amount needed to hit each deadline.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => ok(await goals(db, uid, today())),
  );

  server.registerTool(
    "delete_savings_goal",
    { title: "Delete savings goal", description: "Remove a savings goal.", inputSchema: z.object({ goal: name }), annotations: { destructiveHint: true } },
    async (a) => {
      const res = await db.prepare("DELETE FROM savings_goals WHERE user_id = ? AND name = ?").bind(uid, a.goal).run();
      return res.meta.changes ? ok({ deleted: a.goal }) : fail(`No savings goal named ${a.goal}`);
    },
  );

  // ---------- analysis ----------

  server.registerTool(
    "spending_summary",
    {
      title: "Spending summary",
      description: "Totals over a period grouped by category, merchant, account, tag, week or month.",
      inputSchema: z.object({
        ...zPeriodInput,
        group_by: z.enum(["category", "merchant", "account", "tag", "week", "month"]).default("category"),
        kind: kind.default("expense"),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const rows = await groupTotals(db, uid, r.from, r.to, a.kind, a.group_by);
      const total = rows.reduce((s, x) => s + x.total_cents, 0);
      return ok({
        period: r,
        kind: a.kind,
        total: fromCents(total),
        rows: rows.map((x) => ({ [a.group_by]: x.grp, total: fromCents(x.total_cents), count: x.count, share_percent: total ? Math.round((x.total_cents / total) * 1000) / 10 : 0 })),
      });
    },
  );

  server.registerTool(
    "follow_up",
    {
      title: "Budget follow-up",
      description: "Check-in: month so far, spending pace, budgets at risk, bills due soon or overdue, savings goals, and nudges.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const t = today();
      const status = await budgetStatus(db, uid, t.slice(0, 7), t);
      const bills = (await recurringRows(db, uid, false)).filter((r) => r.next_due <= addDays(t, 7));
      const last = await db.prepare("SELECT MAX(occurred_on) AS d FROM transactions WHERE user_id = ?").bind(uid).first<{ d: string | null }>();
      const g = await goals(db, uid, t);
      const nudges: string[] = [];
      for (const c of status.categories) {
        if (c.over_budget) nudges.push(`${c.category} is over budget by ${money(toCents(-c.remaining!), cur())}.`);
        else if (c.percent_used !== null && c.percent_used >= 80) nudges.push(`${c.category} has used ${c.percent_used}% of its budget.`);
      }
      for (const b of bills) nudges.push(b.next_due < t ? `${b.name} is overdue since ${b.next_due}.` : `${b.name} (${money(b.amount_cents, cur())}) is due ${b.next_due === t ? "today" : `on ${b.next_due}`}.`);
      if (!last?.d) nudges.push("No transactions yet, log your first expense or add your accounts.");
      else if (daysBetween(last.d, t) >= 3) nudges.push(`Nothing logged for ${daysBetween(last.d, t)} days, anything to add?`);
      if (!status.categories.some((c) => c.budget !== null)) nudges.push("No budgets set yet, try set_budget for your top categories.");
      for (const goal of g) if (goal.on_track === false) nudges.push(`Savings goal ${goal.name} needs ${money(toCents(goal.monthly_needed ?? 0), cur())}/month to hit ${goal.deadline}.`);
      return ok({
        today: t,
        month: status.month,
        income: status.income,
        expenses: status.expense,
        net: status.net,
        projected_month_expenses: status.projected_expense,
        last_transaction: last?.d ?? null,
        budgets_at_risk: status.categories.filter((c) => c.over_budget || (c.percent_used ?? 0) >= 80),
        bills_due: bills.map((b) => ({ id: b.id, name: b.name, amount: fromCents(b.amount_cents), due: b.next_due, overdue: b.next_due < t })),
        savings_goals: g,
        nudges,
      });
    },
  );

  server.registerTool(
    "generate_report",
    {
      title: "Generate budget report",
      description: "Well-organized financial report for a period: KPIs, highlights, spending by category vs. previous period, budgets, income, merchants, biggest expenses, trend, accounts, bills and goals. Returns Markdown plus a printable link.",
      inputSchema: z.object(zPeriodInput),
      annotations: { readOnlyHint: true },
    },
    async (a) => reportResult(ctx, await buildReport(ctx, resolvePeriod(user.timezone, a.period, a.from, a.to))),
  );

  return server;
}

// ---------- queries shared with the report ----------

export async function budgetStatus(db: D1Database, uid: string, month: string, today: string) {
  const { results } = await db
    .prepare(
      `SELECT c.name, COALESCE(bm.amount_cents, bd.amount_cents) AS budget_cents,
              (SELECT SUM(t.amount_cents) FROM transactions t WHERE t.category_id = c.id AND t.occurred_on LIKE ?2 || '-%') AS spent_cents
       FROM categories c
       LEFT JOIN budgets bm ON bm.category_id = c.id AND bm.month = ?2
       LEFT JOIN budgets bd ON bd.category_id = c.id AND bd.month = '*'
       WHERE c.user_id = ?1 AND c.kind = 'expense'`,
    )
    .bind(uid, month)
    .all<{ name: string; budget_cents: number | null; spent_cents: number | null }>();
  const totals = await db
    .prepare(
      `SELECT SUM(CASE WHEN kind = 'income' THEN amount_cents END) AS income, SUM(CASE WHEN kind = 'expense' THEN amount_cents END) AS expense
       FROM transactions WHERE user_id = ? AND occurred_on LIKE ? || '-%'`,
    )
    .bind(uid, month)
    .first<{ income: number | null; expense: number | null }>();
  const end = monthEnd(month);
  const daysInMonth = Number(end.slice(8));
  const elapsed = today.slice(0, 7) === month ? Number(today.slice(8)) : today > end ? daysInMonth : 0;
  const categories = results
    .filter((r) => r.budget_cents !== null || r.spent_cents)
    .map((r) => {
      const budget = r.budget_cents === null ? null : fromCents(r.budget_cents);
      const spent = fromCents(r.spent_cents);
      return {
        category: r.name,
        budget,
        spent,
        remaining: budget === null ? null : Math.round((budget - spent) * 100) / 100,
        percent_used: budget ? Math.round((spent / budget) * 100) : null,
        over_budget: budget !== null && spent > budget,
      };
    })
    .sort((x, y) => y.spent - x.spent);
  const expense = totals?.expense ?? 0;
  const totalBudget = categories.reduce((s, c) => s + (c.budget ?? 0), 0);
  return {
    month,
    income: fromCents(totals?.income),
    expense: fromCents(expense),
    net: fromCents((totals?.income ?? 0) - expense),
    total_budget: totalBudget || null,
    days_elapsed: elapsed,
    days_in_month: daysInMonth,
    projected_expense: elapsed ? Math.round((fromCents(expense) / elapsed) * daysInMonth * 100) / 100 : null,
    categories,
  };
}

export async function accountBalances(db: D1Database, uid: string) {
  const { results } = await db
    .prepare(
      `SELECT a.name, a.type, a.opening_balance_cents
         + COALESCE((SELECT SUM(CASE WHEN t.kind = 'income' THEN t.amount_cents WHEN t.kind IN ('expense', 'transfer') THEN -t.amount_cents END)
                     FROM transactions t WHERE t.account_id = a.id), 0)
         + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.to_account_id = a.id AND t.kind = 'transfer'), 0) AS balance_cents
       FROM accounts a WHERE a.user_id = ? AND a.archived = 0 ORDER BY a.name`,
    )
    .bind(uid)
    .all<{ name: string; type: string; balance_cents: number }>();
  return results.map((r) => ({ name: r.name, type: r.type, balance: fromCents(r.balance_cents) }));
}

export async function recurringRows(db: D1Database, uid: string, includeInactive: boolean) {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.name, r.kind, r.amount_cents, r.frequency, r.next_due, r.active, c.name AS category
       FROM recurring r LEFT JOIN categories c ON c.id = r.category_id
       WHERE r.user_id = ? AND (? OR r.active = 1) ORDER BY r.next_due`,
    )
    .bind(uid, includeInactive ? 1 : 0)
    .all<{ id: string; name: string; kind: Kind; amount_cents: number; frequency: Frequency; next_due: string; active: number; category: string | null }>();
  return results;
}

export async function goals(db: D1Database, uid: string, today: string) {
  const { results } = await db
    .prepare("SELECT name, target_cents, saved_cents, deadline FROM savings_goals WHERE user_id = ? ORDER BY deadline IS NULL, deadline, name")
    .bind(uid)
    .all<{ name: string; target_cents: number; saved_cents: number; deadline: string | null }>();
  return results.map((g) => {
    const left = Math.max(0, g.target_cents - g.saved_cents);
    const months = g.deadline ? Math.max(1, Math.ceil(daysBetween(today, g.deadline) / 30.44)) : null;
    const monthlyNeeded = months ? left / months : null;
    return {
      name: g.name,
      target: fromCents(g.target_cents),
      saved: fromCents(g.saved_cents),
      remaining: fromCents(left),
      percent: Math.round((g.saved_cents / g.target_cents) * 100),
      deadline: g.deadline,
      monthly_needed: monthlyNeeded === null ? null : Math.round(monthlyNeeded) / 100,
      on_track: g.deadline ? (left === 0 ? true : g.deadline < today ? false : null) : null,
    };
  });
}

export async function groupTotals(
  db: D1Database,
  uid: string,
  from: string,
  to: string,
  k: Kind,
  groupBy: "category" | "merchant" | "account" | "tag" | "week" | "month",
) {
  if (groupBy === "tag") {
    const { results } = await db
      .prepare("SELECT tags, amount_cents FROM transactions WHERE user_id = ? AND kind = ? AND occurred_on BETWEEN ? AND ? AND tags IS NOT NULL")
      .bind(uid, k, from, to)
      .all<{ tags: string; amount_cents: number }>();
    const map = new Map<string, { total_cents: number; count: number }>();
    for (const r of results)
      for (const tag of r.tags.split(",")) {
        const e = map.get(tag) ?? { total_cents: 0, count: 0 };
        e.total_cents += r.amount_cents;
        e.count++;
        map.set(tag, e);
      }
    return [...map].map(([grp, v]) => ({ grp, ...v })).sort((a, b) => b.total_cents - a.total_cents);
  }
  const key = {
    category: "COALESCE(c.name, 'Uncategorized')",
    merchant: "COALESCE(t.merchant, t.description, 'Unknown')",
    account: "COALESCE(a.name, 'No account')",
    week: "date(t.occurred_on, '-' || ((CAST(strftime('%w', t.occurred_on) AS INTEGER) + 6) % 7) || ' days')",
    month: "substr(t.occurred_on, 1, 7)",
  }[groupBy];
  const order = groupBy === "week" || groupBy === "month" ? "grp" : "total_cents DESC";
  const { results } = await db
    .prepare(
      `SELECT ${key} AS grp, SUM(t.amount_cents) AS total_cents, COUNT(*) AS count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.user_id = ? AND t.kind = ? AND t.occurred_on BETWEEN ? AND ? GROUP BY grp ORDER BY ${order}`,
    )
    .bind(uid, k, from, to)
    .all<{ grp: string; total_cents: number; count: number }>();
  return results;
}
