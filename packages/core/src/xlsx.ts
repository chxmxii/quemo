/**
 * Report → formatted Excel workbook (.xlsx), written by hand as SpreadsheetML and zipped with fflate,
 * so it runs inside Workers with no heavy dependency.
 *
 * Layout: a "Summary" sheet (title, period, KPIs, highlights), then one sheet per report section.
 * Values like "€1,234.50", "45%", "72.5 kg" or "2026-10-26" become real numbers/dates with matching
 * number formats, so Excel can sum, sort and chart them. Tables get a dark header row, zebra rows,
 * frozen headers, auto-filters and fitted column widths; bar sections get in-cell data bars.
 */
import { strToU8, zipSync } from "fflate";
import type { Cell, Kpi, Report, Section } from "./report";

type Style = "text" | "title" | "subtitle" | "header" | "bold" | "muted" | "kpiValue";

interface Parsed {
  v: string | number;
  /** custom number format, if numeric */
  fmt?: string;
  date?: boolean;
}

const CURRENCY = /^(-)?([€$£¥₹₺])\s?(-)?([\d,]+(?:\.\d+)?)$/;
const SUFFIX = /^(-?[\d,]+(?:\.\d+)?)\s?([A-Za-z%°/]+(?:\s?[A-Za-z]+)?)$/;

/** Turns a display string from a report into a typed Excel value. */
export function parseCell(c: Cell): Parsed {
  if (c === null || c === undefined || c === "") return { v: "" };
  if (typeof c === "number") return { v: c, fmt: Number.isInteger(c) ? "#,##0" : "#,##0.00" };
  const s = c.trim();
  let m = s.match(CURRENCY);
  if (m) {
    const sym = m[2];
    const n = Number(m[4].replace(/,/g, "")) * (m[1] || m[3] ? -1 : 1);
    return { v: n, fmt: `"${sym}"#,##0.00;-"${sym}"#,##0.00` };
  }
  if (/^-?\d+(?:\.\d+)?%$/.test(s)) {
    const n = Number(s.slice(0, -1));
    return { v: Math.round(n * 1e8) / 1e10, fmt: Number.isInteger(n) ? "0%" : "0.0%" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const serial = Date.parse(`${s}T00:00:00Z`) / 86_400_000 + 25569;
    return Number.isFinite(serial) ? { v: serial, fmt: "yyyy-mm-dd", date: true } : { v: s };
  }
  if (/^-?[\d,]+(?:\.\d+)?$/.test(s) && !/^0\d/.test(s)) {
    const n = Number(s.replace(/,/g, ""));
    return { v: n, fmt: Number.isInteger(n) ? "#,##0" : "#,##0.0#" };
  }
  m = s.match(SUFFIX);
  if (m && !/^\d{4}$/.test(m[1])) {
    const n = Number(m[1].replace(/,/g, ""));
    const unit = m[2].replace(/"/g, "");
    return { v: n, fmt: `${Number.isInteger(n) ? "#,##0" : "#,##0.0#"} "${unit}"` };
  }
  return { v: s };
}

// ---------- styles ----------

class StyleBook {
  private fmts = new Map<string, number>(); // custom numFmt → id
  private xfs: string[] = [];
  private keys = new Map<string, number>();

  constructor() {
    this.xf("text", undefined); // index 0 = default
  }

  /** Returns the cellXfs index for a base style + optional number format. */
  xf(style: Style, fmt?: string, zebra = false): number {
    const key = `${style}|${fmt ?? ""}|${zebra}`;
    const hit = this.keys.get(key);
    if (hit !== undefined) return hit;
    let numFmtId = 0;
    if (fmt) {
      if (!this.fmts.has(fmt)) this.fmts.set(fmt, 164 + this.fmts.size);
      numFmtId = this.fmts.get(fmt)!;
    }
    const font = { text: 0, title: 1, subtitle: 2, header: 3, bold: 4, muted: 2, kpiValue: 5 }[style];
    const fill = style === "header" ? 2 : zebra ? 3 : 0;
    const border = style === "header" || style === "text" || style === "bold" ? 1 : 0;
    const align = style === "header" ? '<alignment vertical="center" wrapText="1"/>' : '<alignment vertical="top" wrapText="1"/>';
    const id = this.xfs.length;
    this.xfs.push(
      `<xf numFmtId="${numFmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${numFmtId ? ' applyNumberFormat="1"' : ""}>${align}</xf>`,
    );
    this.keys.set(key, id);
    return id;
  }

  xml(): string {
    const numFmts = [...this.fmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${numFmts ? `<numFmts count="${this.fmts.size}">${numFmts}</numFmts>` : ""}
<fonts count="6">
<font><sz val="11"/><color rgb="FF1F1F1F"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="20"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF6B6B6B"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF16161A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F4"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE4E4E7"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }
}

// ---------- sheets ----------

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

interface SheetCell {
  value: string | number;
  style: number;
}

class Sheet {
  rows: (SheetCell | null)[][] = [];
  widths: number[] = [];
  heights = new Map<number, number>();
  merges: string[] = [];
  freezeRow = 0;
  filter?: string;
  dataBars: string[] = [];

  constructor(public name: string) {}

  /** measure=false for title/notes rows so long headings don't stretch the first column. */
  add(cells: (SheetCell | null)[], height?: number, measure = true): number {
    this.rows.push(cells);
    const r = this.rows.length;
    if (height) this.heights.set(r, height);
    if (measure) cells.forEach((c, i) => {
      if (!c) return;
      const len = typeof c.value === "number" ? 12 : Math.min(60, Math.max(...String(c.value).split("\n").map((l) => l.length)) + 2);
      this.widths[i] = Math.max(this.widths[i] ?? 8, len);
    });
    return r;
  }

  xml(): string {
    const cols = this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(10, w)}" customWidth="1"/>`).join("");
    const rows = this.rows
      .map((cells, ri) => {
        const r = ri + 1;
        const ht = this.heights.get(r);
        const cs = cells
          .map((c, ci) => {
            if (!c) return "";
            const ref = `${colName(ci)}${r}`;
            if (typeof c.value === "number") return `<c r="${ref}" s="${c.style}"><v>${c.value}</v></c>`;
            if (c.value === "") return `<c r="${ref}" s="${c.style}"/>`;
            return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t xml:space="preserve">${esc(c.value)}</t></is></c>`;
          })
          .join("");
        return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cs}</row>`;
      })
      .join("");
    const pane = this.freezeRow
      ? `<pane ySplit="${this.freezeRow}" topLeftCell="A${this.freezeRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
      : "";
    const bars = this.dataBars
      .map(
        (ref, i) =>
          `<conditionalFormatting sqref="${ref}"><cfRule type="dataBar" priority="${i + 1}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF8B5CF6"/></dataBar></cfRule></conditionalFormatting>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${cols ? `<cols>${cols}</cols>` : ""}
<sheetData>${rows}</sheetData>
${this.filter ? `<autoFilter ref="${this.filter}"/>` : ""}
${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
${bars}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }
}

function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

export function reportToXlsx(r: Report): Uint8Array {
  const st = new StyleBook();
  const used = new Set<string>();
  const sheets: Sheet[] = [];
  const typed = (c: Cell, base: Style = "text", zebra = false): SheetCell => {
    const p = parseCell(c);
    return { value: p.v, style: st.xf(base, p.fmt, zebra) };
  };
  const text = (v: string, style: Style = "text"): SheetCell => ({ value: v, style: st.xf(style) });

  // Summary sheet
  const sum = new Sheet(sheetName("Summary", used));
  sheets.push(sum);
  sum.add([text(r.title, "title")], 30, false);
  sum.add([text([r.tool, r.period ? `${r.period.label}: ${r.period.from} to ${r.period.to}` : "", r.subtitle ?? ""].filter(Boolean).join("  ·  "), "subtitle")], undefined, false);
  sum.add([]);
  if (r.kpis.length) {
    sum.add([text("Metric", "header"), text("Value", "header"), text("Detail", "header")], 22);
    r.kpis.forEach((k: Kpi, i) => sum.add([text(k.label, "bold"), typed(k.value, "kpiValue", i % 2 === 1), text(k.detail ?? "", "muted")], 24));
    sum.add([]);
  }
  if (r.highlights?.length) {
    sum.add([text("Highlights", "header")], 22);
    for (const h of r.highlights) sum.add([text(`•  ${h}`)], undefined, false);
    sum.add([]);
  }
  if (r.disclaimer) sum.add([text(r.disclaimer, "muted")], undefined, false);
  sum.widths[0] = Math.min(Math.max(sum.widths[0] ?? 0, 28), 70);
  sum.widths[2] = Math.max(sum.widths[2] ?? 0, 40);

  // One sheet per section
  for (const s of r.sections) sheets.push(sectionSheet(s, sheetName(s.title, used), st, typed, text));

  return zipWorkbook(sheets, st);
}

function sectionSheet(
  s: Section,
  name: string,
  _st: StyleBook,
  typed: (c: Cell, base?: Style, zebra?: boolean) => SheetCell,
  text: (v: string, style?: Style) => SheetCell,
): Sheet {
  const sh = new Sheet(name);
  sh.add([text(s.title, "title")], 28, false);
  if (s.text) sh.add([text(s.text, "muted")], undefined, false);
  sh.add([]);
  const hasData = s.table?.rows.length || s.bars?.length || s.kpis?.length || s.bullets?.length;
  if (!hasData) {
    sh.add([text(s.empty ?? "No data for this period.", "muted")], undefined, false);
    return sh;
  }
  if (s.kpis?.length) {
    sh.add([text("Metric", "header"), text("Value", "header"), text("Detail", "header")], 22);
    s.kpis.forEach((k, i) => sh.add([text(k.label, "bold"), typed(k.value, "text", i % 2 === 1), text(k.detail ?? "", "muted")]));
    sh.add([]);
  }
  if (s.table?.rows.length) {
    const t = s.table;
    const head = sh.add(t.columns.map((c) => text(c, "header")), 22);
    if (!sh.freezeRow) sh.freezeRow = head;
    t.rows.forEach((row, i) => sh.add(row.map((c) => typed(c, "text", i % 2 === 1))));
    sh.filter = `A${head}:${colName(t.columns.length - 1)}${head + t.rows.length}`;
    sh.add([]);
  }
  if (s.bars?.length) {
    // Raw bar values can be in internal units (cents…), so the sheet shows the share of the max plus the display text.
    const head = sh.add([text("Item", "header"), text("% of max", "header"), text("Value", "header")], 22);
    if (!sh.freezeRow) sh.freezeRow = head;
    s.bars.forEach((b, i) => {
      const share = b.max > 0 ? Math.round((b.value / b.max) * 10000) / 10000 : 0;
      sh.add([text(b.label, "bold"), typed(`${Math.round(share * 1000) / 10}%`, "text", i % 2 === 1), text(b.display, "muted")]);
    });
    sh.dataBars.push(`B${head + 1}:B${head + s.bars.length}`);
    sh.add([]);
  }
  if (s.bullets?.length) for (const b of s.bullets) sh.add([text(`•  ${b}`)], undefined, false);
  sh.widths[0] = Math.min(Math.max(sh.widths[0] ?? 0, 22), 70);
  return sh;
}

function zipWorkbook(sheets: Sheet[], st: StyleBook): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Quemo</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>
</cp:coreProperties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${definedNames(sheets)}
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml())));
  files["xl/styles.xml"] = strToU8(st.xml()); // after sheets: they register the formats they use
  return zipSync(files, { level: 6 });
}

/** Excel needs a hidden _FilterDatabase name for each sheet with an auto-filter. */
function definedNames(sheets: Sheet[]): string {
  const names = sheets
    .map((s, i) => (s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.replace(/'/g, "''"))}'!$${s.filter.replace(/([A-Z]+)(\d+)/g, "$1$$$2").replace(":", ":$")}</definedName>` : ""))
    .join("");
  return names ? `<definedNames>${names}</definedNames>` : "";
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
