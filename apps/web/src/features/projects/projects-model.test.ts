import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Project } from "@/lib/types";
import { filterAndSortProjects } from "./projects-model";

const projects: Project[] = [
  {
    id: "planning",
    organizationId: "org",
    workspaceId: "workspace",
    name: "إطلاق التطبيق",
    description: "Mobile launch",
    color: "#6366f1",
    icon: "folder",
    status: "planning",
    priority: "high",
    progress: 20,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "archived",
    organizationId: "org",
    workspaceId: "workspace",
    name: "Archive",
    description: "Legacy Project",
    color: "#64748b",
    icon: "folder",
    status: "archived",
    priority: "low",
    progress: 90,
    version: 3,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

describe("Projects Hub filtering and sorting", () => {
  it("searches Arabic names and English descriptions case-insensitively", () => {
    assert.deepEqual(
      filterAndSortProjects(projects, { search: "إطلاق", status: "all", sort: "name", locale: "ar" }).map(
        (project) => project.id,
      ),
      ["planning"],
    );
    assert.deepEqual(
      filterAndSortProjects(projects, { search: "LEGACY", status: "all", sort: "name", locale: "en" }).map(
        (project) => project.id,
      ),
      ["archived"],
    );
  });

  it("uses the real project status values and supported sort fields", () => {
    assert.deepEqual(
      filterAndSortProjects(projects, { search: "", status: "archived", sort: "progress", locale: "en" }).map(
        (project) => project.id,
      ),
      ["archived"],
    );
    assert.deepEqual(
      filterAndSortProjects(projects, { search: "", status: "all", sort: "updated", locale: "en" }).map(
        (project) => project.id,
      ),
      ["archived", "planning"],
    );
  });
});
