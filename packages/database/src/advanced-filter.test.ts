import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateAndNormalizeAdvancedFilterAst,
  canonicalizeAdvancedFilterAst,
  areCanonicalAdvancedFilterAstsEqual,
  convertLegacyFiltersToAdvancedFilterAst,
  extractCustomFieldKeysFromAst,
  evaluateTaskAdvancedFilter,
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_AST_PREDICATES,
  type AdvancedFilterNode,
  type AdvancedFilterPredicate,
  type AdvancedFilterGroup,
} from "./advanced-filter.js";
import { TenantConflictError } from "./errors.js";
import type { CustomFieldRecord } from "./repositories/custom-fields.js";

function makeFieldRecord(overrides: Partial<CustomFieldRecord> = {}): CustomFieldRecord {
  return {
    id: "cf-1",
    organizationId: "org-1",
    workspaceId: "ws-1",
    projectId: null,
    key: "cf_score",
    name: "Score",
    type: "number",
    description: "",
    required: false,
    sensitive: false,
    options: [],
    order: 0,
    createdById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("Advanced Filter AST Validation & Safety Limits", () => {
  const defsByKey = new Map<string, CustomFieldRecord>([
    ["cf_score", makeFieldRecord({ key: "cf_score", type: "number" })],
    ["cf_release_date", makeFieldRecord({ key: "cf_release_date", type: "date" })],
    ["cf_env", makeFieldRecord({ key: "cf_env", type: "single_select", options: [{ label: "Prod", value: "prod" }] })],
  ]);

  it("validates and normalizes valid common field predicates", () => {
    const ast: AdvancedFilterGroup = {
      kind: "group",
      operator: "and",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
        { kind: "predicate", field: "priority", operator: "in", value: ["urgent", "high"] },
        { kind: "predicate", field: "title", operator: "contains", value: "deploy" },
        { kind: "predicate", field: "progress", operator: "greater_than_or_equal", value: 50 },
        { kind: "predicate", field: "isMilestone", operator: "equals", value: true },
        { kind: "predicate", field: "startDate", operator: "after", value: "2026-08-01T00:00:00Z" },
        { kind: "predicate", field: "tags", operator: "contains_all", value: ["backend", "api"] },
      ],
    };

    const normalized = validateAndNormalizeAdvancedFilterAst(ast, defsByKey);
    assert.equal(normalized.kind, "group");
    if (normalized.kind === "group") {
      assert.equal(normalized.children.length, 7);
      assert.equal((normalized.children[0] as AdvancedFilterPredicate).field, "status");
      assert.equal((normalized.children[0] as AdvancedFilterPredicate).value, "in_progress");
    }
  });

  it("validates and normalizes valid custom field predicates", () => {
    const ast: AdvancedFilterGroup = {
      kind: "group",
      operator: "and",
      children: [
        { kind: "predicate", field: "customField", customFieldKey: "cf_score", operator: "greater_than", value: 80 },
        {
          kind: "predicate",
          field: "customField",
          customFieldKey: "cf_release_date",
          operator: "before",
          value: "2026-09-01T00:00:00.000Z",
        },
      ],
    };

    const normalized = validateAndNormalizeAdvancedFilterAst(ast, defsByKey);
    assert.equal(normalized.kind, "group");
    if (normalized.kind === "group") {
      assert.equal(normalized.children.length, 2);
      assert.equal((normalized.children[0] as AdvancedFilterPredicate).customFieldKey, "cf_score");
      assert.equal((normalized.children[0] as AdvancedFilterPredicate).value, 80);
    }
  });

  it("extracts referenced custom field keys reliably from AST", () => {
    const ast: AdvancedFilterGroup = {
      kind: "group",
      operator: "or",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "todo" },
        { kind: "predicate", field: "customField", customFieldKey: "cf_score", operator: "equals", value: 10 },
        {
          kind: "group",
          operator: "and",
          children: [
            {
              kind: "predicate",
              field: "customField",
              customFieldKey: "cf_release_date",
              operator: "equals",
              value: "2026-08-25",
            },
          ],
        },
      ],
    };

    const keys = extractCustomFieldKeysFromAst(ast);
    assert.deepEqual(keys.sort(), ["cf_release_date", "cf_score"]);
  });

  it("rejects invalid node kinds, non-objects, and invalid group operators", () => {
    assert.throws(() => validateAndNormalizeAdvancedFilterAst(null as any), TenantConflictError);
    assert.throws(() => validateAndNormalizeAdvancedFilterAst("string" as any), TenantConflictError);
    assert.throws(() => validateAndNormalizeAdvancedFilterAst([] as any), TenantConflictError);
    assert.throws(() => validateAndNormalizeAdvancedFilterAst({ kind: "invalid" } as any), TenantConflictError);
    assert.throws(
      () => validateAndNormalizeAdvancedFilterAst({ kind: "group", operator: "xor", children: [] } as any),
      TenantConflictError,
    );
    assert.throws(
      () => validateAndNormalizeAdvancedFilterAst({ kind: "group", operator: "and", children: "not-array" } as any),
      TenantConflictError,
    );
  });

  it("rejects unsupported operators for field data types", () => {
    // number + contains
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "progress",
          operator: "contains",
          value: "50",
        }),
      TenantConflictError,
    );

    // boolean + contains
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "isMilestone",
          operator: "contains",
          value: "true",
        }),
      TenantConflictError,
    );

    // status + greater_than
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "status",
          operator: "greater_than",
          value: "todo",
        }),
      TenantConflictError,
    );

    // date + contains
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "dueDate",
          operator: "contains",
          value: "2026",
        }),
      TenantConflictError,
    );
  });

  it("rejects unsupported and internal database columns", () => {
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "organizationId" as any,
          operator: "equals",
          value: "org-1",
        }),
      TenantConflictError,
    );
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "deletedAt" as any,
          operator: "equals",
          value: null,
        }),
      TenantConflictError,
    );
  });

  it("rejects invalid values for enum, id, number, and boolean fields", () => {
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "status",
          operator: "equals",
          value: "invalid_status",
        }),
      TenantConflictError,
    );
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "priority",
          operator: "in",
          value: ["urgent", "mega_urgent"],
        }),
      TenantConflictError,
    );
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "progress",
          operator: "equals",
          value: "not-a-number",
        }),
      TenantConflictError,
    );
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "isMilestone",
          operator: "equals",
          value: "not-a-bool",
        }),
      TenantConflictError,
    );
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "assigneeId",
          operator: "equals",
          value: "",
        }),
      TenantConflictError,
    );
  });

  it("strictly enforces maximum AST depth limit (10)", () => {
    // Build tree of depth 10 (allowed)
    let deep10: AdvancedFilterNode = { kind: "predicate", field: "status", operator: "equals", value: "todo" };
    for (let i = 0; i < 9; i++) {
      deep10 = { kind: "group", operator: "and", children: [deep10] };
    }
    assert.doesNotThrow(() => validateAndNormalizeAdvancedFilterAst(deep10));

    // Build tree of depth 11 (rejected)
    const deep11: AdvancedFilterNode = { kind: "group", operator: "and", children: [deep10] };
    assert.throws(() => validateAndNormalizeAdvancedFilterAst(deep11), TenantConflictError);
  });

  it("strictly enforces maximum node and predicate count limits (100)", () => {
    const predicates: AdvancedFilterNode[] = [];
    for (let i = 0; i < 101; i++) {
      predicates.push({ kind: "predicate", field: "status", operator: "equals", value: "todo" });
    }
    const oversizedGroup: AdvancedFilterGroup = {
      kind: "group",
      operator: "and",
      children: predicates,
    };
    assert.throws(() => validateAndNormalizeAdvancedFilterAst(oversizedGroup), TenantConflictError);
  });

  it("detects and rejects cyclic AST structures", () => {
    const cyclicGroup: any = { kind: "group", operator: "and", children: [] };
    cyclicGroup.children.push(cyclicGroup);
    assert.throws(() => validateAndNormalizeAdvancedFilterAst(cyclicGroup), TenantConflictError);
  });
});

describe("Between Range Contract", () => {
  it("validates and normalizes number between ranges", () => {
    const validRange = validateAndNormalizeAdvancedFilterAst({
      kind: "predicate",
      field: "progress",
      operator: "between",
      value: { min: 10, max: 90 },
    });
    assert.deepEqual((validRange as AdvancedFilterPredicate).value, { min: 10, max: 90 });

    const arrayRange = validateAndNormalizeAdvancedFilterAst({
      kind: "predicate",
      field: "progress",
      operator: "between",
      value: [0, 100],
    });
    assert.deepEqual((arrayRange as AdvancedFilterPredicate).value, { min: 0, max: 100 });

    const equalRange = validateAndNormalizeAdvancedFilterAst({
      kind: "predicate",
      field: "progress",
      operator: "between",
      value: { min: 50, max: 50 },
    });
    assert.deepEqual((equalRange as AdvancedFilterPredicate).value, { min: 50, max: 50 });

    // min > max must be rejected
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "progress",
          operator: "between",
          value: { min: 90, max: 10 },
        }),
      TenantConflictError,
    );

    // NaN / missing bounds rejected
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "progress",
          operator: "between",
          value: { min: 10, max: NaN },
        }),
      TenantConflictError,
    );
  });

  it("validates and normalizes date between ranges", () => {
    const validDateRange = validateAndNormalizeAdvancedFilterAst({
      kind: "predicate",
      field: "dueDate",
      operator: "between",
      value: { min: "2026-08-01T00:00:00Z", max: "2026-08-31T23:59:59Z" },
    });
    assert.equal(typeof (validDateRange as AdvancedFilterPredicate).value, "object");

    // min > max date rejected
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "dueDate",
          operator: "between",
          value: { min: "2026-09-01T00:00:00Z", max: "2026-08-01T00:00:00Z" },
        }),
      TenantConflictError,
    );

    // invalid calendar date rejected
    assert.throws(
      () =>
        validateAndNormalizeAdvancedFilterAst({
          kind: "predicate",
          field: "dueDate",
          operator: "between",
          value: { min: "2026-02-30", max: "2026-08-01" },
        }),
      TenantConflictError,
    );
  });
});

describe("Canonicalization & Idempotency", () => {
  it("orders AND children deterministically: A AND B === B AND A", () => {
    const ast1: AdvancedFilterGroup = {
      kind: "group",
      operator: "and",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "todo" },
        { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
      ],
    };

    const ast2: AdvancedFilterGroup = {
      kind: "group",
      operator: "and",
      children: [
        { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
        { kind: "predicate", field: "status", operator: "equals", value: "todo" },
      ],
    };

    const canon1 = canonicalizeAdvancedFilterAst(ast1);
    const canon2 = canonicalizeAdvancedFilterAst(ast2);
    assert.deepEqual(canon1, canon2);
    assert.equal(areCanonicalAdvancedFilterAstsEqual(ast1, ast2), true);
  });

  it("orders OR children deterministically: A OR B === B OR A", () => {
    const ast1: AdvancedFilterGroup = {
      kind: "group",
      operator: "or",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "todo" },
        { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
      ],
    };

    const ast2: AdvancedFilterGroup = {
      kind: "group",
      operator: "or",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
        { kind: "predicate", field: "status", operator: "equals", value: "todo" },
      ],
    };

    assert.equal(areCanonicalAdvancedFilterAstsEqual(ast1, ast2), true);
  });

  it("preserves nested structure without unsafe flattening: A AND (B OR C) !== (A AND B) OR C", () => {
    const pA: AdvancedFilterPredicate = { kind: "predicate", field: "status", operator: "equals", value: "todo" };
    const pB: AdvancedFilterPredicate = { kind: "predicate", field: "priority", operator: "equals", value: "urgent" };
    const pC: AdvancedFilterPredicate = { kind: "predicate", field: "progress", operator: "equals", value: 100 };

    const ast1: AdvancedFilterGroup = {
      kind: "group",
      operator: "and",
      children: [pA, { kind: "group", operator: "or", children: [pB, pC] }],
    };

    const ast2: AdvancedFilterGroup = {
      kind: "group",
      operator: "or",
      children: [{ kind: "group", operator: "and", children: [pA, pB] }, pC],
    };

    assert.equal(areCanonicalAdvancedFilterAstsEqual(ast1, ast2), false);
  });
});

describe("Legacy Filter Translation", () => {
  it("translates legacy parameters to canonical AST group", () => {
    const legacy = {
      status: "in_progress",
      priority: "high",
      assigneeId: "user-123",
      search: "auth",
      customFieldFilters: [{ fieldKey: "cf_score", operator: "greater_than", value: 50 }],
    };

    const ast = convertLegacyFiltersToAdvancedFilterAst(legacy);
    assert.ok(ast);
    assert.equal(ast.kind, "group");
    assert.equal(ast.operator, "and");
    assert.equal(ast.children.length, 5);

    const fields = ast.children.map((c) => (c as AdvancedFilterPredicate).field);
    assert.ok(fields.includes("status"));
    assert.ok(fields.includes("priority"));
    assert.ok(fields.includes("assigneeId"));
    assert.ok(fields.includes("search"));
    assert.ok(fields.includes("customField"));
  });

  it("returns null for empty legacy filters", () => {
    assert.equal(convertLegacyFiltersToAdvancedFilterAst({}), null);
  });
});

describe("In-Memory Evaluator Parity", () => {
  const taskA = {
    id: "task-1",
    title: "Implement SSO login",
    serial: "CB-101",
    description: "OAuth2 and SAML authentication flows",
    status: "in_progress",
    priority: "urgent",
    assigneeId: "user-1",
    assigneeIds: ["user-1", "user-2"],
    tags: ["auth", "security"],
    progress: 75,
    isMilestone: false,
    isRecurring: true,
    dueDate: "2026-08-30T12:00:00.000Z",
    customFields: {
      cf_score: 90,
    },
  };

  const defs = new Map<string, CustomFieldRecord>([["cf_score", makeFieldRecord({ key: "cf_score", type: "number" })]]);

  it("evaluates AND group correctly", () => {
    const ast: AdvancedFilterGroup = {
      kind: "group",
      operator: "and",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
        { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
        { kind: "predicate", field: "progress", operator: "greater_than", value: 50 },
        { kind: "predicate", field: "customField", customFieldKey: "cf_score", operator: "greater_than", value: 80 },
      ],
    };
    assert.equal(evaluateTaskAdvancedFilter(taskA, ast, defs), true);
  });

  it("evaluates OR group correctly", () => {
    const matchAst: AdvancedFilterGroup = {
      kind: "group",
      operator: "or",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "done" },
        { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
      ],
    };
    assert.equal(evaluateTaskAdvancedFilter(taskA, matchAst, defs), true);

    const noMatchAst: AdvancedFilterGroup = {
      kind: "group",
      operator: "or",
      children: [
        { kind: "predicate", field: "status", operator: "equals", value: "done" },
        { kind: "predicate", field: "priority", operator: "equals", value: "low" },
      ],
    };
    assert.equal(evaluateTaskAdvancedFilter(taskA, noMatchAst, defs), false);
  });

  it("evaluates empty groups according to canonical boolean semantics", () => {
    // AND [] is TRUE
    assert.equal(evaluateTaskAdvancedFilter(taskA, { kind: "group", operator: "and", children: [] }), true);
    // OR [] is FALSE
    assert.equal(evaluateTaskAdvancedFilter(taskA, { kind: "group", operator: "or", children: [] }), false);
  });
});
