import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { parseDashboardExpectedVersion, parseDashboardWidgets } from "./dashboard-layout-validation.js";

describe("dashboard layout validation", () => {
  it("accepts a bounded unique layout and normalizes custom chart settings", () => {
    assert.deepEqual(
      parseDashboardWidgets([
        { id: "total_tasks", width: "small" },
        {
          id: "custom_chart",
          width: "wide",
          settings: { chartType: "donut", groupBy: "assignee", metric: "logged" },
        },
      ]),
      [
        { id: "total_tasks", width: "small" },
        {
          id: "custom_chart",
          width: "wide",
          settings: { chartType: "donut", groupBy: "assignee", metric: "logged" },
        },
      ],
    );
    assert.equal(parseDashboardExpectedVersion(0), 0);
  });

  it("rejects duplicate, unknown, or malformed widgets", () => {
    assert.throws(
      () =>
        parseDashboardWidgets([
          { id: "goals", width: "medium" },
          { id: "goals", width: "wide" },
        ]),
      BadRequestException,
    );
    assert.throws(() => parseDashboardWidgets([{ id: "unknown", width: "small" }]), BadRequestException);
    assert.throws(
      () => parseDashboardWidgets([{ id: "custom_chart", width: "wide", settings: { chartType: "pie" } }]),
      BadRequestException,
    );
    assert.throws(() => parseDashboardExpectedVersion(-1), BadRequestException);
  });
});
