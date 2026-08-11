export type PermissionCheck = (permission: string) => boolean;

export function canOpenWorkspaceView(view: string, can: PermissionCheck) {
  if (view === "billing") return can("billing.manage");
  if (view === "integrations") return can("integrations.manage");
  if (view === "activity") return can("audit.view");
  if (view === "settings") return can("workspace.manage") || can("custom_fields.manage");
  if (view === "sprints" || view === "sprint_board") return can("sprints.view");
  return true;
}
