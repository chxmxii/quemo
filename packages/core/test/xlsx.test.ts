import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report";
import { parseCell, reportToXlsx } from "../src/xlsx";

const report: Report = {
  tool: "Quemo Budget",
  title: "Budget Report",
  subtitle: "Rider",
  period: { from: "2026-10-01", to: "2026-10-26", label: "This month" },
  kpis: [
    { label: "Income", value: "€2,500.00", tone: "good" },
    { label: "Expenses", value: "€1,107.35", detail: "▲ 12% vs prev." },
    { label: "Savings rate", value: "56%" },
  ],
  highlights: ["Groceries went over budget by €7.35 in 2026-10.", "You kept 56% of your income."],
  sections: [
    {
      title: "Spending by category",
      bars: [
        { label: "Groceries", value: 10735, max: 10735, display: "€107.35 · 9.7%" },
        { label: "Fun", value: 2000, max: 10735, display: "€20.00 · 1.8%" },
      ],
      table: { columns: ["Category", "Spent", "Share", "Transactions"], rows: [["Groceries", "€107.35", "9.7%", 2], ["R&D <tools>", "-€20.00", "1.8%", 1]], numeric: [1, 2, 3] },
    },
    { title: "Largest expenses", table: { columns: ["Date", "Amount", "Note"], rows: [["2026-10-24", "€62.35", null], ["2026-10-25", "€45.00", "Lidl"]] } },
    { title: "Body: weight / waist", table: { columns: ["Metric", "Latest"], rows: [["Weight", "72.5 kg"], ["Waist", "81 cm"]] } },
    { title: "Savings goals", empty: "No savings goals yet." },
    { title: "Savings goals", bullets: ["duplicate title gets a unique sheet name"] },
  ],
};

describe("excel export", () => {
  it("parses display values into typed cells", () => {
    expect(parseCell("€1,234.50")).toEqual({ v: 1234.5, fmt: '"€"#,##0.00;-"€"#,##0.00' });
    expect(parseCell("-€7.35").v).toBe(-7.35);
    expect(parseCell("$12")).toMatchObject({ v: 12 });
    expect(parseCell("45%")).toEqual({ v: 0.45, fmt: "0%" });
    expect(parseCell("9.7%")).toEqual({ v: 0.097, fmt: "0.0%" });
    expect(parseCell("72.5 kg")).toEqual({ v: 72.5, fmt: '#,##0.0# "kg"' });
    expect(parseCell("2026-10-26")).toMatchObject({ v: 46321, date: true, fmt: "yyyy-mm-dd" });
    expect(parseCell("1,500")).toMatchObject({ v: 1500 });
    expect(parseCell(3)).toMatchObject({ v: 3 });
    expect(parseCell("0049 123")).toEqual({ v: "0049 123" }); // phone-like strings stay text
    expect(parseCell("▲ 12% vs prev.")).toEqual({ v: "▲ 12% vs prev." });
    expect(parseCell(null)).toEqual({ v: "" });
  });

  it("builds a valid workbook: summary + one sheet per section", async () => {
    const bytes = reportToXlsx(report);
    const out = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.XLSX_OUT;
    if (out) ((await import(/* @vite-ignore */ `node:${"fs"}`)) as { writeFileSync(p: string, b: Uint8Array): void }).writeFileSync(out, bytes);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet6.xml"]),
    );
    const wb = strFromU8(files["xl/workbook.xml"]);
    expect(wb.match(/<sheet name="([^"]+)"/g)!.map((s) => s.slice(13, -1))).toEqual([
      "Summary",
      "Spending by category",
      "Largest expenses",
      "Body weight waist",
      "Savings goals",
      "Savings goals 2",
    ]);
    const s2 = strFromU8(files["xl/worksheets/sheet2.xml"]);
    expect(s2).toContain("<v>107.35</v>"); // money is numeric
    expect(s2).toContain("<v>-20</v>");
    expect(s2).toContain("R&amp;D &lt;tools&gt;"); // escaped
    expect(s2).toContain('state="frozen"');
    expect(s2).toContain("<autoFilter ");
    expect(s2).toContain('type="dataBar"');
    expect(strFromU8(files["xl/styles.xml"])).toContain('formatCode="&quot;€&quot;#,##0.00;-&quot;€&quot;#,##0.00"');
  });
});
