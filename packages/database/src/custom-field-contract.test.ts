import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_CUSTOM_FIELD_TYPES,
  normalizeCustomFieldType,
  validateCustomFieldKey,
  validateCustomFieldDefinition,
  validateAndNormalizeTaskCustomFields,
} from "./custom-field-contract.js";
import { TenantConflictError } from "./errors.js";
import type { CustomFieldRecord } from "./repositories/custom-fields.js";

describe("Custom Field Contract - Unit Tests", () => {
  describe("Type normalization & supported types", () => {
    it("recognizes all canonical supported types", () => {
      assert.deepEqual(SUPPORTED_CUSTOM_FIELD_TYPES, [
        "short_text",
        "number",
        "date",
        "single_select",
        "checkbox",
        "url",
      ]);
      for (const type of SUPPORTED_CUSTOM_FIELD_TYPES) {
        assert.equal(normalizeCustomFieldType(type), type);
      }
    });

    it("normalizes aliases text and select", () => {
      assert.equal(normalizeCustomFieldType("text"), "short_text");
      assert.equal(normalizeCustomFieldType("TEXT"), "short_text");
      assert.equal(normalizeCustomFieldType("select"), "single_select");
      assert.equal(normalizeCustomFieldType("SELECT"), "single_select");
    });

    it("rejects unsupported types", () => {
      assert.throws(() => normalizeCustomFieldType("multi_select"), TenantConflictError);
      assert.throws(() => normalizeCustomFieldType("currency"), TenantConflictError);
      assert.throws(() => normalizeCustomFieldType("rating"), TenantConflictError);
      assert.throws(() => normalizeCustomFieldType(null), TenantConflictError);
      assert.throws(() => normalizeCustomFieldType(123), TenantConflictError);
    });
  });

  describe("Key validation", () => {
    it("accepts valid alphanumeric, underscore, and hyphen keys", () => {
      assert.equal(validateCustomFieldKey("client_name"), "client_name");
      assert.equal(validateCustomFieldKey("custom-field-123"), "custom-field-123");
      assert.equal(validateCustomFieldKey("CostCenter"), "CostCenter");
    });

    it("rejects empty, invalid, and reserved keys", () => {
      assert.throws(() => validateCustomFieldKey(""), TenantConflictError);
      assert.throws(() => validateCustomFieldKey("   "), TenantConflictError);
      assert.throws(() => validateCustomFieldKey("invalid space"), TenantConflictError);
      assert.throws(() => validateCustomFieldKey("invalid@char"), TenantConflictError);
      assert.throws(() => validateCustomFieldKey("dependencies"), TenantConflictError);
      assert.throws(() => validateCustomFieldKey("reminders"), TenantConflictError);
      assert.throws(() => validateCustomFieldKey("recurrence"), TenantConflictError);
      assert.throws(() => validateCustomFieldKey("delayReason"), TenantConflictError);
    });
  });

  describe("Definition validation", () => {
    it("validates valid short_text definition", () => {
      const def = validateCustomFieldDefinition({
        name: "Client Name",
        key: "client_name",
        type: "short_text",
        description: "Name of the client",
        required: true,
        sensitive: true,
      });
      assert.equal(def.name, "Client Name");
      assert.equal(def.key, "client_name");
      assert.equal(def.type, "short_text");
      assert.equal(def.required, true);
      assert.equal(def.sensitive, true);
      assert.deepEqual(def.options, []);
    });

    it("validates single_select definition with valid options", () => {
      const def = validateCustomFieldDefinition({
        name: "Department",
        key: "department",
        type: "single_select",
        options: [
          { label: "Engineering", value: "eng", color: "#3b82f6" },
          { label: "Design", value: "design" },
        ],
      });
      assert.equal(def.type, "single_select");
      assert.equal(def.options?.length, 2);
      assert.equal(def.options?.[0]?.value, "eng");
    });

    it("rejects single_select with empty options or duplicate values", () => {
      assert.throws(
        () =>
          validateCustomFieldDefinition({
            name: "Dept",
            key: "dept",
            type: "single_select",
            options: [],
          }),
        TenantConflictError,
      );

      assert.throws(
        () =>
          validateCustomFieldDefinition({
            name: "Dept",
            key: "dept",
            type: "single_select",
            options: [
              { label: "Alpha", value: "a" },
              { label: "Alpha Duplicate", value: "a" },
            ],
          }),
        TenantConflictError,
      );
    });
  });

  describe("Task custom field value validation & normalization", () => {
    const mockDefinitions: CustomFieldRecord[] = [
      {
        id: "cf-1",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: null,
        name: "Client Name",
        key: "client_name",
        type: "short_text",
        description: null,
        options: [],
        required: false,
        sensitive: false,
        order: 1,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "cf-2",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: null,
        name: "Budget",
        key: "budget",
        type: "number",
        description: null,
        options: [],
        required: false,
        sensitive: false,
        order: 2,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "cf-3",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: null,
        name: "Launch Date",
        key: "launch_date",
        type: "date",
        description: null,
        options: [],
        required: false,
        sensitive: false,
        order: 3,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "cf-4",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: null,
        name: "Stage",
        key: "stage",
        type: "single_select",
        description: null,
        options: [
          { label: "Planning", value: "planning" },
          { label: "Execution", value: "execution" },
        ],
        required: false,
        sensitive: false,
        order: 4,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "cf-5",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: null,
        name: "Reviewed",
        key: "reviewed",
        type: "checkbox",
        description: null,
        options: [],
        required: false,
        sensitive: false,
        order: 5,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "cf-6",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: null,
        name: "Website",
        key: "website",
        type: "url",
        description: null,
        options: [],
        required: false,
        sensitive: false,
        order: 6,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "cf-7",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: "proj-1",
        name: "Sprint Goal Tag",
        key: "sprint_goal_tag",
        type: "short_text",
        description: null,
        options: [],
        required: false,
        sensitive: false,
        order: 7,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "cf-8",
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: "proj-2",
        name: "Proj 2 Exclusive",
        key: "proj_2_exclusive",
        type: "short_text",
        description: null,
        options: [],
        required: false,
        sensitive: false,
        order: 8,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ];

    const ctx = { organizationId: "org-1", workspaceId: "ws-1", projectId: "proj-1" };

    it("validates and normalizes valid values for all field types", () => {
      const normalized = validateAndNormalizeTaskCustomFields(
        ctx,
        {
          client_name: "  Acme Corp  ",
          budget: 5000,
          launch_date: "2026-09-01T12:00:00.000Z",
          stage: "Planning", // label match
          reviewed: true,
          website: "https://example.com/project",
          sprint_goal_tag: "Q3-Goal",
        },
        mockDefinitions,
        { isCreate: true },
      );

      assert.equal(normalized.client_name, "Acme Corp");
      assert.equal(normalized.budget, 5000);
      assert.equal(normalized.launch_date, "2026-09-01T12:00:00.000Z");
      assert.equal(normalized.stage, "planning"); // normalized to option value
      assert.equal(normalized.reviewed, true);
      assert.equal(normalized.website, "https://example.com/project");
      assert.equal(normalized.sprint_goal_tag, "Q3-Goal");
    });

    it("accepts valid falsy values: number 0 and checkbox false", () => {
      const normalized = validateAndNormalizeTaskCustomFields(
        ctx,
        {
          budget: 0,
          reviewed: false,
        },
        mockDefinitions,
        { isCreate: true },
      );

      assert.equal(normalized.budget, 0);
      assert.equal(normalized.reviewed, false);
    });

    it("rejects unknown field keys", () => {
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { unknown_key: "value" }, mockDefinitions, { isCreate: true }),
        /Unknown custom field 'unknown_key'/,
      );
    });

    it("rejects field from another project", () => {
      assert.throws(
        () =>
          validateAndNormalizeTaskCustomFields(
            ctx, // proj-1
            { proj_2_exclusive: "value" }, // belongs to proj-2
            mockDefinitions,
            { isCreate: true },
          ),
        /Custom field 'proj_2_exclusive' belongs to another project/,
      );
    });

    it("rejects invalid types per field contract", () => {
      // number field with string or NaN
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { budget: "not-a-number" }, mockDefinitions),
        /must be a finite number/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { budget: NaN }, mockDefinitions),
        /must be a finite number/,
      );

      // date field with invalid string or types
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: "invalid-date" }, mockDefinitions),
        /must be a valid date/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: "October 1, 2026" }, mockDefinitions),
        /must be a valid date/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: "10/01/2026" }, mockDefinitions),
        /must be a valid date/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: "2026/10/01" }, mockDefinitions),
        /must be a valid date/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: "2026-02-30" }, mockDefinitions),
        /must be a valid date/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: "2026-13-01" }, mockDefinitions),
        /must be a valid date/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: 123456789 }, mockDefinitions),
        /must be a valid date/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { launch_date: new Date("invalid") }, mockDefinitions),
        /must be a valid date/,
      );

      // select field with invalid option
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { stage: "invalid_option" }, mockDefinitions),
        /Invalid option/,
      );

      // checkbox with string "true"
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { reviewed: "true" }, mockDefinitions),
        /must be a boolean/,
      );

      // url with invalid URL or non-http protocol
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { website: "javascript:alert(1)" }, mockDefinitions),
        /must be a valid HTTP or HTTPS URL/,
      );
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { website: "not a url" }, mockDefinitions),
        /must be a valid HTTP or HTTPS URL/,
      );
    });

    it("enforces required fields on create", () => {
      const requiredDefs: CustomFieldRecord[] = [
        {
          ...mockDefinitions[0]!,
          key: "req_text",
          required: true,
        },
        {
          ...mockDefinitions[1]!,
          key: "req_num",
          required: true,
        },
        {
          ...mockDefinitions[4]!,
          key: "req_bool",
          required: true,
        },
      ];

      // Missing required field
      assert.throws(
        () =>
          validateAndNormalizeTaskCustomFields(
            ctx,
            { req_num: 10, req_bool: true }, // missing req_text
            requiredDefs,
            { isCreate: true },
          ),
        /Required custom field 'req_text' is missing/,
      );

      // Empty string for required text
      assert.throws(
        () =>
          validateAndNormalizeTaskCustomFields(ctx, { req_text: "   ", req_num: 10, req_bool: true }, requiredDefs, {
            isCreate: true,
          }),
        /Required custom field 'req_text' cannot be empty/,
      );

      // 0 and false satisfy required fields
      const result = validateAndNormalizeTaskCustomFields(
        ctx,
        { req_text: "Valid", req_num: 0, req_bool: false },
        requiredDefs,
        { isCreate: true },
      );
      assert.equal(result.req_text, "Valid");
      assert.equal(result.req_num, 0);
      assert.equal(result.req_bool, false);
    });

    it("preserves system metadata keys", () => {
      const normalized = validateAndNormalizeTaskCustomFields(
        ctx,
        {
          dependencies: ["TSK-1", "TSK-2"],
          reminders: [{ id: "r1", time: "2026-08-01T00:00:00.000Z" }],
          recurrence: { frequency: "daily" },
          delayReason: "Waiting on client",
          client_name: "Test",
        },
        mockDefinitions,
        { isCreate: true },
      );

      assert.deepEqual(normalized.dependencies, ["TSK-1", "TSK-2"]);
      assert.equal(normalized.delayReason, "Waiting on client");
      assert.equal(normalized.client_name, "Test");
    });
  });

  describe("Custom field date canonicalization contract", () => {
    const dateDef: CustomFieldRecord = {
      id: "cf-date",
      organizationId: "org-1",
      workspaceId: "ws-1",
      projectId: null,
      name: "Due Date",
      key: "due_date",
      type: "date",
      description: null,
      options: [],
      required: false,
      sensitive: false,
      order: 1,
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const ctx = { organizationId: "org-1", workspaceId: "ws-1", projectId: "proj-1" };

    it("accepts and normalizes valid ISO 8601 UTC datetimes", () => {
      const res1 = validateAndNormalizeTaskCustomFields(ctx, { due_date: "2026-10-01T14:30:00.000Z" }, [dateDef]);
      assert.equal(res1.due_date, "2026-10-01T14:30:00.000Z");

      const res2 = validateAndNormalizeTaskCustomFields(ctx, { due_date: "2026-10-01T14:30:00Z" }, [dateDef]);
      assert.equal(res2.due_date, "2026-10-01T14:30:00.000Z");

      const res3 = validateAndNormalizeTaskCustomFields(ctx, { due_date: "2026-10-01T14:30Z" }, [dateDef]);
      assert.equal(res3.due_date, "2026-10-01T14:30:00.000Z");
    });

    it("accepts and normalizes valid timezone-offset ISO 8601 datetimes", () => {
      const res1 = validateAndNormalizeTaskCustomFields(ctx, { due_date: "2026-10-01T17:30:00+03:00" }, [dateDef]);
      assert.equal(res1.due_date, "2026-10-01T14:30:00.000Z");

      const res2 = validateAndNormalizeTaskCustomFields(ctx, { due_date: "2026-10-01T09:30:00-05:00" }, [dateDef]);
      assert.equal(res2.due_date, "2026-10-01T14:30:00.000Z");
    });

    it("accepts and normalizes valid date-only YYYY-MM-DD strings", () => {
      const res = validateAndNormalizeTaskCustomFields(ctx, { due_date: "2026-10-01" }, [dateDef]);
      assert.equal(res.due_date, "2026-10-01T00:00:00.000Z");
    });

    it("accepts and normalizes valid Date instances", () => {
      const dateObj = new Date("2026-10-01T14:30:00.000Z");
      const res = validateAndNormalizeTaskCustomFields(ctx, { due_date: dateObj }, [dateDef]);
      assert.equal(res.due_date, "2026-10-01T14:30:00.000Z");
    });

    it("rejects non-ISO and arbitrary locale date formats", () => {
      const invalidStrings = [
        "October 1, 2026",
        "10/01/2026",
        "01/10/2026",
        "2026/10/01",
        "01-10-2026",
        "yesterday",
        "tomorrow",
        "next Monday",
        "2026.10.01",
        "2026-1-1",
        "1234567890",
      ];

      for (const invalid of invalidStrings) {
        assert.throws(
          () => validateAndNormalizeTaskCustomFields(ctx, { due_date: invalid }, [dateDef]),
          /must be a valid date/,
          `Expected '${invalid}' to be rejected as an invalid date`,
        );
      }
    });

    it("rejects invalid calendar dates even if matching syntax", () => {
      const invalidCalendarDates = [
        "2026-02-29", // 2026 is not a leap year
        "2026-02-30",
        "2026-04-31",
        "2026-13-01",
        "2026-00-10",
        "2026-10-32",
        "2026-02-30T10:00:00Z",
      ];

      for (const invalid of invalidCalendarDates) {
        assert.throws(
          () => validateAndNormalizeTaskCustomFields(ctx, { due_date: invalid }, [dateDef]),
          /must be a valid date/,
          `Expected invalid calendar date '${invalid}' to be rejected`,
        );
      }
    });

    it("handles required vs optional date semantics correctly", () => {
      const reqDateDef = { ...dateDef, required: true };

      // Optional date cleared with null or empty string
      const optCleared = validateAndNormalizeTaskCustomFields(ctx, { due_date: null }, [dateDef]);
      assert.equal(optCleared.due_date, undefined);

      const optEmpty = validateAndNormalizeTaskCustomFields(ctx, { due_date: "   " }, [dateDef]);
      assert.equal(optEmpty.due_date, undefined);

      // Required date missing
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, {}, [reqDateDef], { isCreate: true }),
        /Required custom field 'due_date' is missing/,
      );

      // Required date empty string
      assert.throws(
        () => validateAndNormalizeTaskCustomFields(ctx, { due_date: "   " }, [reqDateDef]),
        /Required custom field 'due_date' cannot be empty/,
      );
    });
  });
});
