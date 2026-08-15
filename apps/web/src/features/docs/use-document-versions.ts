import { useState } from "react";
import type { Doc, ViewCtx } from "@/lib/types";
import { confirmAction } from "@/components/feedback";
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
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionActionBusy, setVersionActionBusy] = useState(false);

  const loadVersions = async () => {
    if (!doc) return;
    setLoadingVersions(true);
    setVersionError(null);
    setShowVersionsModal(true);
    try {
      const records = await getDocumentVersions(doc);
      if (Array.isArray(records)) setVersions(records);
    } catch (error) {
      setVersionError(
        error instanceof Error
          ? error.message
          : ctx.t("تعذر تحميل إصدارات المستند", "Failed to load document versions"),
      );
    } finally {
      setLoadingVersions(false);
    }
  };

  const saveSnapshot = async () => {
    if (!doc || versionActionBusy) return;
    setVersionActionBusy(true);
    try {
      const result = await saveDocumentSnapshot(doc);
      if (result.ok) {
        ctx.notify(ctx.t("تم حفظ لقطة إصدار جديدة ✓", "Version snapshot saved ✓"));
        await loadVersions();
      }
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("تعذر حفظ لقطة الإصدار", "Failed to save version snapshot"),
        "error",
      );
    } finally {
      setVersionActionBusy(false);
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (!doc || versionActionBusy) return;
    const confirmed = await confirmAction({
      title: ctx.t("استعادة إصدار المستند", "Restore document version"),
      message: ctx.t("هل أنت متأكد من استعادة هذا الإصدار؟", "Are you sure you want to restore this version?"),
      tone: "danger",
    });
    if (!confirmed) return;

    setVersionActionBusy(true);
    try {
      const result = await restoreDocumentVersion(doc, versionId);
      if (result.ok && result.doc) {
        ctx.patchDoc(doc.id, { title: result.doc.title, content: result.doc.content });
        setShowVersionsModal(false);
        ctx.notify(ctx.t("تمت استعادة الإصدار بنجاح ✓", "Version restored successfully ✓"));
      }
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("تعذر استعادة الإصدار", "Failed to restore version"),
        "error",
      );
    } finally {
      setVersionActionBusy(false);
    }
  };

  return {
    showVersionsModal,
    setShowVersionsModal,
    versions,
    loadingVersions,
    versionError,
    versionActionBusy,
    loadVersions,
    saveSnapshot,
    restoreVersion,
  };
}
