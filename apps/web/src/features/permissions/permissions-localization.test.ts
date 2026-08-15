import assert from "node:assert/strict";
import { it } from "node:test";
import type { AuthorizationPermission } from "./api";
import { permissionDescription, permissionName } from "./permissions-view";

function permission(key: string): AuthorizationPermission {
  return {
    id: key,
    key,
    name: "English permission name",
    description: "English permission description",
    category: key.split(".")[0] ?? "other",
    createdAt: new Date(0).toISOString(),
  };
}

it("localizes every permission currently registered in the authorization catalog", () => {
  const keys = [
    "organization.manage",
    "workspace.manage",
    "members.manage",
    "members.invite",
    "projects.create",
    "projects.update",
    "projects.delete",
    "projects.view_private",
    "tasks.create",
    "tasks.update",
    "tasks.update_others",
    "tasks.delete",
    "comments.manage",
    "attachments.manage",
    "documents.manage",
    "forms.manage",
    "goals.manage",
    "saved_views.manage",
    "time_logs.manage",
    "timesheets.review",
    "notifications.manage",
    "notifications.dispatch",
    "branches.manage",
    "custom_fields.manage",
    "automations.manage",
    "reports.view",
    "billing.manage",
    "data.export",
    "integrations.manage",
    "audit.view",
    "sprints.view",
    "sprints.manage",
  ];

  for (const key of keys) {
    const value = permission(key);
    assert.notEqual(permissionName(value, { locale: "ar" }), value.name, `${key} name is not localized`);
    assert.notEqual(
      permissionDescription(value, { locale: "ar" }),
      value.description,
      `${key} description is not localized`,
    );
  }
});
