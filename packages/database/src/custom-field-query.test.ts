import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_FIELD_OPERATORS,
  OPERATORS_BY_TYPE,
  validateAndNormalizeCustomFieldOperator,
  validateAndNormalizeCustomFilterValue,
  validateAndNormalizeCustomFieldFilter,
  validateAndNormalizeCustomFieldSort,
  canonicalizeCustomFieldFilters,
  evaluateTaskCustomFieldFilter,
  buildCustomFieldSqlCondition,
  buildCustomFieldSqlSortColumn,
  type CustomFieldFilter,
} from "./custom-field-query.js";
import { TenantConflictError } from "./errors.js";
import type { CustomFieldRecord } from "./repositories/custom-fields.js";
import { tasks } from "./schema.js";

function makeFieldRecord(overrides: Partial<CustomFieldRecord> = {}): CustomFieldRecord {
  return {
    id: "cf-1",
    organizationId: "org-1",
    workspaceId: "ws-1",
    projectId: null,
    key: "test_field",
    name: "Test Field",
    type: "short_text",
    description: "",
    required: false,
    sensitive: false,
    options: [],
    order: 1,
    createdById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("Custom Field Query Domain - Unit Tests", () => {
  describe("Operator matrix", () => {
    it("exports all 15 canonical operators", () => {
      assert.equal(CUSTOM_FIELD_OPERATORS.length, 15);
      assert.deepEqual(CUSTOM_FIELD_OPERATORS, [
        "equals",
        "not_equals",
        "contains",
        "starts_with",
        "ends_with",
        "greater_than",
        "greater_than_or_equal",
        "less_than",
        "less_than_or_equal",
        "before",
        "after",
        "on_or_before",
        "on_or_after",
        "is_empty",
        "is_not_empty",
      ]);
    });

    it("validates operators for each supported field type", () => {
      assert.equal(validateAndNormalizeCustomFieldOperator("equals", "short_text", "f"), "equals");
      assert.equal(validateAndNormalizeCustomFieldOperator("CONTAINS", "short_text", "f"), "contains");
      assert.equal(validateAndNormalizeCustomFieldOperator("greater_than", "number", "f"), "greater_than");
      assert.equal(validateAndNormalizeCustomFieldOperator("before", "date", "f"), "before");
      assert.equal(validateAndNormalizeCustomFieldOperator("equals", "single_select", "f"), "equals");
      assert.equal(validateAndNormalizeCustomFieldOperator("is_empty", "checkbox", "f"), "is_empty");
    });

    it("rejects unsupported operators for given field types", () => {
      assert.throws(
        () => validateAndNormalizeCustomFieldOperator("greater_than", "short_text", "f"),
        TenantConflictError,
      );
      assert.throws(() => validateAndNormalizeCustomFieldOperator("contains", "number", "f"), TenantConflictError);
      assert.throws(() => validateAndNormalizeCustomFieldOperator("before", "single_select", "f"), TenantConflictError);
      assert.throws(() => validateAndNormalizeCustomFieldOperator("contains", "checkbox", "f"), TenantConflictError);
    });
  });

  describe("Value validation & normalization", () => {
    it("handles is_empty and is_not_empty without value requirement", () => {
      const def = makeFieldRecord({ type: "number" });
      assert.equal(validateAndNormalizeCustomFilterValue(def, "is_empty", undefined), undefined);
      assert.equal(validateAndNormalizeCustomFilterValue(def, "is_not_empty", null), undefined);
    });

    it("normalizes and validates number values", () => {
      const def = makeFieldRecord({ type: "number", key: "cf_score" });
      assert.equal(validateAndNormalizeCustomFilterValue(def, "equals", 42), 42);
      assert.equal(validateAndNormalizeCustomFilterValue(def, "greater_than", "100.5"), 100.5);
      assert.equal(validateAndNormalizeCustomFilterValue(def, "less_than", 0), 0);
      assert.throws(() => validateAndNormalizeCustomFilterValue(def, "equals", "abc"), TenantConflictError);
      assert.throws(() => validateAndNormalizeCustomFilterValue(def, "equals", NaN), TenantConflictError);
      assert.throws(() => validateAndNormalizeCustomFilterValue(def, "equals", Infinity), TenantConflictError);
    });

    it("normalizes and validates date values", () => {
      const def = makeFieldRecord({ type: "date", key: "cf_release" });
      assert.equal(validateAndNormalizeCustomFilterValue(def, "before", "2026-08-25"), "2026-08-25T00:00:00.000Z");
      assert.equal(
        validateAndNormalizeCustomFilterValue(def, "after", new Date("2026-08-25T14:30:00Z")),
        "2026-08-25T14:30:00.000Z",
      );
      assert.throws(() => validateAndNormalizeCustomFilterValue(def, "before", "invalid-date"), TenantConflictError);
    });

    it("normalizes and validates single_select options", () => {
      const def = makeFieldRecord({
        type: "single_select",
        key: "cf_status",
        options: [
          { label: "In Review", value: "in_review" },
          { label: "Approved", value: "approved" },
        ],
      });
      assert.equal(validateAndNormalizeCustomFilterValue(def, "equals", "in_review"), "in_review");
      assert.equal(validateAndNormalizeCustomFilterValue(def, "equals", "Approved"), "approved");
      assert.throws(() => validateAndNormalizeCustomFilterValue(def, "equals", "rejected"), TenantConflictError);
    });

    it("normalizes and validates checkbox values", () => {
      const def = makeFieldRecord({ type: "checkbox", key: "cf_done" });
      assert.equal(validateAndNormalizeCustomFilterValue(def, "equals", true), true);
      assert.equal(validateAndNormalizeCustomFilterValue(def, "equals", false), false);
      assert.equal(validateAndNormalizeCustomFilterValue(def, "equals", "true"), true);
      assert.equal(validateAndNormalizeCustomFilterValue(def, "equals", "false"), false);
      assert.throws(() => validateAndNormalizeCustomFilterValue(def, "equals", "maybe"), TenantConflictError);
    });
  });

  describe("Filter resolution & scope security", () => {
    it("rejects unknown field key", () => {
      const defs = new Map<string, CustomFieldRecord>();
      assert.throws(
        () =>
          validateAndNormalizeCustomFieldFilter({ fieldKey: "cf_unknown", operator: "equals", value: "test" }, defs, {
            organizationId: "org-1",
            workspaceId: "ws-1",
          }),
        TenantConflictError,
      );
    });

    it("rejects cross-workspace or cross-project fields", () => {
      const defWs2 = makeFieldRecord({ key: "cf_other_ws", workspaceId: "ws-2" });
      const defs = new Map<string, CustomFieldRecord>([["cf_other_ws", defWs2]]);
      assert.throws(
        () =>
          validateAndNormalizeCustomFieldFilter({ fieldKey: "cf_other_ws", operator: "equals", value: "test" }, defs, {
            organizationId: "org-1",
            workspaceId: "ws-1",
          }),
        TenantConflictError,
      );

      const defP2 = makeFieldRecord({ key: "cf_p2", projectId: "proj-2" });
      const defsP = new Map<string, CustomFieldRecord>([["cf_p2", defP2]]);
      assert.throws(
        () =>
          validateAndNormalizeCustomFieldFilter({ fieldKey: "cf_p2", operator: "equals", value: "test" }, defsP, {
            organizationId: "org-1",
            workspaceId: "ws-1",
            projectId: "proj-1",
          }),
        TenantConflictError,
      );
    });

    it("rejects deleted custom field", () => {
      const defDeleted = makeFieldRecord({ key: "cf_deleted", deletedAt: new Date() });
      const defs = new Map<string, CustomFieldRecord>([["cf_deleted", defDeleted]]);
      assert.throws(
        () =>
          validateAndNormalizeCustomFieldFilter({ fieldKey: "cf_deleted", operator: "equals", value: "test" }, defs, {
            organizationId: "org-1",
            workspaceId: "ws-1",
          }),
        TenantConflictError,
      );
    });

    it("rejects querying or sorting sensitive custom fields", () => {
      const defSensitive = makeFieldRecord({ key: "cf_secret", sensitive: true });
      const defs = new Map<string, CustomFieldRecord>([["cf_secret", defSensitive]]);
      assert.throws(
        () =>
          validateAndNormalizeCustomFieldFilter({ fieldKey: "cf_secret", operator: "equals", value: "test" }, defs, {
            organizationId: "org-1",
            workspaceId: "ws-1",
          }),
        TenantConflictError,
      );
    });

    it("canonicalizes custom field filter ordering deterministically", () => {
      const unordered: CustomFieldFilter[] = [
        { fieldKey: "cf_z", operator: "equals", value: "test" },
        { fieldKey: "cf_a", operator: "equals", value: 10 },
        { fieldKey: "cf_a", operator: "before", value: "2026-08-25" },
      ];
      const ordered = canonicalizeCustomFieldFilters(unordered);
      assert.ok(ordered);
      assert.equal(ordered[0].fieldKey, "cf_a");
      assert.equal(ordered[0].operator, "before");
      assert.equal(ordered[1].fieldKey, "cf_a");
      assert.equal(ordered[1].operator, "equals");
      assert.equal(ordered[2].fieldKey, "cf_z");
    });
  });

  describe("evaluateTaskCustomFieldFilter (In-memory semantics)", () => {
    it("correctly evaluates is_empty and is_not_empty including 0 and false non-empty invariants", () => {
      const numDef = makeFieldRecord({ key: "cf_num", type: "number" });
      const boolDef = makeFieldRecord({ key: "cf_bool", type: "checkbox" });
      const textDef = makeFieldRecord({ key: "cf_txt", type: "short_text" });

      // Missing field is empty
      assert.equal(evaluateTaskCustomFieldFilter({}, { fieldKey: "cf_num", operator: "is_empty" }, numDef), true);
      assert.equal(evaluateTaskCustomFieldFilter({}, { fieldKey: "cf_num", operator: "is_not_empty" }, numDef), false);

      // Number 0 is NOT empty
      assert.equal(
        evaluateTaskCustomFieldFilter({ cf_num: 0 }, { fieldKey: "cf_num", operator: "is_empty" }, numDef),
        false,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter({ cf_num: 0 }, { fieldKey: "cf_num", operator: "is_not_empty" }, numDef),
        true,
      );

      // Boolean false is NOT empty
      assert.equal(
        evaluateTaskCustomFieldFilter({ cf_bool: false }, { fieldKey: "cf_bool", operator: "is_empty" }, boolDef),
        false,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter({ cf_bool: false }, { fieldKey: "cf_bool", operator: "is_not_empty" }, boolDef),
        true,
      );

      // Empty string is empty
      assert.equal(
        evaluateTaskCustomFieldFilter({ cf_txt: "" }, { fieldKey: "cf_txt", operator: "is_empty" }, textDef),
        true,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter({ cf_txt: "   " }, { fieldKey: "cf_txt", operator: "is_empty" }, textDef),
        true,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter({ cf_txt: "hello" }, { fieldKey: "cf_txt", operator: "is_not_empty" }, textDef),
        true,
      );
    });

    it("evaluates number comparison operators", () => {
      const def = makeFieldRecord({ key: "score", type: "number" });
      assert.equal(
        evaluateTaskCustomFieldFilter({ score: 50 }, { fieldKey: "score", operator: "equals", value: 50 }, def),
        true,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter({ score: 50 }, { fieldKey: "score", operator: "greater_than", value: 40 }, def),
        true,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter({ score: 50 }, { fieldKey: "score", operator: "greater_than", value: 50 }, def),
        false,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter(
          { score: 50 },
          { fieldKey: "score", operator: "greater_than_or_equal", value: 50 },
          def,
        ),
        true,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter({ score: 50 }, { fieldKey: "score", operator: "less_than", value: 60 }, def),
        true,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter(
          { score: 50 },
          { fieldKey: "score", operator: "less_than_or_equal", value: 50 },
          def,
        ),
        true,
      );
    });

    it("evaluates date comparison operators", () => {
      const def = makeFieldRecord({ key: "deadline", type: "date" });
      const task = { deadline: "2026-08-25T10:00:00.000Z" };
      assert.equal(
        evaluateTaskCustomFieldFilter(
          task,
          { fieldKey: "deadline", operator: "before", value: "2026-08-26T00:00:00Z" },
          def,
        ),
        true,
      );
      assert.equal(
        evaluateTaskCustomFieldFilter(
          task,
          { fieldKey: "deadline", operator: "after", value: "2026-08-24T00:00:00Z" },
          def,
        ),
        true,
      );
    });
  });

  describe("SQL Builders", () => {
    it("constructs SQL conditions without throwing", () => {
      const numDef = makeFieldRecord({ key: "cf_num", type: "number" });
      const cond = buildCustomFieldSqlCondition(
        { fieldKey: "cf_num", operator: "greater_than", value: 10 },
        numDef,
        tasks.customFields,
      );
      assert.ok(cond);

      const sortCol = buildCustomFieldSqlSortColumn(numDef, tasks.customFields);
      assert.ok(sortCol);
    });
  });
});
