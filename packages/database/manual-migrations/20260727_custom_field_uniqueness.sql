-- Protect custom-field keys from concurrent duplicates.
-- Historical duplicates are reported for manual review instead of being deleted.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM custom_fields
    GROUP BY organization_id, workspace_id, project_id, key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate custom field keys must be resolved before applying uniqueness constraints';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_workspace_key_unique
  ON custom_fields (organization_id, workspace_id, key)
  WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_project_key_unique
  ON custom_fields (organization_id, workspace_id, project_id, key)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS automation_runs_automation_created_lookup
  ON automation_runs (automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activities_tenant_created_lookup
  ON activities (organization_id, workspace_id, created_at DESC);
