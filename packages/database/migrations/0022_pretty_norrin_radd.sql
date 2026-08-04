ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO "permissions" ("key", "name", "description", "category") VALUES
  ('tasks.update', 'Update tasks', 'Update task content and workflow state', 'tasks'),
  ('comments.manage', 'Manage comments', 'Create, update, react to, or remove comments', 'collaboration'),
  ('attachments.manage', 'Manage attachments', 'Upload or remove task and project attachments', 'collaboration'),
  ('documents.manage', 'Manage documents', 'Create, update, version, or restore documents', 'content'),
  ('forms.manage', 'Manage forms', 'Create and configure workspace forms', 'content'),
  ('goals.manage', 'Manage goals', 'Create and update goals and check-ins', 'planning'),
  ('saved_views.manage', 'Manage saved views', 'Create and remove saved workspace views', 'workspace'),
  ('time_logs.manage', 'Manage time logs', 'Create personal time entries', 'tasks'),
  ('notifications.manage', 'Manage notifications', 'Update personal notification state', 'notifications'),
  ('notifications.dispatch', 'Dispatch notifications', 'Dispatch organization or workspace digests', 'notifications'),
  ('branches.manage', 'Manage branches', 'Create and update organization branches', 'organization')
ON CONFLICT ("key") DO UPDATE SET
  "name" = excluded."name",
  "description" = excluded."description",
  "category" = excluded."category";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
JOIN "permissions" permission ON permission."key" = ANY (
  CASE role."key"
    WHEN 'owner' THEN ARRAY[
      'tasks.update', 'comments.manage', 'attachments.manage', 'documents.manage', 'forms.manage',
      'goals.manage', 'saved_views.manage', 'time_logs.manage', 'notifications.manage',
      'notifications.dispatch', 'branches.manage'
    ]::text[]
    WHEN 'admin' THEN ARRAY[
      'tasks.update', 'comments.manage', 'attachments.manage', 'documents.manage', 'forms.manage',
      'goals.manage', 'saved_views.manage', 'time_logs.manage', 'notifications.manage',
      'notifications.dispatch', 'branches.manage'
    ]::text[]
    WHEN 'manager' THEN ARRAY[
      'tasks.update', 'comments.manage', 'attachments.manage', 'documents.manage', 'forms.manage',
      'goals.manage', 'saved_views.manage', 'time_logs.manage', 'notifications.manage',
      'notifications.dispatch', 'branches.manage'
    ]::text[]
    WHEN 'member' THEN ARRAY[
      'tasks.update', 'comments.manage', 'attachments.manage', 'documents.manage', 'goals.manage',
      'saved_views.manage', 'time_logs.manage', 'notifications.manage'
    ]::text[]
    ELSE ARRAY[]::text[]
  END
)
WHERE role."is_system" = true
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
DELETE FROM "role_permissions" grant_row
USING "roles" role, "permissions" permission
WHERE grant_row."role_id" = role."id"
  AND grant_row."permission_id" = permission."id"
  AND role."is_system" = true
  AND role."key" = 'guest'
  AND permission."key" = 'tasks.create';
