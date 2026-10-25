import { addDays, daysBetween, localDate, TOOLS, type DateRange, type Report, type Section, type ToolContext } from "@quemo/core";
import { accountBalances, budgetStatus, goals, groupTotals, money, recurringRows, type Env, type TxRow } from "./server";

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

function change(current: number, previous: number): string {
  if (!previous) return current ? "new" : "—";
  const d = ((current - previous) / previous) * 100;
  return `${d > 0 ? "▲" : d < 0 ? "▼" : "="} ${Math.abs(Math.round(d))}%`;
}

export async function buildReport(ctx: ToolContext<Env>, range: DateRange): Promise<Report> {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const m = (c: number | null | undefined) => money(c, user.currency);
  const today = localDate(user.timezone);

  // Previous period of the same length, for comparisons.
  const prev = { from: addDays(range.from, -range.days), to: addDays(range.from, -1) };

  const totals = async (from: string, to: string) =>
    (await db
      .prepare(
        `SELECT SUM(CASE WHEN kind = 'income' THEN amount_cents ELSE 0 END) AS income, SUM(CASE WHEN kind = 'expense' THEN amount_cents ELSE 0 END) AS expense,
                COUNT(*) AS n FROM transactions WHERE user_id = ? AND occurred_on BETWEEN ? AND ?`,
      )
      .bind(uid, from, to)
      .first<{ income: number | null; expense: number | null; n: number }>())!;

  const [now, before, byCat, prevByCat, incomeBy, merchants, biggest] = await Promise.all([
    totals(range.from, range.to),
    totals(prev.from, prev.to),
    groupTotals(db, uid, range.from, range.to, "expense", "category"),
    groupTotals(db, uid, prev.from, prev.to, "expense", "category"),
    groupTotals(db, uid, range.from, range.to, "income", "category"),
    groupTotals(db, uid, range.from, range.to, "expense", "merchant"),
    db
      .prepare(
        `SELECT t.id, t.kind, t.amount_cents, c.name AS category, NULL AS account, NULL AS to_account, t.merchant, t.description, t.tags, t.occurred_on
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.user_id = ? AND t.kind = 'expense' AND t.occurred_on BETWEEN ? AND ? ORDER BY t.amount_cents DESC LIMIT 10`,
      )
      .bind(uid, range.from, range.to)
      .all<TxRow>(),
  ]);

  const income = now.income ?? 0;
  const expense = now.expense ?? 0;
  const net = income - expense;
  const savingsRate = income ? Math.round((net / income) * 100) : null;
  const elapsedDays = Math.max(1, Math.min(range.days, daysBetween(range.from, today) + 1));
  const prevMap = new Map(prevByCat.map((c) => [c.grp, c.total_cents]));

  const highlights: string[] = [];
  if (!now.n) highlights.push("No transactions in this period yet.");
  if (byCat[0]) highlights.push(`Biggest spending category: ${byCat[0].grp} (${m(byCat[0].total_cents)}, ${pct(byCat[0].total_cents, expense)}% of expenses).`);
  if (before.expense) highlights.push(`Spending is ${change(expense, before.expense)} vs. the previous ${range.days} days (${m(before.expense)}).`);
  if (savingsRate !== null) highlights.push(savingsRate >= 0 ? `You kept ${savingsRate}% of your income.` : `You spent ${-savingsRate}% more than you earned.`);
  const movers = byCat
    .map((c) => ({ name: c.grp, diff: c.total_cents - (prevMap.get(c.grp) ?? 0) }))
    .filter((c) => c.diff > 0)
    .sort((a, b) => b.diff - a.diff);
  if (movers[0] && before.n) highlights.push(`Largest increase: ${movers[0].name} (+${m(movers[0].diff)}).`);

  const sections: Section[] = [];

  sections.push({
    title: "Spending by category",
    bars: byCat.slice(0, 12).map((c) => ({ label: c.grp, value: c.total_cents, max: byCat[0].total_cents, display: `${m(c.total_cents)} · ${pct(c.total_cents, expense)}%` })),
    table: {
      columns: ["Category", "Spent", "Share", "Transactions", "Previous period", "Change"],
      rows: byCat.map((c) => [c.grp, m(c.total_cents), `${pct(c.total_cents, expense)}%`, c.count, m(prevMap.get(c.grp) ?? 0), change(c.total_cents, prevMap.get(c.grp) ?? 0)]),
      numeric: [1, 2, 3, 4],
    },
    empty: "No expenses in this period.",
  });

  // Budget adherence for every month touched by the period.
  const months = [...new Set([range.from.slice(0, 7), range.to.slice(0, 7)])];
  const budgetRows: (string | number)[][] = [];
  const budgetBars: Section["bars"] = [];
  for (const month of months) {
    const s = await budgetStatus(db, uid, month, today);
    for (const c of s.categories.filter((x) => x.budget !== null)) {
      budgetRows.push([months.length > 1 ? `${c.category} (${month})` : c.category, m(c.budget! * 100), m(c.spent * 100), m(c.remaining! * 100), `${c.percent_used ?? 0}%`, c.over_budget ? "⚠ over" : (c.percent_used ?? 0) >= 80 ? "close" : "ok"]);
      budgetBars.push({
        label: c.category,
        value: c.spent,
        max: c.budget!,
        display: `${c.percent_used ?? 0}% of ${m(c.budget! * 100)}`,
        tone: c.over_budget ? "bad" : (c.percent_used ?? 0) >= 80 ? "warn" : "good",
      });
      if (c.over_budget) highlights.push(`${c.category} went over budget by ${m(-c.remaining! * 100)} in ${month}.`);
    }
  }
  sections.push({
    title: "Budgets",
    bars: budgetBars,
    table: { columns: ["Category", "Budget", "Spent", "Left", "Used", "Status"], rows: budgetRows, numeric: [1, 2, 3, 4] },
    empty: "No budgets set. Ask your assistant to set monthly limits for your main categories.",
  });

  sections.push({
    title: "Income",
    table: { columns: ["Source", "Amount", "Share"], rows: incomeBy.map((c) => [c.grp, m(c.total_cents), `${pct(c.total_cents, income)}%`]), numeric: [1, 2] },
    empty: "No income logged in this period.",
  });

  sections.push({
    title: "Top merchants",
    table: { columns: ["Merchant / description", "Spent", "Visits"], rows: merchants.slice(0, 10).map((x) => [x.grp, m(x.total_cents), x.count]), numeric: [1, 2] },
    empty: "No merchants recorded.",
  });

  sections.push({
    title: "Largest expenses",
    table: {
      columns: ["Date", "Amount", "Category", "Merchant", "Description"],
      rows: biggest.results.map((t) => [t.occurred_on, m(t.amount_cents), t.category, t.merchant, t.description]),
      numeric: [1],
    },
    empty: "No expenses in this period.",
  });

  if (range.days > 31) {
    const [inc, exp] = await Promise.all([
      groupTotals(db, uid, range.from, range.to, "income", "month"),
      groupTotals(db, uid, range.from, range.to, "expense", "month"),
    ]);
    const monthsSet = [...new Set([...inc, ...exp].map((x) => x.grp))].sort();
    const get = (arr: typeof inc, k: string) => arr.find((x) => x.grp === k)?.total_cents ?? 0;
    sections.push({
      title: "Monthly trend",
      bars: monthsSet.map((k) => ({ label: k, value: get(exp, k), max: Math.max(...exp.map((x) => x.total_cents), 1), display: `spent ${m(get(exp, k))}` })),
      table: {
        columns: ["Month", "Income", "Expenses", "Net"],
        rows: monthsSet.map((k) => [k, m(get(inc, k)), m(get(exp, k)), m(get(inc, k) - get(exp, k))]),
        numeric: [1, 2, 3],
      },
    });
  }

  const accounts = await accountBalances(db, uid);
  sections.push({
    title: "Accounts",
    table: { columns: ["Account", "Type", "Balance"], rows: accounts.map((a) => [a.name, a.type, m(a.balance * 100)]), numeric: [2] },
    empty: "No accounts set up.",
  });

  const bills = (await recurringRows(db, uid, false)).filter((r) => r.next_due <= addDays(today, 30));
  sections.push({
    title: "Upcoming bills & income (next 30 days)",
    table: {
      columns: ["Due", "Name", "Kind", "Amount"],
      rows: bills.map((b) => [b.next_due < today ? `${b.next_due} (overdue)` : b.next_due, b.name, b.kind, m(b.amount_cents)]),
      numeric: [3],
    },
    empty: "Nothing recurring due in the next 30 days.",
  });

  const g = await goals(db, uid, today);
  sections.push({
    title: "Savings goals",
    bars: g.map((x) => ({ label: x.name, value: x.saved, max: x.target, display: `${m(x.saved * 100)} / ${m(x.target * 100)} (${x.percent}%)`, tone: x.percent >= 100 ? "good" : undefined })),
    table: {
      columns: ["Goal", "Saved", "Target", "Deadline", "Needed / month"],
      rows: g.map((x) => [x.name, m(x.saved * 100), m(x.target * 100), x.deadline, x.monthly_needed === null ? null : m(x.monthly_needed * 100)]),
      numeric: [1, 2, 4],
    },
    empty: "No savings goals yet.",
  });

  return {
    tool: TOOLS.budget.name,
    title: "Budget Report",
    subtitle: user.name ?? user.email,
    period: { from: range.from, to: range.to, label: range.label },
    kpis: [
      { label: "Income", value: m(income), detail: before.n ? `${change(income, before.income ?? 0)} vs prev.` : undefined, tone: "good" },
      { label: "Expenses", value: m(expense), detail: before.n ? `${change(expense, before.expense ?? 0)} vs prev.` : undefined },
      { label: "Net", value: m(net), tone: net >= 0 ? "good" : "bad" },
      { label: "Savings rate", value: savingsRate === null ? "—" : `${savingsRate}%`, tone: savingsRate === null ? "neutral" : savingsRate >= 20 ? "good" : savingsRate >= 0 ? "warn" : "bad" },
      { label: "Avg / day", value: m(Math.round(expense / elapsedDays)), detail: `${now.n} transactions` },
    ],
    highlights,
    sections,
  };
}

