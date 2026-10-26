/** Turns a D1 database into a restorable SQL dump using only the binding (no API token needed). */

const PAGE = 1000;

export interface Dump {
  sql: string;
  rows: number;
  tables: number;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v) || Array.isArray(v)) {
    const bytes = Array.isArray(v) ? Uint8Array.from(v as number[]) : new Uint8Array(v instanceof ArrayBuffer ? v : (v as ArrayBufferView).buffer);
    return `X'${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function dumpDatabase(db: D1Database): Promise<Dump> {
  const { results: schema } = await db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid`,
    )
    .all<{ type: string; name: string; sql: string }>();

  const out: string[] = ["PRAGMA defer_foreign_keys = true;"];
  let rows = 0;
  const tables = schema.filter((s) => s.type === "table");
  for (const t of tables) {
    out.push(`${t.sql};`);
    for (let offset = 0; ; offset += PAGE) {
      const { results } = await db.prepare(`SELECT * FROM ${quote(t.name)} LIMIT ${PAGE} OFFSET ${offset}`).all<Record<string, unknown>>();
      for (const r of results) {
        const cols = Object.keys(r);
        out.push(`INSERT INTO ${quote(t.name)} (${cols.map(quote).join(", ")}) VALUES (${cols.map((c) => literal(r[c])).join(", ")});`);
      }
      rows += results.length;
      if (results.length < PAGE) break;
    }
  }
  for (const s of schema.filter((x) => x.type !== "table")) out.push(`${s.sql};`);
  return { sql: `${out.join("\n")}\n`, rows, tables: tables.length };
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
