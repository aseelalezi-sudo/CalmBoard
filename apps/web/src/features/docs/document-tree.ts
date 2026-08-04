import type { Doc } from "@/lib/types";

export type DocumentTreeEntry = { document: Doc; depth: number };

export function flattenDocumentTree(documents: Doc[]): DocumentTreeEntry[] {
  const documentIds = new Set(documents.map((document) => document.id));
  const children = new Map<string | null, Doc[]>();
  for (const document of documents) {
    const parentId = document.parentId && documentIds.has(document.parentId) ? document.parentId : null;
    children.set(parentId, [...(children.get(parentId) ?? []), document]);
  }
  const result: DocumentTreeEntry[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const document of children.get(parentId) ?? []) {
      if (visited.has(document.id)) continue;
      visited.add(document.id);
      result.push({ document, depth });
      visit(document.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const document of documents) {
    if (!visited.has(document.id)) result.push({ document, depth: 0 });
  }
  return result;
}
