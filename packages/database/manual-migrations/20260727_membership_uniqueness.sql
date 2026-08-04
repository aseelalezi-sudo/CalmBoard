-- Prevent duplicate tenant memberships and concurrent duplicate invitations.
-- This migration deliberately stops if historical duplicates exist so they can
-- be reviewed rather than deleted or merged automatically.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM memberships
    GROUP BY user_id, organization_id, workspace_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate memberships must be resolved before applying membership uniqueness constraints';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM invitations
    WHERE status = 'pending'
    GROUP BY organization_id, workspace_id, lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate pending invitations must be resolved before applying invitation uniqueness constraints';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_org_workspace_unique
  ON memberships (user_id, organization_id, workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_org_orgwide_unique
  ON memberships (user_id, organization_id)
  WHERE workspace_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_org_workspace_email_unique
  ON invitations (organization_id, workspace_id, lower(email))
  WHERE status = 'pending' AND workspace_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_orgwide_email_unique
  ON invitations (organization_id, lower(email))
  WHERE status = 'pending' AND workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS memberships_tenant_status_lookup
  ON memberships (organization_id, workspace_id, status, user_id);
