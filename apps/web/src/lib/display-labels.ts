import { PRIORITY_CONFIG, STATUS_CONFIG, type ViewCtx } from "./types";

type Translate = ViewCtx["t"];

function translatedValue(value: string, labels: Record<string, [string, string]>, t: Translate) {
  const label = labels[value];
  return label ? t(label[0], label[1]) : value.replaceAll("_", " ");
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
      status: ["الحالة", "Status"],
      priority: ["الأولوية", "Priority"],
      assignee: ["المسؤول", "Assignee"],
      reporter: ["المبلّغ", "Reporter"],
      setStatus: ["تعيين الحالة", "Set status"],
      setPriority: ["تعيين الأولوية", "Set priority"],
      addTag: ["إضافة وسم", "Add tag"],
      notify: ["إشعار", "Notify"],
      notifyTitle: ["عنوان الإشعار", "Notification title"],
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
