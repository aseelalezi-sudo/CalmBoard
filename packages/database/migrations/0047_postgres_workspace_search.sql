CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX tasks_search_fts_idx
ON public.tasks
USING gin (
  to_tsvector(
    'simple'::regconfig,
    coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(serial, '')
  )
)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX tasks_search_trgm_idx
ON public.tasks
USING gin (
  lower(coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(serial, '')) gin_trgm_ops
)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX projects_search_fts_idx
ON public.projects
USING gin (
  to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(description, ''))
)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX projects_search_trgm_idx
ON public.projects
USING gin (lower(coalesce(name, '') || ' ' || coalesce(description, '')) gin_trgm_ops)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX docs_search_fts_idx
ON public.docs
USING gin (
  to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(content, ''))
)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX docs_search_trgm_idx
ON public.docs
USING gin (lower(coalesce(title, '') || ' ' || coalesce(content, '')) gin_trgm_ops)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX comments_search_fts_idx
ON public.comments
USING gin (to_tsvector('simple'::regconfig, coalesce(content, '')))
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX comments_search_trgm_idx
ON public.comments
USING gin (lower(coalesce(content, '')) gin_trgm_ops)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX teams_search_tenant_active_idx
ON public.teams (organization_id, workspace_id)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX teams_search_fts_idx
ON public.teams
USING gin (
  to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(description, ''))
)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX teams_search_trgm_idx
ON public.teams
USING gin (lower(coalesce(name, '') || ' ' || coalesce(description, '')) gin_trgm_ops)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX attachments_search_fts_idx
ON public.attachments
USING gin (
  to_tsvector('simple'::regconfig, coalesce(file_name, '') || ' ' || coalesce(mime_type, ''))
)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX attachments_search_trgm_idx
ON public.attachments
USING gin (lower(coalesce(file_name, '') || ' ' || coalesce(mime_type, '')) gin_trgm_ops)
WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX users_search_fts_idx
ON public.users
USING gin (to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(email, '')));
--> statement-breakpoint
CREATE INDEX users_search_trgm_idx
ON public.users
USING gin (lower(coalesce(name, '') || ' ' || coalesce(email, '')) gin_trgm_ops);
