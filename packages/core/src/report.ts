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

const mdCell = (c: Cell) => (c === null || c === undefined || c === "" ? "-" : String(c).replace(/\|/g, "\\|").replace(/\n/g, " "));

function mdBar(b: Bar): string {
  const ratio = b.max > 0 ? Math.max(0, Math.min(1, b.value / b.max)) : 0;
  const filled = Math.round(ratio * 16);
  const mark = b.tone === "bad" ? " ⚠" : b.tone === "good" ? " ✓" : "";
  return `\`${"█".repeat(filled)}${"░".repeat(16 - filled)}\` **${b.label}**, ${b.display}${mark}`;
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
    if (s.kpis?.length) out.push(...s.kpis.map((k) => `- **${k.label}:** ${k.value}${k.detail ? `, ${k.detail}` : ""}`));
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
  if (link) out.push("", `📄 Printable / PDF version: ${link}`, `📊 Excel workbook: ${link}.xlsx`);
  return out.join("\n");
}

const htmlCell = (c: Cell) => (c === null || c === undefined || c === "" ? '<span class="faint">-</span>' : e(c));

function kpisHtml(kpis: Kpi[]): string {
  return `<div class="kpis">${kpis
    .map((k) => `<div class="glass kpi ${k.tone ?? ""}"><span>${e(k.label)}</span><b>${e(k.value)}</b>${k.detail ? `<small>${e(k.detail)}</small>` : ""}</div>`)
    .join("")}</div>`;
}

const sectionStyle = 'style="display:grid;gap:16px"';

/** Standalone, print-friendly HTML page. */
export function reportToHtml(r: Report, xlsxHref?: string): string {
  const sections = r.sections
    .map((s) => {
      if (isEmpty(s)) return `<section class="glass pad" ${sectionStyle}><h3>${e(s.title)}</h3><p class="muted">${e(s.empty ?? "No data for this period.")}</p></section>`;
      const parts: string[] = [`<h3>${e(s.title)}</h3>`];
      if (s.text) parts.push(`<p class="muted">${e(s.text)}</p>`);
      if (s.kpis?.length) parts.push(kpisHtml(s.kpis));
      if (s.bars?.length)
        parts.push(
          `<div class="bars">${s.bars
            .map((b) => {
              const pct = b.max > 0 ? Math.max(0, Math.min(100, (b.value / b.max) * 100)) : 0;
              return `<div class="bar ${b.tone ?? ""}"><span>${e(b.label)}</span><div class="track"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div><span class="val">${e(b.display)}</span></div>`;
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
      if (s.bullets?.length) parts.push(`<ul style="margin:0;padding-left:20px;display:grid;gap:6px">${s.bullets.map((b) => `<li>${e(b)}</li>`).join("")}</ul>`);
      return `<section class="glass pad" ${sectionStyle}>${parts.join("")}</section>`;
    })
    .join("");

  const meta = [r.period ? `${e(r.period.label)}, ${e(r.period.from)} to ${e(r.period.to)}` : "", r.subtitle ? e(r.subtitle) : ""].filter(Boolean).join(". ");
  const body = `<header class="rise" style="display:grid;gap:14px;padding:36px 0 28px">
  <span class="chip" style="width:max-content">${e(r.tool)}</span>
  <h1 style="font-size:clamp(34px,4.6vw,52px)">${e(r.title)}</h1>
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between">
    <p class="muted">${meta}</p>
    <span class="noprint" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn ghost sm" href="${xlsxHref ?? ""}" download><i class="ph ph-microsoft-excel-logo"></i>Download Excel</a><button type="button" class="ghost sm" onclick="print()"><i class="ph ph-printer"></i>Save as PDF</button></span>
  </div>
</header>
<div class="rise d1">${r.kpis.length ? kpisHtml(r.kpis) : ""}</div>
${r.highlights?.length ? `<section class="glass pad rise d2" style="margin-top:14px;display:grid;gap:12px"><h3>Highlights</h3><ul style="margin:0;padding-left:20px;display:grid;gap:6px">${r.highlights.map((h) => `<li>${e(h)}</li>`).join("")}</ul></section>` : ""}
<div class="rise d3" style="display:grid;gap:14px;margin-top:14px">${sections}</div>
${r.disclaimer ? `<p class="notice" style="margin-top:18px"><i class="ph ph-info"></i>${e(r.disclaimer)}</p>` : ""}`;
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
