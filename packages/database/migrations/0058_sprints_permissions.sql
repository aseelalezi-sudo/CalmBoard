INSERT INTO "permissions" ("id", "key", "name", "description", "category")
VALUES
  (gen_random_uuid(), 'sprints.view', 'View Sprints', 'View sprints', 'sprints'),
  (gen_random_uuid(), 'sprints.manage', 'Manage Sprints', 'Manage sprints', 'sprints')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions"
WHERE "roles"."key" IN ('owner', 'admin', 'manager', 'member', 'guest', 'viewer') AND "permissions"."key" = 'sprints.view'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions"
WHERE "roles"."key" IN ('owner', 'admin', 'manager') AND "permissions"."key" = 'sprints.manage'
ON CONFLICT DO NOTHING;
