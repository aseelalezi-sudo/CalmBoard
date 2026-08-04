import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Doc } from "@/lib/types";
import { flattenDocumentTree } from "./document-tree";

function document(id: string, parentId: string | null = null): Doc {
  return {
    id,
    organizationId: "organization",
    workspaceId: "workspace",
    parentId,
    title: id,
    icon: "📄",
  };
}

describe("document tree", () => {
  it("orders nested pages by hierarchy and promotes inaccessible parents to roots", () => {
    const result = flattenDocumentTree([
      document("child", "root"),
      document("orphan", "hidden-parent"),
      document("root"),
      document("grandchild", "child"),
    ]);
    assert.deepEqual(
      result.map(({ document: item, depth }) => [item.id, depth]),
      [
        ["orphan", 0],
        ["root", 0],
        ["child", 1],
        ["grandchild", 2],
      ],
    );
  });

  it("does not recurse forever when legacy data contains a cycle", () => {
    const result = flattenDocumentTree([document("a", "b"), document("b", "a")]);
    assert.deepEqual(
      result.map(({ document: item, depth }) => [item.id, depth]),
      [
        ["a", 0],
        ["b", 0],
      ],
    );
  });
});
