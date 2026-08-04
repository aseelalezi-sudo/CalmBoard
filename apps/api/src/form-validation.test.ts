import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  defaultFormSettings,
  parseFormFields,
  parseFormSettings,
  parsePublicFormSubmission,
} from "./form-validation.js";

describe("form builder validation", () => {
  it("accepts bounded fields whose conditions reference an earlier field", () => {
    const fields = parseFormFields([
      { id: "request_type", type: "select", label: "Type", options: ["Bug", "Feature"], required: true },
      {
        id: "bug_details",
        type: "textarea",
        label: "Bug details",
        required: true,
        condition: { fieldId: "request_type", operator: "equals", value: "Bug" },
      },
    ]);
    assert.equal(fields[1]?.condition?.fieldId, "request_type");
    assert.throws(
      () =>
        parseFormFields([
          {
            id: "details",
            type: "text",
            label: "Details",
            condition: { fieldId: "future", operator: "equals", value: "yes" },
          },
          { id: "future", type: "text", label: "Future" },
        ]),
      BadRequestException,
    );
  });

  it("rejects duplicate fields and choice fields without valid options", () => {
    assert.throws(
      () =>
        parseFormFields([
          { id: "same", type: "text", label: "One" },
          { id: "same", type: "text", label: "Two" },
        ]),
      BadRequestException,
    );
    assert.throws(() => parseFormFields([{ id: "choice", type: "select", label: "Choice", options: [] }]));
  });

  it("validates only visible answers and removes hidden or unknown values", () => {
    const fields = parseFormFields([
      { id: "kind", type: "select", label: "Kind", options: ["Bug", "Feature"], required: true },
      {
        id: "details",
        type: "textarea",
        label: "Details",
        required: true,
        condition: { fieldId: "kind", operator: "equals", value: "Bug" },
      },
    ]);
    assert.deepEqual(
      parsePublicFormSubmission(
        { values: { kind: "Feature", details: "must not persist", injected: "ignored" }, captchaToken: "token" },
        fields,
      ),
      { values: { kind: "Feature" }, captchaToken: "token" },
    );
    assert.throws(
      () => parsePublicFormSubmission({ values: { kind: "Bug" }, captchaToken: "token" }, fields),
      /details is required/,
    );
  });

  it("normalizes legacy settings into the versioned contract", () => {
    assert.deepEqual(parseFormSettings({ createTask: false, captchaEnabled: false }), {
      ...defaultFormSettings,
      createTask: false,
      captchaEnabled: false,
      taskTitleFieldId: undefined,
      taskDescriptionFieldId: undefined,
      submitLabel: undefined,
      successMessage: undefined,
    });
  });
});
