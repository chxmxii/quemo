import { describe, expect, it } from "vitest";
import { reportToHtml, reportToMarkdown, type Report } from "../src/report";
import { escapeHtml, layout } from "../src/theme";

const report: Report = {
  tool: "Quemo Test",
  title: "Test Report",
  period: { from: "2026-10-01", to: "2026-10-25", label: "This month" },
  kpis: [{ label: "Total", value: "€10.00", detail: "▲ 5% vs prev.", tone: "good" }],
  highlights: ["Things went well."],
  sections: [
    { title: "Table", table: { columns: ["Name", "Amount"], rows: [["a|b", 1], ["<script>", null]], numeric: [1] } },
    { title: "Bars", bars: [{ label: "Half", value: 5, max: 10, display: "50%" }, { label: "Over", value: 20, max: 10, display: "200%", tone: "bad" }] },
    { title: "Nothing", empty: "No data here." },
  ],
  disclaimer: "Not advice.",
};

describe("report rendering", () => {
  it("renders organized Markdown", () => {
    const md = reportToMarkdown(report, "https://x/reports/1");
    expect(md).toContain("# Test Report");
    expect(md).toContain("_Quemo Test · This month (2026-10-01 → 2026-10-25)_");
    expect(md).toContain("| Total |");
    expect(md).toContain("**€10.00** (▲ 5% vs prev.)");
    expect(md).toContain("- Things went well.");
    expect(md).toContain("| a\\|b | 1 |"); // pipes escaped
    expect(md).toContain("|---|---:|"); // numeric column right-aligned
    expect(md).toContain("`████████░░░░░░░░` **Half**, 50%");
    expect(md).toContain("`████████████████` **Over**, 200% ⚠"); // clamped
    expect(md).toContain("_No data here._");
    expect(md).toContain("> Not advice.");
    expect(md).toContain("https://x/reports/1");
  });

  it("renders escaped, printable HTML", () => {
    const html = reportToHtml(report);
    expect(html).toContain("<title>Test Report · Quemo Test</title>");
    expect(html).toContain("&#60;script&#62;");
    expect(html).not.toContain("<script>\"");
    expect(html).toContain('style="width:50.0%"');
    expect(html).toContain('style="width:100.0%"');
    expect(html).toContain("@media print");
    expect(html).toContain("No data here.");
  });

  it("escapes HTML in the shared layout", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&#60;a href=&#34;x&#34;&#62;&#39;&#38;");
    expect(layout({ title: "<x>", body: "" })).toContain("<title>&#60;x&#62;</title>");
  });
});
