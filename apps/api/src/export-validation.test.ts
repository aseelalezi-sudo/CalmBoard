import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { parseWorkspaceExportFormat } from "./export-validation.js";

describe("workspace export format validation", () => {
  it("accepts the three server-generated formats and defaults to JSON", () => {
    assert.equal(parseWorkspaceExportFormat(undefined), "json");
    assert.equal(parseWorkspaceExportFormat("json"), "json");
    assert.equal(parseWorkspaceExportFormat("pdf"), "pdf");
    assert.equal(parseWorkspaceExportFormat("xlsx"), "xlsx");
  });

  it("rejects client-selected executable or unsupported formats", () => {
    assert.throws(() => parseWorkspaceExportFormat("html"), BadRequestException);
    assert.throws(() => parseWorkspaceExportFormat("csv"), BadRequestException);
    assert.throws(() => parseWorkspaceExportFormat({ format: "pdf" }), BadRequestException);
  });
});
