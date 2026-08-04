import type { ViewCtx } from "@/lib/types";
import { ActivityView } from "@/features/activity/activity-view";
import { AutomationView } from "@/features/automations/automation-view";
import { BillingView } from "@/features/billing/billing-view";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { DocsView } from "@/features/docs/docs-view";
import { FormsView } from "@/features/forms/forms-view";
import { GoalsView } from "@/features/goals/goals-view";
import { InboxView } from "@/features/inbox/inbox-view";
import { IntegrationsView } from "@/features/integrations/integrations-view";
import { MembersView } from "@/features/members/members-view";
import { SettingsView } from "@/features/settings/settings-view";
import {
  BoardView,
  CalendarView,
  ListView,
  MyWorkView,
  TableView,
  TimelineView,
  WorkloadView,
} from "@/features/tasks/task-views";
import { TimeView } from "@/features/time/time-view";
import { ProfileSecurityView } from "@/components/profile-security";

export function ActiveView({ activeView, ctx }: { activeView: string; ctx: ViewCtx }) {
  return (
    <div className="animate-fade" key={activeView}>
      {activeView === "board" && <BoardView ctx={ctx} />}
      {activeView === "list" && <ListView ctx={ctx} />}
      {activeView === "table" && <TableView ctx={ctx} />}
      {activeView === "calendar" && <CalendarView ctx={ctx} />}
      {activeView === "timeline" && <TimelineView ctx={ctx} />}
      {activeView === "workload" && <WorkloadView ctx={ctx} />}
      {activeView === "mywork" && <MyWorkView ctx={ctx} />}
      {activeView === "dashboard" && <DashboardView ctx={ctx} />}
      {activeView === "docs" && <DocsView ctx={ctx} />}
      {activeView === "goals" && <GoalsView ctx={ctx} />}
      {activeView === "time" && <TimeView ctx={ctx} />}
      {activeView === "automation" && <AutomationView ctx={ctx} />}
      {activeView === "members" && <MembersView ctx={ctx} />}
      {activeView === "inbox" && <InboxView ctx={ctx} />}
      {activeView === "forms" && <FormsView ctx={ctx} />}
      {activeView === "integrations" && <IntegrationsView ctx={ctx} />}
      {activeView === "billing" && <BillingView ctx={ctx} />}
      {activeView === "activity" && <ActivityView ctx={ctx} />}
      {activeView === "settings" && <SettingsView ctx={ctx} />}
      {activeView === "profile" && <ProfileSecurityView ctx={ctx} />}
    </div>
  );
}
