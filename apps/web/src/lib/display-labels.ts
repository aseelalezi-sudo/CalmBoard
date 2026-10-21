import { PRIORITY_CONFIG, STATUS_CONFIG, type ViewCtx } from "./types";

type Translate = ViewCtx["t"];

function translatedValue(value: string, labels: Record<string, [string, string]>, t: Translate) {
  const label = labels[value];
  return label ? t(label[0], label[1]) : value.replaceAll(/[._]/g, " ");
}

export function taskStatusLabel(value: string, t: Translate) {
  const label = STATUS_CONFIG[value];
  return label ? t(label.ar, label.en) : value.replaceAll("_", " ");
}

export function priorityLabel(value: string, t: Translate) {
  const label = PRIORITY_CONFIG[value];
  return label ? t(label.ar, label.en) : value.replaceAll("_", " ");
}

export function goalStatusLabel(value: string, t: Translate) {
  return translatedValue(
    value,
    {
      on_track: ["على المسار", "On track"],
      at_risk: ["معرّض للخطر", "At risk"],
      off_track: ["خارج المسار", "Off track"],
      achieved: ["متحقق", "Achieved"],
    },
    t,
  );
}

export function projectStatusLabel(value: string, t: Translate) {
  return translatedValue(
    value,
    {
      planning: ["قيد التخطيط", "Planning"],
      active: ["نشط", "Active"],
      on_hold: ["متوقف مؤقتاً", "On hold"],
      completed: ["مكتمل", "Completed"],
      archived: ["مؤرشف", "Archived"],
    },
    t,
  );
}

export function invoiceStatusLabel(value: string, t: Translate) {
  return translatedValue(
    value,
    {
      draft: ["مسودة", "Draft"],
      open: ["مفتوحة", "Open"],
      paid: ["مدفوعة", "Paid"],
      void: ["ملغاة", "Void"],
      overdue: ["متأخرة", "Overdue"],
      uncollectible: ["متعذرة التحصيل", "Uncollectible"],
    },
    t,
  );
}

export function roleLabel(value: string, t: Translate) {
  return translatedValue(
    value,
    {
      owner: ["مالك", "Owner"],
      admin: ["مسؤول", "Admin"],
      manager: ["مدير", "Manager"],
      member: ["عضو", "Member"],
      viewer: ["مشاهد", "Viewer"],
      guest: ["ضيف", "Guest"],
    },
    t,
  );
}

export function activityActionLabel(value: string, t: Translate) {
  return translatedValue(
    value,
    {
      "task.created": ["أنشأ مهمة", "Created a task"],
      "task.updated": ["حدّث مهمة", "Updated a task"],
      "task.deleted": ["حذف مهمة", "Deleted a task"],
      "comment.added": ["أضاف تعليقاً", "Added a comment"],
      "project.created": ["أنشأ مشروعاً", "Created a project"],
      "project.updated": ["حدّث مشروعاً", "Updated a project"],
      "member.invited": ["دعا عضواً", "Invited a member"],
      "member.updated": ["حدّث عضواً", "Updated a member"],
      "task.moved": ["نقل مهمة", "Moved a task"],
      "task.watched": ["بدأ متابعة مهمة", "Started watching a task"],
      "task.unwatched": ["ألغى متابعة مهمة", "Stopped watching a task"],
      "task.watcher_added": ["أضاف متابعاً لمهمة", "Added a watcher to a task"],
      "task.watcher_removed": ["أزال متابعاً من مهمة", "Removed a watcher from a task"],
      "task.sprint_assigned": ["أضاف مهمة إلى سبرنت", "Added a task to a sprint"],
      "task.sprint_removed": ["أزال مهمة من سبرنت", "Removed a task from a sprint"],
      "task.checklists.replaced": ["حدّث قوائم المهمة", "Updated task checklists"],
      "task.checklist_item.updated": ["حدّث عنصراً في قائمة مهمة", "Updated a checklist item"],
      "task.approval.requested": ["طلب موافقة على مهمة", "Requested task approval"],
      "task.approval.decided": ["قرّر في طلب موافقة", "Decided on an approval request"],
      "task.approval.canceled": ["ألغى طلب موافقة", "Canceled an approval request"],
      "sprint.created": ["أنشأ سبرنت", "Created a sprint"],
      "sprint.updated": ["حدّث سبرنت", "Updated a sprint"],
      "sprint.started": ["بدأ سبرنت", "Started a sprint"],
      "sprint.completed": ["أكمل سبرنت", "Completed a sprint"],
      "sprint.cancelled": ["ألغى سبرنت", "Cancelled a sprint"],
      invitation_created: ["أنشأ دعوة", "Created an invitation"],
      invitation_resent: ["أعاد إرسال دعوة", "Resent an invitation"],
      invitation_revoked: ["ألغى دعوة", "Revoked an invitation"],
      invitation_accepted: ["قبل دعوة", "Accepted an invitation"],
      "integration.webhook.created": ["أنشأ webhook", "Created a webhook"],
      "integration.webhook.revoked": ["ألغى webhook", "Revoked a webhook"],
      "integration.credential.saved": ["حفظ بيانات اعتماد تكامل", "Saved integration credentials"],
      "integration.credential.revoked": ["ألغى بيانات اعتماد تكامل", "Revoked integration credentials"],
      "billing.subscription.updated": ["حدّث الاشتراك", "Updated the subscription"],
      "attachment.upload.requested": ["بدأ رفع مرفق", "Started an attachment upload"],
      "attachment.scan.clean": ["اجتاز مرفق الفحص الأمني", "Attachment passed the security scan"],
      "attachment.scan.infected": ["رُفض مرفق بعد الفحص الأمني", "Attachment rejected by the security scan"],
    },
    t,
  );
}

export function automationLabel(value: string, t: Translate) {
  const translated = translatedValue(
    value,
    {
      task_created: ["إنشاء مهمة", "Task created"],
      task_updated: ["تحديث مهمة", "Task updated"],
      task_status_changed: ["تغيّر حالة مهمة", "Task status changed"],
      schedule_daily: ["يومياً", "Daily"],
      status: ["الحالة", "Status"],
      priority: ["الأولوية", "Priority"],
      assignee: ["المسؤول", "Assignee"],
      reporter: ["المبلّغ", "Reporter"],
      setStatus: ["تعيين الحالة", "Set status"],
      setPriority: ["تعيين الأولوية", "Set priority"],
      addTag: ["إضافة وسم", "Add tag"],
      notify: ["إشعار", "Notify"],
      notifyTitle: ["عنوان الإشعار", "Notification title"],
      assignTo: ["تعيين إلى", "Assign to"],
      addComment: ["إضافة تعليق", "Add comment"],
      hasTag: ["يحمل وسماً", "Has tag"],
      projectId: ["المشروع", "Project"],
    },
    t,
  );
  if (translated !== value.replaceAll("_", " ")) return translated;
  if (STATUS_CONFIG[value]) return taskStatusLabel(value, t);
  if (PRIORITY_CONFIG[value]) return priorityLabel(value, t);
  return translated;
}

export function customFieldTypeLabel(value: string, t: Translate) {
  return translatedValue(
    value,
    {
      text: ["نص", "Text"],
      textarea: ["نص طويل", "Long text"],
      number: ["رقم", "Number"],
      date: ["تاريخ", "Date"],
      select: ["قائمة اختيار", "Select"],
      multi_select: ["اختيار متعدد", "Multi-select"],
      checkbox: ["مربع اختيار", "Checkbox"],
      url: ["رابط", "URL"],
      email: ["بريد إلكتروني", "Email"],
      user: ["مستخدم", "User"],
    },
    t,
  );
}

export function planLabel(value: string, t: Translate) {
  return translatedValue(
    value.toLowerCase(),
    {
      free: ["مجانية", "Free"],
      starter: ["مبتدئة", "Starter"],
      pro: ["احترافية", "Pro"],
      business: ["أعمال", "Business"],
      enterprise: ["مؤسسات", "Enterprise"],
    },
    t,
  );
}
