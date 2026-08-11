import type { Project } from "@/lib/types";

export type ProjectStatusFilter = "all" | Project["status"];
export type ProjectSortOption = "name" | "created" | "updated" | "progress" | "start" | "end";

function dateValue(value?: string | null) {
  return value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
}

export function filterAndSortProjects(
  projects: Project[],
  options: { search: string; status: ProjectStatusFilter; sort: ProjectSortOption; locale: "ar" | "en" },
) {
  const query = options.search.trim().toLocaleLowerCase(options.locale);
  return projects
    .filter((project) => {
      const matchesQuery =
        !query || `${project.name} ${project.description ?? ""}`.toLocaleLowerCase(options.locale).includes(query);
      return matchesQuery && (options.status === "all" || project.status === options.status);
    })
    .sort((left, right) => {
      if (options.sort === "name") return left.name.localeCompare(right.name, options.locale);
      if (options.sort === "progress") return right.progress - left.progress;
      if (options.sort === "created") return dateValue(right.createdAt) - dateValue(left.createdAt);
      if (options.sort === "start") return dateValue(left.startDate) - dateValue(right.startDate);
      if (options.sort === "end") return dateValue(left.endDate) - dateValue(right.endDate);
      return dateValue(right.updatedAt) - dateValue(left.updatedAt);
    });
}
