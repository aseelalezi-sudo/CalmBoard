ALTER TABLE IF EXISTS notifications
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

UPDATE notifications AS notification
SET
  organization_id = task.organization_id,
  workspace_id = task.workspace_id
FROM tasks AS task
WHERE notification.entity_type = 'task'
  AND notification.entity_id = task.id
  AND (
    notification.organization_id IS NULL
    OR notification.workspace_id IS NULL
  );

DO $$
BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT notifications_organization_id_fk
    FOREIGN KEY (organization_id) REFERENCES organizations(id) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT notifications_workspace_id_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS notifications_tenant_user_created_idx
  ON notifications (organization_id, workspace_id, user_id, created_at DESC);

-- Rows that remain without tenant identifiers are intentionally not guessed.
-- Review or delete them before making both columns NOT NULL in the baseline migration.
