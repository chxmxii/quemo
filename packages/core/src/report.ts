import { escapeHtml as e, layout } from "./theme";
import type { ToolContext } from "./types";

export type Tone = "good" | "warn" | "bad" | "neutral";

export interface Kpi {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
}

export type Cell = string | number | null | undefined;

export interface Table {
  columns: string[];
  rows: Cell[][];
  /** Column indexes to right-align (numbers). */
  numeric?: number[];
}

export interface Bar {
  label: string;
  value: number;
  max: number;
  display: string;
  tone?: Tone;
}

export interface Section {
  title: string;
  text?: string;
  kpis?: Kpi[];
  bars?: Bar[];
  table?: Table;
  bullets?: string[];
  /** Shown instead of the content when the section has no data. */
  empty?: string;
}

export interface Report {
  /** e.g. "Quemo Budget" */
  tool: string;
  title: string;
  subtitle?: string;
  period?: { from: string; to: string; label: string };
  kpis: Kpi[];
  /** Short, plain-language takeaways shown at the top. */
  highlights?: string[];
  sections: Section[];
  disclaimer?: string;
}

const isEmpty = (s: Section) => !s.text && !s.kpis?.length && !s.bars?.length && !s.table?.rows.length && !s.bullets?.length;

const mdCell = (c: Cell) => (c === null || c === undefined || c === "" ? "—" : String(c).replace(/\|/g, "\\|").replace(/\n/g, " "));

function mdBar(b: Bar): string {
  const ratio = b.max > 0 ? Math.max(0, Math.min(1, b.value / b.max)) : 0;
  const filled = Math.round(ratio * 16);
  const mark = b.tone === "bad" ? " ⚠" : b.tone === "good" ? " ✓" : "";
  return `\`${"█".repeat(filled)}${"░".repeat(16 - filled)}\` **${b.label}** — ${b.display}${mark}`;
}

/** Markdown rendering: what the chat assistant shows inline. */
export function reportToMarkdown(r: Report, link?: string): string {
  const out: string[] = [`# ${r.title}`];
  const meta = [r.tool, r.period ? `${r.period.label} (${r.period.from} → ${r.period.to})` : null, r.subtitle].filter(Boolean);
  out.push(`_${meta.join(" · ")}_`);
  if (r.kpis.length) {
    out.push("", `| ${r.kpis.map((k) => k.label).join(" | ")} |`, `|${r.kpis.map(() => "---").join("|")}|`);
    out.push(`| ${r.kpis.map((k) => `**${mdCell(k.value)}**${k.detail ? ` (${mdCell(k.detail)})` : ""}`).join(" | ")} |`);
  }
  if (r.highlights?.length) out.push("", "**Highlights**", ...r.highlights.map((h) => `- ${h}`));
  for (const s of r.sections) {
    out.push("", `## ${s.title}`);
    if (isEmpty(s)) {
      out.push(`_${s.empty ?? "No data for this period."}_`);
      continue;
    }
    if (s.text) out.push(s.text);
    if (s.kpis?.length) out.push(...s.kpis.map((k) => `- **${k.label}:** ${k.value}${k.detail ? ` — ${k.detail}` : ""}`));
    if (s.bars?.length) out.push(...s.bars.map((b) => `${mdBar(b)}  `));
    if (s.table?.rows.length) {
      const t = s.table;
      out.push(
        "",
        `| ${t.columns.map(mdCell).join(" | ")} |`,
        `|${t.columns.map((_, i) => (t.numeric?.includes(i) ? "---:" : "---")).join("|")}|`,
        ...t.rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`),
      );
    }
    if (s.bullets?.length) out.push("", ...s.bullets.map((b) => `- ${b}`));
  }
  if (r.disclaimer) out.push("", `> ${r.disclaimer}`);
  if (link) out.push("", `📄 Printable / shareable version: ${link}`);
  return out.join("\n");
}

const htmlCell = (c: Cell) => (c === null || c === undefined || c === "" ? '<span class="muted">—</span>' : e(c));

function kpisHtml(kpis: Kpi[]): string {
  return `<div class="kpis">${kpis
    .map((k) => `<div class="kpi ${k.tone ?? ""}"><span>${e(k.label)}</span><b>${e(k.value)}</b>${k.detail ? `<small>${e(k.detail)}</small>` : ""}</div>`)
    .join("")}</div>`;
}

/** Standalone, print-friendly HTML page. */
export function reportToHtml(r: Report): string {
  const sections = r.sections
    .map((s) => {
      if (isEmpty(s)) return `<section class="panel stack"><h3>${e(s.title)}</h3><p class="muted">${e(s.empty ?? "No data for this period.")}</p></section>`;
      const parts: string[] = [`<h3>${e(s.title)}</h3>`];
      if (s.text) parts.push(`<p>${e(s.text)}</p>`);
      if (s.kpis?.length) parts.push(kpisHtml(s.kpis));
      if (s.bars?.length)
        parts.push(
          `<div class="bars">${s.bars
            .map((b) => {
              const pct = b.max > 0 ? Math.max(0, Math.min(100, (b.value / b.max) * 100)) : 0;
              return `<div class="bar ${b.tone ?? ""}"><span>${e(b.label)}</span><div class="track"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div><span class="muted">${e(b.display)}</span></div>`;
            })
            .join("")}</div>`,
        );
      if (s.table?.rows.length) {
        const t = s.table;
        const cls = (i: number) => (t.numeric?.includes(i) ? ' class="r"' : "");
        parts.push(
          `<div class="tablewrap"><table><thead><tr>${t.columns.map((c, i) => `<th${cls(i)}>${e(c)}</th>`).join("")}</tr></thead><tbody>${t.rows
            .map((row) => `<tr>${row.map((c, i) => `<td${cls(i)}>${htmlCell(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`,
        );
      }
      if (s.bullets?.length) parts.push(`<ul>${s.bullets.map((b) => `<li>${e(b)}</li>`).join("")}</ul>`);
      return `<section class="panel stack">${parts.join("")}</section>`;
    })
    .join("");

  const body = `<header class="stack fade" style="margin-bottom:28px">
  <div class="row between"><span class="logo sm">QUEMO</span><span class="kicker">${e(r.tool)}</span></div>
  <h1>${e(r.title)}</h1>
  <p class="muted">${[r.period ? `${e(r.period.label)} · ${e(r.period.from)} → ${e(r.period.to)}` : "", r.subtitle ? e(r.subtitle) : ""].filter(Boolean).join(" · ")}</p>
  <div class="row noprint"><button type="button" class="ghost mini" onclick="print()">Print / save as PDF</button></div>
</header>
${r.kpis.length ? kpisHtml(r.kpis) : ""}
${r.highlights?.length ? `<section class="panel stack" style="margin-top:16px"><h3 class="grad">Highlights</h3><ul>${r.highlights.map((h) => `<li>${e(h)}</li>`).join("")}</ul></section>` : ""}
<div class="stack" style="margin-top:16px">${sections}</div>
${r.disclaimer ? `<p class="notice small" style="margin-top:20px">${e(r.disclaimer)}</p>` : ""}`;
  return layout({ title: `${r.title} · ${r.tool}`, body, variant: "report" });
}

const REPORT_TTL = 90 * 24 * 3600 * 1000;

/** Stores the report so it gets a stable printable link; returns that link. */
export async function saveReport(ctx: ToolContext, report: Report): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const now = Date.now();
  await ctx.env.DB.prepare("INSERT INTO reports (id, user_id, title, body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, ctx.user.id, report.title, JSON.stringify(report), now, now + REPORT_TTL)
    .run();
  return `${ctx.env.PUBLIC_URL.replace(/\/$/, "")}/reports/${id}`;
}

export async function loadReport(db: D1Database, id: string): Promise<Report | null> {
  const row = await db
    .prepare("SELECT body FROM reports WHERE id = ? AND expires_at > ?")
    .bind(id, Date.now())
    .first<{ body: string }>();
  return row ? (JSON.parse(row.body) as Report) : null;
}

/** MCP tool result for a report: Markdown for the chat plus a link to the printable page. */
export async function reportResult(ctx: ToolContext, report: Report) {
  const link = await saveReport(ctx, report);
  return { content: [{ type: "text" as const, text: reportToMarkdown(report, link) }] };
}

/** SQL every tool's first migration includes. */
export const REPORTS_TABLE_SQL = `CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);`;
