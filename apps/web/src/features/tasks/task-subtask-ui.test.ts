import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const drawer = readFileSync(new URL("./task-drawer.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("./advanced-task-table.tsx", import.meta.url), "utf8");
const views = readFileSync(new URL("./task-views.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("./use-task-operations.ts", import.meta.url), "utf8");

describe("task and subtask UI contracts", () => {
  it("enforces top-level task isolation in Table, Board, and List views", () => {
    // Table only uses top-level tasks for its main dataset
    assert.match(
      table,
      /const topLevelTasks = useMemo\(\(\) => ctx\.tasks\.filter\(\(task\) => !task\.parentId\), \[ctx\.tasks\]\);/,
    );
    assert.match(table, /data: topLevelTasks/);

    // Board only renders top-level tasks as draggable column cards
    assert.match(
      views,
      /taskSubtasks = useMemo\(\(\) => ctx\.tasks\.filter\(\(t\) => t\.parentId === task\.id\), \[ctx\.tasks, task\.id\]\);/,
    );

    // List view only displays top-level tasks in list/table format
    assert.match(
      views,
      /const topLevelTasks = useMemo\(\(\) => ctx\.tasks\.filter\(\(t\) => !t\.parentId\), \[ctx\.tasks\]\);/,
    );
  });

  it("provides parent breadcrumb navigation and standalone detachment in Task Drawer", () => {
    // Drawer shows parent banner and navigation
    assert.match(drawer, /\{task\.parentId &&/);
    assert.match(drawer, /الانتقال للمهمة الرئيسية ←|Go to Parent →/);
    assert.match(drawer, /ctx\.openTask\(parentTask\)|ctx\.openTaskById/);

    // Drawer allows detaching subtask to become top-level
    assert.match(drawer, /ctx\.updateTask\(task\.id, \{ parentId: null \}\)/);
    assert.match(drawer, /فصل لتصبح مهمة رئيسية مستقلة|Convert to Standalone Top-Level Task/);
  });

  it("supports quick inline subtask creation and completion toggle across Table, Board, and Drawer", () => {
    // Table inline subtasks
    assert.match(table, /subtasksByParentId\.get\(taskId\) \|\| \[\]/);
    assert.match(table, /<SubtaskTableRow key=\{subtask\.id\} subtask=\{subtask\}/);
    assert.match(table, /Add new subtask… \(Press Enter\)/);

    // Board inline subtasks
    assert.match(views, /Toggle subtasks checklist/);
    assert.match(views, /\+ Add subtask… \(Enter\)/);

    // Operation handlers maintain canonical state and refresh
    assert.match(operations, /setSubtasks\(\(previous\) => \[\.\.\.previous, created\]\)/);
    assert.match(operations, /deleteSubtask/);
  });
});
