ALTER TABLE public.goals ADD COLUMN source_project_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retain_goal_project_sources()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Sources are monotonic: neither a normal edit nor an older client clears history.
  SELECT COALESCE(array_agg(DISTINCT source ORDER BY source), '{}'::uuid[])
  INTO NEW.source_project_ids
  FROM unnest(CASE WHEN TG_OP = 'UPDATE'
    THEN OLD.source_project_ids || NEW.source_project_ids
    ELSE NEW.source_project_ids END) AS source
  WHERE source IS NOT NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goals_retain_project_sources
BEFORE INSERT OR UPDATE OF source_project_ids ON public.goals
FOR EACH ROW EXECUTE FUNCTION public.retain_goal_project_sources();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.propagate_goal_project_sources()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE public.goals
    SET source_project_ids = source_project_ids || NEW.source_project_ids
    WHERE id = NEW.parent_id
      AND organization_id = NEW.organization_id AND workspace_id = NEW.workspace_id
      AND NOT (NEW.source_project_ids <@ source_project_ids);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.parent_id IS DISTINCT FROM NEW.parent_id AND OLD.parent_id IS NOT NULL THEN
    UPDATE public.goals
    SET source_project_ids = source_project_ids || OLD.source_project_ids
    WHERE id = OLD.parent_id
      AND organization_id = OLD.organization_id AND workspace_id = OLD.workspace_id
      AND NOT (OLD.source_project_ids <@ source_project_ids);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goals_propagate_project_sources
AFTER INSERT OR UPDATE OF source_project_ids, parent_id ON public.goals
FOR EACH ROW EXECUTE FUNCTION public.propagate_goal_project_sources();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retain_goal_link_project_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  linked_goal uuid;
  linked_task uuid;
  source_project uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    linked_goal := OLD.goal_id;
    linked_task := OLD.task_id;
  ELSE
    linked_goal := NEW.goal_id;
    linked_task := NEW.task_id;
  END IF;
  SELECT project_id INTO source_project FROM public.tasks WHERE id = linked_task;
  IF source_project IS NOT NULL THEN
    UPDATE public.goals SET source_project_ids = source_project_ids || ARRAY[source_project]
    WHERE id = linked_goal AND NOT (ARRAY[source_project] <@ source_project_ids);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goal_task_links_retain_project_source
AFTER INSERT OR UPDATE OF goal_id, task_id OR DELETE ON public.goal_task_links
FOR EACH ROW EXECUTE FUNCTION public.retain_goal_link_project_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retain_goal_task_project_sources()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  sources uuid[];
BEGIN
  sources := ARRAY[OLD.project_id];
  IF TG_OP = 'UPDATE' THEN sources := sources || ARRAY[NEW.project_id]; END IF;
  UPDATE public.goals goal SET source_project_ids = goal.source_project_ids || sources
  WHERE goal.organization_id = OLD.organization_id AND goal.workspace_id = OLD.workspace_id
    AND goal.id IN (SELECT goal_id FROM public.goal_task_links WHERE task_id = OLD.id)
    AND NOT (sources <@ goal.source_project_ids);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tasks_retain_goal_project_sources
BEFORE DELETE OR UPDATE OF project_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.retain_goal_task_project_sources();
--> statement-breakpoint
-- Backfill existing links, including soft-deleted tasks/results. Parent propagation
-- retains their contribution even if the child is later moved or removed.
UPDATE public.goals goal
SET source_project_ids = sources.project_ids
FROM (
  SELECT link.goal_id, array_agg(DISTINCT task.project_id ORDER BY task.project_id) AS project_ids
  FROM public.goal_task_links link
  JOIN public.tasks task ON task.id = link.task_id
    AND task.organization_id = link.organization_id AND task.workspace_id = link.workspace_id
  GROUP BY link.goal_id
) sources
WHERE goal.id = sources.goal_id;
