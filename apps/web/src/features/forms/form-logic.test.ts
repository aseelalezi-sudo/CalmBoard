import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FormField } from "@/lib/types";
import { validateVisibleFields, visibleFormFields } from "./form-logic";

const fields: FormField[] = [
  { id: "kind", type: "select", label: "Kind", required: true, options: ["Bug", "Feature"] },
  {
    id: "email",
    type: "email",
    label: "Email",
    required: true,
    condition: { fieldId: "kind", operator: "equals", value: "Bug" },
  },
];

describe("public form conditional fields", () => {
  it("shows a dependent field only when its condition matches", () => {
    assert.deepEqual(
      visibleFormFields(fields, { kind: "Feature" }).map((field) => field.id),
      ["kind"],
    );
    assert.deepEqual(
      visibleFormFields(fields, { kind: "Bug" }).map((field) => field.id),
      ["kind", "email"],
    );
  });

  it("requires and validates only fields visible to the submitter", () => {
    assert.deepEqual(validateVisibleFields(fields, { kind: "Feature" }), {});
    assert.deepEqual(validateVisibleFields(fields, { kind: "Bug" }), { email: "required" });
    assert.deepEqual(validateVisibleFields(fields, { kind: "Bug", email: "invalid" }), { email: "email" });
  });
});
