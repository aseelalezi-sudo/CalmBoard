import type { Dispatch, SetStateAction } from "react";
import type { Organization, Timesheet, User, Workspace } from "@/lib/types";
import { reviewTimesheetRecord, submitTimesheetRecord } from "@/features/workspace/actions-api";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

type TimesheetOperationsInput = {
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  currentUser: User | null;
  setTimesheets: Setter<Timesheet[]>;
  setTimesheetReviewQueue: Setter<Timesheet[]>;
  t: Translator;
  notify: Notify;
};

export function useTimesheetOperations(input: TimesheetOperationsInput) {
  const { activeOrg, activeWorkspace, currentUser, setTimesheets, setTimesheetReviewQueue, t, notify } = input;

  const replaceTimesheet = (updated: Timesheet) => {
    setTimesheets((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setTimesheetReviewQueue((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  };

  const submitTimesheet = async (timesheet: Timesheet) => {
    if (!activeOrg || !activeWorkspace || !currentUser) return;
    try {
      const updated = await submitTimesheetRecord(timesheet, {
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
        actorId: currentUser.id,
      });
      replaceTimesheet(updated);
      notify(t("تم إرسال الجدول للمراجعة", "Timesheet submitted for review"));
    } catch (error) {
      notify(error instanceof Error ? error.message : t("تعذر إرسال الجدول", "Could not submit timesheet"), "error");
    }
  };

  const reviewTimesheet = async (timesheet: Timesheet, decision: "approved" | "rejected", reason?: string) => {
    if (!activeOrg || !activeWorkspace || !currentUser) return;
    try {
      const updated = await reviewTimesheetRecord(timesheet, decision, reason, {
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
        actorId: currentUser.id,
      });
      replaceTimesheet(updated);
      notify(
        decision === "approved"
          ? t("تم اعتماد الفترة وقفلها", "Timesheet approved and locked")
          : t("تم رفض الجدول وإعادته للعضو", "Timesheet rejected and returned"),
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : t("تعذر تحديث الجدول", "Could not update timesheet"), "error");
    }
  };

  return { submitTimesheet, reviewTimesheet };
}
