import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantConflictError } from "../errors.js";
import {
  assertNoDependencyCycle,
  assertNotSelfDependency,
  assertValidLagMinutes,
  assertValidTaskDependencyType,
  canonicalDependencyKey,
  detectDependencyCycle,
  MAX_LAG_MINUTES,
  MIN_LAG_MINUTES,
  TASK_DEPENDENCY_TYPES,
} from "./task-dependencies.js";

describe("task dependencies domain contract", () => {
  describe("assertValidTaskDependencyType", () => {
    it("accepts all four canonical dependency types", () => {
      for (const type of TASK_DEPENDENCY_TYPES) {
        assert.doesNotThrow(() => assertValidTaskDependencyType(type));
      }
    });

    it("rejects unknown or invalid dependency types", () => {
      const invalidTypes = ["invalid_type", "finish-to-start", "FINISH_TO_START", "", null, undefined, 123, true, {}];

      for (const invalid of invalidTypes) {
        assert.throws(
          () => assertValidTaskDependencyType(invalid),
          (err: unknown) => err instanceof TenantConflictError,
        );
      }
    });
  });

  describe("assertValidLagMinutes", () => {
    it("accepts valid positive, negative, and zero integer minutes", () => {
      assert.equal(assertValidLagMinutes(0), 0);
      assert.equal(assertValidLagMinutes(1), 1);
      assert.equal(assertValidLagMinutes(60), 60);
      assert.equal(assertValidLagMinutes(1440), 1440);
      assert.equal(assertValidLagMinutes(-1), -1);
      assert.equal(assertValidLagMinutes(-60), -60);
      assert.equal(assertValidLagMinutes(-1440), -1440);
      assert.equal(assertValidLagMinutes(undefined), 0);
      assert.equal(assertValidLagMinutes(null), 0);
    });

    it("accepts boundary 32-bit signed integer values", () => {
      assert.equal(assertValidLagMinutes(MAX_LAG_MINUTES), 2147483647);
      assert.equal(assertValidLagMinutes(MIN_LAG_MINUTES), -2147483648);
    });

    it("rejects fractional numbers, NaN, and infinities", () => {
      const invalidNumbers = [
        0.5,
        -0.25,
        1.00001,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        "60",
        true,
        {},
      ];

      for (const invalid of invalidNumbers) {
        assert.throws(
          () => assertValidLagMinutes(invalid),
          (err: unknown) => err instanceof TenantConflictError,
        );
      }
    });

    it("rejects numbers outside the 32-bit signed integer range", () => {
      assert.throws(
        () => assertValidLagMinutes(MAX_LAG_MINUTES + 1),
        (err: unknown) => err instanceof TenantConflictError,
      );
      assert.throws(
        () => assertValidLagMinutes(MIN_LAG_MINUTES - 1),
        (err: unknown) => err instanceof TenantConflictError,
      );
    });
  });

  describe("assertNotSelfDependency", () => {
    it("allows different task IDs", () => {
      assert.doesNotThrow(() => assertNotSelfDependency("task-1", "task-2"));
    });

    it("rejects identical task IDs", () => {
      assert.throws(
        () => assertNotSelfDependency("task-1", "task-1"),
        (err: unknown) => err instanceof TenantConflictError && err.message === "A task cannot depend on itself",
      );
    });
  });

  describe("canonicalDependencyKey", () => {
    it("generates deterministic canonical identity keys", () => {
      const key1 = canonicalDependencyKey({
        blockingTaskId: "task-A",
        dependentTaskId: "task-B",
        type: "finish_to_start",
        lagMinutes: 0,
      });
      assert.equal(key1, "task-A:task-B:finish_to_start:0");

      const keyWithDefaults = canonicalDependencyKey({
        blockingTaskId: "task-A",
        dependentTaskId: "task-B",
      });
      assert.equal(keyWithDefaults, "task-A:task-B:finish_to_start:0");

      const keyDifferentLag = canonicalDependencyKey({
        blockingTaskId: "task-A",
        dependentTaskId: "task-B",
        type: "finish_to_start",
        lagMinutes: 60,
      });
      assert.notEqual(key1, keyDifferentLag);

      const keyDifferentType = canonicalDependencyKey({
        blockingTaskId: "task-A",
        dependentTaskId: "task-B",
        type: "start_to_start",
        lagMinutes: 0,
      });
      assert.notEqual(key1, keyDifferentType);
    });
  });

  describe("detectDependencyCycle & assertNoDependencyCycle", () => {
    it("accepts an empty graph", () => {
      const result = detectDependencyCycle([]);
      assert.equal(result.hasCycle, false);
      assert.doesNotThrow(() => assertNoDependencyCycle([]));
    });

    it("accepts a single directed edge (A -> B)", () => {
      const edges = [{ blockingTaskId: "A", dependentTaskId: "B" }];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, false);
      assert.doesNotThrow(() => assertNoDependencyCycle(edges));
    });

    it("detects a self-loop (A -> A)", () => {
      const edges = [{ blockingTaskId: "A", dependentTaskId: "A" }];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, true);
      assert.throws(
        () => assertNoDependencyCycle(edges),
        (err: unknown) => err instanceof TenantConflictError,
      );
    });

    it("detects a 2-node cycle (A -> B -> A)", () => {
      const edges = [
        { blockingTaskId: "A", dependentTaskId: "B" },
        { blockingTaskId: "B", dependentTaskId: "A" },
      ];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, true);
      assert.throws(
        () => assertNoDependencyCycle(edges),
        (err: unknown) => err instanceof TenantConflictError,
      );
    });

    it("detects a 3-node cycle (A -> B -> C -> A)", () => {
      const edges = [
        { blockingTaskId: "A", dependentTaskId: "B" },
        { blockingTaskId: "B", dependentTaskId: "C" },
        { blockingTaskId: "C", dependentTaskId: "A" },
      ];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, true);
      assert.throws(
        () => assertNoDependencyCycle(edges),
        (err: unknown) => err instanceof TenantConflictError,
      );
    });

    it("detects a 4-node cycle (A -> B -> C -> D -> A)", () => {
      const edges = [
        { blockingTaskId: "A", dependentTaskId: "B" },
        { blockingTaskId: "B", dependentTaskId: "C" },
        { blockingTaskId: "C", dependentTaskId: "D" },
        { blockingTaskId: "D", dependentTaskId: "A" },
      ];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, true);
      assert.throws(
        () => assertNoDependencyCycle(edges),
        (err: unknown) => err instanceof TenantConflictError,
      );
    });

    it("detects long cycles in a larger network", () => {
      const edges: Array<{ blockingTaskId: string; dependentTaskId: string }> = [];
      for (let i = 1; i <= 20; i++) {
        edges.push({ blockingTaskId: `node-${i}`, dependentTaskId: `node-${i + 1}` });
      }
      edges.push({ blockingTaskId: "node-21", dependentTaskId: "node-1" });

      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, true);
      assert.throws(
        () => assertNoDependencyCycle(edges),
        (err: unknown) => err instanceof TenantConflictError,
      );
    });

    it("accepts a diamond DAG structure without cycles (A -> B, A -> C, B -> D, C -> D)", () => {
      const edges = [
        { blockingTaskId: "A", dependentTaskId: "B" },
        { blockingTaskId: "A", dependentTaskId: "C" },
        { blockingTaskId: "B", dependentTaskId: "D" },
        { blockingTaskId: "C", dependentTaskId: "D" },
      ];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, false);
      assert.doesNotThrow(() => assertNoDependencyCycle(edges));
    });

    it("accepts complex branching graphs with shared ancestors", () => {
      const edges = [
        { blockingTaskId: "Root1", dependentTaskId: "Child1" },
        { blockingTaskId: "Root2", dependentTaskId: "Child1" },
        { blockingTaskId: "Root2", dependentTaskId: "Child2" },
        { blockingTaskId: "Child1", dependentTaskId: "Leaf1" },
        { blockingTaskId: "Child2", dependentTaskId: "Leaf1" },
        { blockingTaskId: "Child2", dependentTaskId: "Leaf2" },
      ];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, false);
      assert.doesNotThrow(() => assertNoDependencyCycle(edges));
    });

    it("accepts multiple disconnected valid DAG components", () => {
      const edges = [
        { blockingTaskId: "A1", dependentTaskId: "A2" },
        { blockingTaskId: "A2", dependentTaskId: "A3" },
        { blockingTaskId: "B1", dependentTaskId: "B2" },
        { blockingTaskId: "B2", dependentTaskId: "B3" },
        { blockingTaskId: "C1", dependentTaskId: "C2" },
      ];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, false);
      assert.doesNotThrow(() => assertNoDependencyCycle(edges));
    });

    it("detects a cycle when one disconnected component has a cycle", () => {
      const edges = [
        { blockingTaskId: "A1", dependentTaskId: "A2" },
        { blockingTaskId: "A2", dependentTaskId: "A3" },
        { blockingTaskId: "B1", dependentTaskId: "B2" },
        { blockingTaskId: "B2", dependentTaskId: "B1" }, // cycle in component B
      ];
      const result = detectDependencyCycle(edges);
      assert.equal(result.hasCycle, true);
      assert.throws(
        () => assertNoDependencyCycle(edges),
        (err: unknown) => err instanceof TenantConflictError,
      );
    });
  });
});
