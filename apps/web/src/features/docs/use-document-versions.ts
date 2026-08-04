import { useState } from "react";
import type { Doc, ViewCtx } from "@/lib/types";
import {
  getDocumentVersions,
  restoreDocumentVersion,
  saveDocumentSnapshot,
  type DocumentVersion,
} from "@/features/docs/api";

export function useDocumentVersions(doc: Doc | null, ctx: ViewCtx) {
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const loadVersions = async () => {
    if (!doc) return;
    setLoadingVersions(true);
    setShowVersionsModal(true);
    try {
      const records = await getDocumentVersions(doc);
      if (Array.isArray(records)) setVersions(records);
    } finally {
      setLoadingVersions(false);
    }
  };

  const saveSnapshot = async () => {
    if (!doc) return;
    const result = await saveDocumentSnapshot(doc);
    if (result.ok) {
      ctx.notify(ctx.t("تم حفظ لقطة إصدار جديدة ✓", "Version snapshot saved ✓"));
      await loadVersions();
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (!doc) return;
    if (!confirm(ctx.t("هل أنت متأكد من استعادة هذا الإصدار؟", "Are you sure you want to restore this version?"))) {
      return;
    }
    const result = await restoreDocumentVersion(doc, versionId);
    if (result.ok && result.doc) {
      ctx.patchDoc(doc.id, { title: result.doc.title, content: result.doc.content });
      setShowVersionsModal(false);
      ctx.notify(ctx.t("تمت استعادة الإصدار بنجاح ✓", "Version restored successfully ✓"));
    }
  };

  return {
    showVersionsModal,
    setShowVersionsModal,
    versions,
    loadingVersions,
    loadVersions,
    saveSnapshot,
    restoreVersion,
  };
}
