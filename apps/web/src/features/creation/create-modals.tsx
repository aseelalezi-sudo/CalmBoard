"use client";
import { useState, useRef, useEffect } from "react";
import type { Automation, Doc, Goal, Invitation, Member, Project, SavedView, Task, User } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Btn, Field, Modal, areaCls, inputCls, selectCls } from "@/components/ui";
import { IconBolt, IconDoc, IconPlus, IconRocket, IconSave, IconTarget, IconUsers } from "@/components/icons";
import {
  createAutomationFromForm,
  createDocumentFromForm,
  createGoalFromForm,
  createProjectFromForm,
  createSavedViewFromForm,
  inviteMemberFromForm,
} from "@/features/creation/operations";

/* ================= Modals ================= */

function EmojiSelect({ name, t }: { name: string; t: any }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("🏢");
  const containerRef = useRef<HTMLDivElement>(null);
  const EMOJIS = [
    "🏢",
    "🚀",
    "💻",
    "🔥",
    "✨",
    "🌟",
    "💡",
    "🎯",
    "📊",
    "📈",
    "🛠️",
    "⚙️",
    "📁",
    "📂",
    "🎨",
    "📝",
    "🌐",
    "📱",
    "🔒",
    "🔑",
    "📦",
    "📚",
    "💼",
    "🤝",
  ];

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 transition-colors hover:bg-slate-50 focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] dark:border-white/10 dark:bg-white/4 dark:hover:bg-white/6 dark:focus:border-indigo-400/50"
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-[14px] dark:bg-white/10">
          {value}
        </div>
        <span className="truncate text-[13px] text-slate-500 dark:text-zinc-400">
          {t("اختر أيقونة", "Choose an icon")}
        </span>
      </button>

      {open && (
        <div className="absolute top-12 left-0 z-50 w-60 rounded-xl border border-slate-200/80 bg-white p-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)] animate-pop dark:border-white/10 dark:bg-zinc-900 dark:shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
          <div className="grid grid-cols-6 gap-1">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setValue(emoji);
                  setOpen(false);
                }}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg text-[16px] transition hover:bg-slate-100 dark:hover:bg-white/10",
                  value === emoji && "bg-indigo-50 dark:bg-indigo-500/20",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function NewWorkspaceModal({
  open,
  onClose,
  t,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreate: (input: { name: string; color?: string; icon?: string; description?: string }) => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("مساحة عمل جديدة", "New Workspace")}
      icon={<IconPlus size={15} />}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          setSubmitting(true);
          setError(null);
          try {
            await onCreate({
              name: fd.get("name") as string,
              color: (fd.get("color") as string) || undefined,
              icon: (fd.get("icon") as string) || undefined,
              description: (fd.get("description") as string) || undefined,
            });
          } catch (submitError) {
            setError(
              submitError instanceof Error
                ? submitError.message
                : t("تعذر إنشاء مساحة العمل", "Failed to create workspace"),
            );
          } finally {
            setSubmitting(false);
          }
        }}
        className="space-y-4"
      >
        <Field label={t("اسم مساحة العمل", "Workspace Name")}>
          <input
            name="name"
            required
            autoFocus
            placeholder={t("مثال: الإدارة المالية", "e.g. Finance Department")}
            className={inputCls}
          />
        </Field>

        <Field label={t("وصف", "Description")}>
          <textarea
            name="description"
            placeholder={t("وصف مساحة العمل (اختياري)", "Workspace description (optional)")}
            className={areaCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("اللون", "Color")}>
            <div className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 transition-colors focus-within:border-indigo-500 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] dark:border-white/10 dark:bg-white/4 dark:focus-within:border-indigo-400/50 dark:focus-within:bg-white/6">
              <input
                type="color"
                name="color"
                defaultValue="#6366f1"
                className="h-5 w-5 shrink-0 cursor-pointer rounded-full border-0 bg-transparent outline-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
              />
              <span className="truncate text-[13px] text-slate-500 dark:text-zinc-400">
                {t("اختر اللون", "Pick a color")}
              </span>
            </div>
          </Field>
          <Field label={t("الأيقونة (إيموجي)", "Icon (Emoji)")}>
            <EmojiSelect name="icon" t={t} />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <Btn type="submit" disabled={submitting} className="w-full h-10 text-[14px]">
          {submitting ? t("جارٍ الإنشاء…", "Creating…") : t("إنشاء مساحة العمل", "Create Workspace")}
        </Btn>
      </form>
    </Modal>
  );
}
export function NewTaskModal({
  open,
  onClose,
  users,
  t,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  users: User[];
  t: (a: string, e: string) => string;
  onCreate: (d: Partial<Task> & { title: string }) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={t("مهمة جديدة", "New Task")} icon={<IconPlus size={15} />} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          onCreate({
            title: fd.get("title") as string,
            description: fd.get("description") as string,
            priority: fd.get("priority") as string,
            status: fd.get("status") as string,
            assigneeId: (fd.get("assignee") as string) || undefined,
            dueDate: (fd.get("dueDate") as string) || undefined,
          });
        }}
        className="space-y-4"
      >
        <input
          name="title"
          required
          autoFocus
          placeholder={t("ماذا تريد إنجازه؟", "What needs to be done?")}
          className={cn(inputCls, "h-12 text-[15px] font-medium")}
        />
        <textarea
          name="description"
          placeholder={t("وصف تفصيلي (اختياري)…", "Detailed description (optional)…")}
          className={areaCls}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("المسؤول", "Assignee")}>
            <select name="assignee" className={selectCls}>
              <option value="">{t("غير معيّن", "Unassigned")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("الاستحقاق", "Due date")}>
            <input name="dueDate" type="date" className={inputCls} />
          </Field>
          <Field label={t("الأولوية", "Priority")}>
            <select name="priority" defaultValue="medium" className={selectCls}>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v.ar, v.en)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("الحالة", "Status")}>
            <select name="status" defaultValue="todo" className={selectCls}>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v.ar, v.en)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex gap-2 pt-1">
          <Btn type="submit" variant="glow" size="lg" className="flex-1">
            {t("إنشاء المهمة", "Create task")}
          </Btn>
          <Btn type="button" variant="outline" size="lg" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

export function NewProjectModal({
  open,
  onClose,
  t,
  onCreated,
  orgId,
  wsId,
  ownerId,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreated: (p: Project) => void;
  orgId?: string;
  wsId?: string;
  ownerId?: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("مشروع جديد وقالب البداية", "New Project & Starter Kit")}
      icon={<IconRocket size={15} />}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const r = await createProjectFromForm(fd, {
            organizationId: orgId,
            workspaceId: wsId,
            ownerId,
          });
          if (r.id) {
            onCreated(r);
            onClose();
            window.location.reload();
          }
        }}
        className="space-y-4"
      >
        <input
          name="name"
          required
          autoFocus
          placeholder={t("اسم المشروع (مثال: إطلاق تطبيق الجوال Q3)", "Project name (e.g. Mobile App Launch Q3)")}
          className={inputCls}
        />
        <textarea
          name="description"
          placeholder={t("الوصف وأهداف المشروع...", "Description & goals...")}
          className={areaCls}
        />

        <Field as="div" label={t("قالب البداية الذكي (Starter Kit Template)", "Starter Kit Template")}>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {[
              ["default", "📁 فارغ قياسي (Standard)", "أقسام Todo / In Progress / Done الأساسية"],
              ["scrum", "⚡ أجايل سكروم (Agile Scrum)", "Sprint Backlog، مراجعة الكود، مهام وأوسمة جاهزة"],
              ["marketing", "📢 حملة تسويقية (Marketing)", "أفكار محتوى، تدقيق إعلانات، منشور ومكتمل"],
              ["roadmap", "🗺️ خارطة طريق ربع سنوية (Roadmap)", "أقسام Q1، Q2، Q3، Q4 مع مبادرات رئيسية"],
              ["bugs", "🐞 تتبع أخطاء برمجية (Bug Tracking)", "تم الإبلاغ، جاري التحقيق، جاري الحل، مغلق"],
            ].map(([val, label, desc]) => (
              <label
                key={val}
                className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 cursor-pointer transition hover:border-indigo-500/50 dark:border-white/10 dark:bg-white/3 dark:hover:border-indigo-400/50"
              >
                <input
                  type="radio"
                  name="template"
                  value={val}
                  defaultChecked={val === "default"}
                  className="mt-1 accent-indigo-600 dark:accent-cyan-400"
                />
                <div>
                  <div className="text-[12.5px] font-bold text-slate-900 dark:text-white">{label}</div>
                  <div className="text-[10.5px] text-slate-500 dark:text-zinc-400 leading-relaxed mt-0.5">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </Field>

        <Field as="div" label={t("اللون المميز", "Color")}>
          <div className="flex gap-2.5">
            {["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"].map((c) => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="color" value={c} defaultChecked={c === "#6366f1"} className="peer sr-only" />
                <span
                  className="block h-8 w-8 rounded-full transition peer-checked:ring-2 peer-checked:ring-white peer-checked:ring-offset-2 peer-checked:ring-offset-zinc-900"
                  style={{ background: c }}
                />
              </label>
            ))}
          </div>
        </Field>
        <div className="flex gap-2 pt-2">
          <Btn type="submit" variant="glow" size="lg" className="flex-1">
            {t("إنشاء مع القالب", "Create with Starter Kit")}
          </Btn>
          <Btn type="button" variant="outline" size="lg" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

export function NewDocModal({
  open,
  onClose,
  t,
  onCreated,
  orgId,
  wsId,
  authorId,
  docs = [],
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreated: (d: Doc) => void;
  orgId?: string;
  wsId?: string;
  authorId?: string;
  docs?: Doc[];
}) {
  return (
    <Modal open={open} onClose={onClose} title={t("مستند جديد", "New Document")} icon={<IconDoc size={15} />}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const r = await createDocumentFromForm(fd, {
            organizationId: orgId,
            workspaceId: wsId,
            authorId,
          });
          if (r.id) {
            onCreated(r);
            onClose();
          }
        }}
        className="space-y-4"
      >
        <input
          name="title"
          required
          autoFocus
          placeholder={t("عنوان المستند", "Document title")}
          className={inputCls}
        />
        <Field label={t("الصفحة الأصل", "Parent page")}>
          <select name="parentId" className={inputCls} defaultValue="">
            <option value="">{t("بدون — صفحة رئيسية", "None — top-level page")}</option>
            {docs.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>
        </Field>
        <Field as="div" label={t("الأيقونة", "Icon")}>
          <div className="flex gap-2">
            {["📄", "🎨", "🚀", "📝", "📊", "🔧"].map((ic) => (
              <label key={ic} className="cursor-pointer">
                <input type="radio" name="icon" value={ic} defaultChecked={ic === "📄"} className="peer sr-only" />
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-[15px] transition peer-checked:border-cyan-400/60 peer-checked:bg-cyan-500/10">
                  {ic}
                </span>
              </label>
            ))}
          </div>
        </Field>
        <div className="flex gap-2 pt-1">
          <Btn type="submit" variant="glow" size="lg" className="flex-1">
            {t("إنشاء", "Create")}
          </Btn>
          <Btn type="button" variant="outline" size="lg" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

export function NewGoalModal({
  open,
  onClose,
  t,
  users,
  onCreated,
  orgId,
  wsId,
  ownerId,
  goals = [],
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  users: User[];
  onCreated: (g: Goal) => void;
  orgId?: string;
  wsId?: string;
  ownerId?: string;
  goals?: Goal[];
}) {
  return (
    <Modal open={open} onClose={onClose} title={t("هدف جديد", "New Goal")} icon={<IconTarget size={15} />}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const r = await createGoalFromForm(fd, { organizationId: orgId, workspaceId: wsId, ownerId });
          if (r.id) {
            onCreated(r);
            onClose();
          }
        }}
        className="space-y-4"
      >
        <input
          name="title"
          required
          autoFocus
          placeholder={t("مثال: رفع رضا العملاء إلى 95%", "e.g. Raise NPS to 95%")}
          className={inputCls}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("النوع", "Type")}>
            <select name="type" className={selectCls}>
              <option value="objective">Objective</option>
              <option value="key_result">Key Result</option>
            </select>
          </Field>
          <Field label={t("المسؤول", "Owner")}>
            <select name="owner" className={selectCls}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t("الهدف الأعلى للنتيجة الرئيسية", "Objective for this key result")}>
          <select name="parentId" className={selectCls} defaultValue="">
            <option value="">{t("بدون — عند إنشاء Objective", "None — for an Objective")}</option>
            {goals
              .filter((goal) => goal.type === "objective")
              .map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("طريقة حساب التقدم", "Progress calculation")}>
            <select name="progressMode" className={selectCls} defaultValue="measurement">
              <option value="measurement">{t("قيمة قابلة للقياس", "Measured value")}</option>
              <option value="manual">{t("تحديث يدوي", "Manual check-in")}</option>
              <option value="tasks">{t("من المهام المرتبطة", "Linked tasks")}</option>
            </select>
          </Field>
          <Field label={t("وحدة القياس", "Measurement unit")}>
            <select name="measurementUnit" className={selectCls} defaultValue="percentage">
              <option value="percentage">%</option>
              <option value="number">{t("رقم", "Number")}</option>
              <option value="currency">{t("عملة", "Currency")}</option>
              <option value="boolean">{t("نعم/لا", "Yes/No")}</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("البداية", "Start")}>
            <input name="startValue" type="number" step="any" defaultValue={0} className={inputCls} />
          </Field>
          <Field label={t("المستهدف", "Target")}>
            <input name="targetValue" type="number" step="any" defaultValue={100} className={inputCls} />
          </Field>
          <Field label={t("الوزن", "Weight")}>
            <input name="weight" type="number" min={0.1} max={100} step="0.1" defaultValue={1} className={inputCls} />
          </Field>
        </div>
        <Field label={t("نهاية الفترة", "Period end")}>
          <input name="periodEnd" type="date" className={inputCls} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Btn type="submit" variant="glow" size="lg" className="flex-1">
            {t("إنشاء", "Create")}
          </Btn>
          <Btn type="button" variant="outline" size="lg" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

export function NewAutomationModal({
  open,
  onClose,
  t,
  onCreated,
  orgId,
  wsId,
  actorId,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreated: (a: Automation) => void;
  orgId?: string;
  wsId?: string;
  actorId?: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("قاعدة أتمتة جديدة", "New Automation Rule")}
      icon={<IconBolt size={15} />}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const r = await createAutomationFromForm(fd, {
            organizationId: orgId,
            workspaceId: wsId,
            actorId,
          });
          if (r.id) {
            onCreated(r);
            onClose();
          }
        }}
        className="space-y-4"
      >
        <input name="name" required autoFocus placeholder={t("اسم القاعدة", "Rule name")} className={inputCls} />
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/7 p-3.5">
          <span className="text-[10.5px] font-bold text-indigo-300">{t("عندما (Trigger)", "When (Trigger)")}</span>
          <select name="trigger" className={cn(selectCls, "mt-1.5")}>
            <option value="task_created">{t("إنشاء مهمة", "Task created")}</option>
            <option value="task_status_changed">{t("تغيّر الحالة", "Status changed")}</option>
            <option value="task_assignee_changed">{t("تغيّر المسؤول", "Assignee changed")}</option>
          </select>
        </div>
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/6 p-3.5">
          <span className="text-[10.5px] font-bold text-amber-300">{t("إذا (Condition)", "If (Condition)")}</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <select name="condField" className={selectCls}>
              <option value="">{t("بدون شرط", "No condition")}</option>
              <option value="status">status</option>
              <option value="priority">priority</option>
            </select>
            <input name="condValue" placeholder="urgent / done" className={inputCls} />
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/6 p-3.5">
          <span className="text-[10.5px] font-bold text-emerald-300">{t("ثم (Action)", "Then (Action)")}</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <select name="actField" className={selectCls}>
              <option value="setStatus">setStatus</option>
              <option value="setPriority">setPriority</option>
              <option value="addTag">addTag</option>
              <option value="notify">notify</option>
            </select>
            <input name="actValue" required placeholder="in_progress / assignee" className={inputCls} />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Btn type="submit" variant="glow" size="lg" className="flex-1">
            {t("إنشاء وتفعيل", "Create & enable")}
          </Btn>
          <Btn type="button" variant="outline" size="lg" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

export function InviteModal({
  open,
  onClose,
  t,
  orgId,
  wsId,
  invitedBy,
  onDone,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  orgId?: string;
  wsId?: string;
  invitedBy?: string;
  onDone: () => void;
  notify: (m: string, k?: "success" | "error") => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={t("دعوة عضو", "Invite Member")} icon={<IconUsers size={15} />}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const r = await inviteMemberFromForm(fd, {
            organizationId: orgId,
            workspaceId: wsId,
            actorId: invitedBy,
          });
          if (r.error) {
            notify(r.error, "error");
            return;
          }
          notify(t("أُنشئت الدعوة الآمنة وأُضيفت إلى طابور البريد", "Secure invitation created and queued"));
          onClose();
          onDone();
        }}
        className="space-y-4"
      >
        <p className="text-[12px] leading-relaxed text-zinc-500">
          {t(
            "سيصل رابط آمن ومحدود الصلاحية. لا تُمنح العضوية إلا بعد قبول الدعوة.",
            "A secure, time-limited link is sent. Membership is granted only after acceptance.",
          )}
        </p>
        <input name="email" type="email" required autoFocus placeholder="name@company.com" className={inputCls} />
        <Field label={t("الدور", "Role")}>
          <select name="role" defaultValue="member" className={selectCls}>
            {["admin", "manager", "member", "guest", "viewer"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2 pt-1">
          <Btn type="submit" variant="glow" size="lg" className="flex-1">
            {t("إرسال الدعوة", "Send invite")}
          </Btn>
          <Btn type="button" variant="outline" size="lg" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

export function SaveViewModal({
  open,
  onClose,
  t,
  activeView,
  taskFilter,
  configuration,
  orgId,
  wsId,
  projectId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  activeView: string;
  taskFilter: Record<string, string | undefined>;
  configuration: import("@/lib/types").SavedViewConfiguration;
  orgId?: string;
  wsId?: string;
  projectId?: string;
  onSaved: (v: SavedView) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("حفظ العرض الحالي", "Save Current View")}
      icon={<IconSave size={15} />}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const r = await createSavedViewFromForm(fd, {
            organizationId: orgId,
            workspaceId: wsId,
            projectId,
            viewType: activeView,
            filters: taskFilter,
            configuration,
          });
          if (r.id) {
            onSaved(r);
            onClose();
          }
        }}
        className="space-y-4"
      >
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[11px] text-slate-500 dark:border-white/8 dark:bg-white/3 dark:text-zinc-500">
          {t("النوع", "Type")}: <span className="mono text-violet-700 dark:text-violet-300">{activeView}</span> ·{" "}
          {Object.entries(taskFilter)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ") || t("بدون فلاتر", "no filters")}
        </div>
        <input name="name" required autoFocus placeholder={t("اسم العرض", "View name")} className={inputCls} />
        <label className="flex items-center gap-2.5 text-[12.5px] text-slate-700 dark:text-zinc-300">
          <input type="checkbox" name="shared" className="h-4 w-4 rounded" />
          {t("مشاركة مع الفريق", "Share with team")}
        </label>
        <label className="flex items-center gap-2.5 text-[12.5px] text-slate-700 dark:text-zinc-300">
          <input type="checkbox" name="default" className="h-4 w-4 rounded" />
          {t("جعله العرض الافتراضي للمشروع", "Make default for this project")}
        </label>
        <div className="flex gap-2 pt-1">
          <Btn type="submit" variant="glow" size="lg" className="flex-1">
            {t("حفظ", "Save")}
          </Btn>
          <Btn type="button" variant="outline" size="lg" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
