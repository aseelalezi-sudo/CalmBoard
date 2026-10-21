import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCsv, escapeCsvCell } from "./csv";

describe("escapeCsvCell", () => {
  it("quotes values and doubles embedded quotes", () => {
    assert.equal(escapeCsvCell('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(escapeCsvCell(null), '""');
    assert.equal(escapeCsvCell(undefined), '""');
    assert.equal(escapeCsvCell(12), '"12"');
  });

  it("keeps newlines inside the quoted cell", () => {
    assert.equal(escapeCsvCell("a\nb"), '"a\nb"');
  });

  it("neutralizes spreadsheet formula triggers", () => {
    assert.equal(escapeCsvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
    assert.equal(escapeCsvCell("+1+1"), `"'+1+1"`);
    assert.equal(escapeCsvCell("-2+3"), `"'-2+3"`);
    assert.equal(escapeCsvCell("@SUM(A1)"), `"'@SUM(A1)"`);
    assert.equal(escapeCsvCell("\t=1"), `"'\t=1"`);
  });

  it("does not alter ordinary Arabic and English text", () => {
    assert.equal(escapeCsvCell("إعداد بيئة CI/CD"), '"إعداد بيئة CI/CD"');
    assert.equal(escapeCsvCell("2026-10-21"), '"2026-10-21"');
  });
});

describe("buildCsv", () => {
  it("starts with a BOM and escapes headings and rows", () => {
    const csv = buildCsv(["Title", "Due"], [["=1+1", "2026-10-21"]]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(csv.slice(1), `"Title","Due"\n"'=1+1","2026-10-21"`);
  });
});
