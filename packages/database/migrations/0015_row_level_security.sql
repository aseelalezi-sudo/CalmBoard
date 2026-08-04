CREATE OR REPLACE FUNCTION public.app_setting_uuid(setting_name text)
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN value::uuid
    ELSE NULL
  END
  FROM (SELECT NULLIF(current_setting(setting_name, true), '') AS value) setting_value;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_current_organization_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT public.app_setting_uuid('app.organization_id') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_current_workspace_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT public.app_setting_uuid('app.workspace_id') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_current_actor_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT public.app_setting_uuid('app.actor_id') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_tenant_matches(
  row_organization_id uuid,
  row_workspace_id uuid DEFAULT NULL,
  allow_organization_wide_row boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT row_organization_id = public.app_current_organization_id()
    AND (
      public.app_current_workspace_id() IS NULL
      OR row_workspace_id = public.app_current_workspace_id()
      OR (allow_organization_wide_row AND row_workspace_id IS NULL)
    );
$$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'task_serial_sequences', 'branches', 'invoices', 'subscriptions', 'usage_limits'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (organization_id = public.app_current_organization_id()) WITH CHECK (organization_id = public.app_current_organization_id())',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE POLICY forms_public_select ON public.forms FOR SELECT
USING (is_active = true AND deleted_at IS NULL);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'activities', 'attachments', 'automation_runs', 'automations', 'comments',
    'custom_fields', 'doc_versions', 'docs', 'form_responses', 'forms', 'goals',
    'integration_credentials', 'notifications', 'project_members', 'project_sections',
    'projects', 'saved_views', 'task_approval_requests', 'task_approval_reviewers',
    'task_assignees', 'task_checklist_items', 'task_checklists', 'task_dependencies',
    'task_followers', 'task_recurrence_rules', 'task_relations', 'task_reminders',
    'tasks', 'teams', 'time_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (public.app_tenant_matches(organization_id, workspace_id)) WITH CHECK (public.app_tenant_matches(organization_id, workspace_id))',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'idempotency_keys', 'invitations', 'membership_permission_overrides',
    'membership_role_bindings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (public.app_tenant_matches(organization_id, workspace_id, true)) WITH CHECK (public.app_tenant_matches(organization_id, workspace_id, true))',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_select ON public.organizations FOR SELECT
USING (
  id = public.app_current_organization_id()
  OR owner_id = public.app_current_actor_id()
  OR EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.organization_id = organizations.id
      AND membership.user_id = public.app_current_actor_id()
      AND membership.status = 'active'
  )
);
CREATE POLICY organizations_insert ON public.organizations FOR INSERT
WITH CHECK (id = public.app_current_organization_id());
CREATE POLICY organizations_update ON public.organizations FOR UPDATE
USING (id = public.app_current_organization_id())
WITH CHECK (id = public.app_current_organization_id());
CREATE POLICY organizations_delete ON public.organizations FOR DELETE
USING (id = public.app_current_organization_id());
--> statement-breakpoint
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_select ON public.workspaces FOR SELECT
USING (
  public.app_tenant_matches(organization_id, id)
  OR EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.organization_id = workspaces.organization_id
      AND membership.user_id = public.app_current_actor_id()
      AND membership.status = 'active'
      AND (membership.workspace_id IS NULL OR membership.workspace_id = workspaces.id)
  )
);
CREATE POLICY workspaces_insert ON public.workspaces FOR INSERT
WITH CHECK (public.app_tenant_matches(organization_id, id));
CREATE POLICY workspaces_update ON public.workspaces FOR UPDATE
USING (public.app_tenant_matches(organization_id, id))
WITH CHECK (public.app_tenant_matches(organization_id, id));
CREATE POLICY workspaces_delete ON public.workspaces FOR DELETE
USING (public.app_tenant_matches(organization_id, id));
--> statement-breakpoint
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON public.memberships FOR SELECT
USING (
  public.app_tenant_matches(organization_id, workspace_id, true)
  OR user_id = public.app_current_actor_id()
);
CREATE POLICY memberships_insert ON public.memberships FOR INSERT
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id, true));
CREATE POLICY memberships_update ON public.memberships FOR UPDATE
USING (public.app_tenant_matches(organization_id, workspace_id, true))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id, true));
CREATE POLICY memberships_delete ON public.memberships FOR DELETE
USING (public.app_tenant_matches(organization_id, workspace_id, true));
--> statement-breakpoint
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON public.roles FOR SELECT
USING (organization_id IS NULL OR organization_id = public.app_current_organization_id());
CREATE POLICY roles_insert ON public.roles FOR INSERT
WITH CHECK (organization_id = public.app_current_organization_id());
CREATE POLICY roles_update ON public.roles FOR UPDATE
USING (organization_id = public.app_current_organization_id())
WITH CHECK (organization_id = public.app_current_organization_id());
CREATE POLICY roles_delete ON public.roles FOR DELETE
USING (organization_id = public.app_current_organization_id());
--> statement-breakpoint
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select ON public.role_permissions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.roles role
    WHERE role.id = role_permissions.role_id
      AND (role.organization_id IS NULL OR role.organization_id = public.app_current_organization_id())
  )
);
CREATE POLICY role_permissions_insert ON public.role_permissions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roles role
    WHERE role.id = role_permissions.role_id
      AND role.organization_id = public.app_current_organization_id()
  )
);
CREATE POLICY role_permissions_update ON public.role_permissions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.roles role
    WHERE role.id = role_permissions.role_id
      AND role.organization_id = public.app_current_organization_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roles role
    WHERE role.id = role_permissions.role_id
      AND role.organization_id = public.app_current_organization_id()
  )
);
CREATE POLICY role_permissions_delete ON public.role_permissions FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.roles role
    WHERE role.id = role_permissions.role_id
      AND role.organization_id = public.app_current_organization_id()
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.resolve_public_form_tenant(requested_form_id uuid)
RETURNS TABLE (organization_id uuid, workspace_id uuid)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT form.organization_id, form.workspace_id
  FROM public.forms form
  WHERE form.id = requested_form_id
    AND form.is_active = true
    AND form.deleted_at IS NULL
  LIMIT 1;
$$;
