"use client";

import { useMemo, useState } from "react";
import type { Form, FormConditionOperator, FormField, FormFieldType, FormInput, Project } from "@/lib/types";
import { Btn, Modal, Toggle, selectCls } from "@/components/ui";
import { IconPlus, IconX } from "@/components/icons";

type Translator = (arabic: string, english: string) => string;

const fieldTypes: Array<{ value: FormFieldType; ar: string; en: string }> = [
  { value: "text", ar: "نص قصير", en: "Short text" },
  { value: "textarea", ar: "نص طويل", en: "Long text" },
  { value: "email", ar: "بريد إلكتروني", en: "Email" },
  { value: "number", ar: "رقم", en: "Number" },
  { value: "date", ar: "تاريخ", en: "Date" },
  { value: "select", ar: "قائمة منسدلة", en: "Dropdown" },
  { value: "radio", ar: "اختيار واحد", en: "Single choice" },
  { value: "checkbox", ar: "مربع اختيار", en: "Checkbox" },
];

const operators: Array<{ value: FormConditionOperator; ar: string; en: string }> = [
  { value: "equals", ar: "يساوي", en: "Equals" },
  { value: "not_equals", ar: "لا يساوي", en: "Does not equal" },
  { value: "contains", ar: "يحتوي", en: "Contains" },
  { value: "is_empty", ar: "فارغ", en: "Is empty" },
  { value: "not_empty", ar: "غير فارغ", en: "Is not empty" },
];

const defaultFields: FormField[] = [
  { id: "f1", type: "text", label: "عنوان الطلب", required: true },
  { id: "f2", type: "textarea", label: "التفاصيل", required: true },
];

function defaultInput(projectId: string | null): FormInput {
  return {
    name: "",
    description: "",
    projectId,
    fields: defaultFields,
    settings: {
      schemaVersion: 1,
      createTask: true,
      status: "todo",
      priority: "medium",
      captchaEnabled: true,
      taskTitleFieldId: "f1",
      taskDescriptionFieldId: "f2",
    },
  };
}

function fromForm(form: Form): FormInput {
  return {
    name: form.name,
    description: form.description ?? "",
    projectId: form.projectId ?? null,
    fields: form.fields,
    settings: {
      schemaVersion: 1,
      createTask: form.settings?.createTask ?? true,
      status: form.settings?.status ?? "todo",
      priority: form.settings?.priority ?? "medium",
      captchaEnabled: form.settings?.captchaEnabled ?? true,
      submitLabel: form.settings?.submitLabel,
      successMessage: form.settings?.successMessage,
      taskTitleFieldId: form.settings?.taskTitleFieldId,
      taskDescriptionFieldId: form.settings?.taskDescriptionFieldId,
    },
  };
}

export function FormBuilder({
  form,
  projects,
  activeProjectId,
  t,
  onClose,
  onSave,
}: {
  form?: Form;
  projects: Project[];
  activeProjectId?: string;
  t: Translator;
  onClose: () => void;
  onSave: (input: FormInput) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<FormInput>(() => (form ? fromForm(form) : defaultInput(activeProjectId ?? null)));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fieldIds = useMemo(() => new Set(draft.fields.map((field) => field.id)), [draft.fields]);

  const updateField = (index: number, patch: Partial<FormField>) => {
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    }));
  };

  const removeField = (index: number) => {
    setDraft((previous) => {
      const removedId = previous.fields[index]?.id;
      const fields = previous.fields
        .filter((_, fieldIndex) => fieldIndex !== index)
        .map((field) => (field.condition?.fieldId === removedId ? { ...field, condition: undefined } : field));
      return {
        ...previous,
        fields,
        settings: {
          ...previous.settings,
          taskTitleFieldId:
            previous.settings.taskTitleFieldId === removedId ? fields[0]?.id : previous.settings.taskTitleFieldId,
          taskDescriptionFieldId:
            previous.settings.taskDescriptionFieldId === removedId
              ? fields.find((field) => field.type === "textarea")?.id
              : previous.settings.taskDescriptionFieldId,
        },
      };
    });
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.fields.length) return;
    setDraft((previous) => {
      const fields = [...previous.fields];
      [fields[index], fields[target]] = [fields[target]!, fields[index]!];
      return {
        ...previous,
        fields: fields.map((field, fieldIndex) => {
          if (!field.condition) return field;
          const sourceIndex = fields.findIndex((candidate) => candidate.id === field.condition?.fieldId);
          return sourceIndex < fieldIndex ? field : { ...field, condition: undefined };
        }),
      };
    });
  };

  const addField = () => {
    const base = `field_${Date.now().toString(36)}`;
    let id = base;
    let suffix = 1;
    while (fieldIds.has(id)) {
      id = `${base}_${suffix}`;
      suffix += 1;
    }
    const newField: FormField = {
      id,
      type: "text",
      label: `${t("حقل جديد", "New field")} ${draft.fields.length + 1}`,
      required: false,
    };
    setDraft((previous) => ({
      ...previous,
      fields: [...previous.fields, newField],
    }));
  };

  const save = async () => {
    if (!draft.name.trim()) return setError(t("اسم النموذج مطلوب", "Form name is required"));
    if (!draft.fields.length) return setError(t("أضف حقلاً واحداً على الأقل", "Add at least one field"));
    if (draft.fields.some((field) => !field.label.trim())) {
      return setError(t("كل حقل يحتاج إلى عنوان", "Every field needs a label"));
    }
    if (
      draft.fields.some(
        (field) => (field.type === "select" || field.type === "radio") && (!field.options || !field.options.length),
      )
    ) {
      return setError(t("حقول الاختيار تحتاج إلى خيارات", "Choice fields need options"));
    }
    setError("");
    setSaveError("");
    setSaving(true);
    try {
      await onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
      onClose();
    } catch {
      setSaveError(t("تعذر حفظ النموذج", "Failed to save form"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="workspace"
      contentScrollable={false}
      title={form ? t("تعديل النموذج", "Edit form") : t("إنشاء نموذج", "Create form")}
      description={t("ابنِ الحقول والشروط وإعدادات الإرسال", "Configure fields, conditions, and submission settings")}
    >
      <div className="flex flex-col h-[75vh] max-h-[850px] overflow-hidden -m-6">
        {(error || saveError) && (
          <div
            role="alert"
            className="border-b border-rose-500/20 bg-rose-500/10 px-5 py-3 text-xs font-semibold text-rose-600 dark:text-rose-400"
          >
            {error || saveError}
          </div>
        )}

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_300px]">
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-[11.5px] font-semibold text-ink-soft">
                {t("اسم النموذج", "Form name")}
                <input
                  name="auto-field-pjbfmq9"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-indigo-500"
                />
              </label>
              <label className="text-[11.5px] font-semibold text-ink-soft">
                {t("المشروع المستهدف", "Target project")}
                <select
                  name="auto-field-i4c4627"
                  value={draft.projectId ?? ""}
                  onChange={(event) => setDraft({ ...draft, projectId: event.target.value || null })}
                  className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-indigo-500"
                >
                  <option value="">{t("بدون إنشاء مهمة", "No target project")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-[11.5px] font-semibold text-ink-soft">
              {t("الوصف", "Description")}
              <textarea
                name="auto-field-uldehrc"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className="mt-1.5 min-h-16 w-full resize-y rounded-xl border border-line bg-surface p-3 text-[13px] text-ink outline-none focus:border-indigo-500"
              />
            </label>

            <div className="flex items-center justify-between">
              <h4 className="text-[13px] font-bold text-ink">{t("حقول النموذج", "Form fields")}</h4>
              <Btn variant="outline" onClick={addField}>
                <IconPlus size={13} />
                {t("إضافة حقل", "Add field")}
              </Btn>
            </div>

            {draft.fields.map((field, index) => {
              const priorFields = draft.fields.slice(0, index);
              const needsOptions = field.type === "select" || field.type === "radio";
              const conditionNeedsValue =
                field.condition && !["is_empty", "not_empty"].includes(field.condition.operator);
              return (
                <div key={field.id} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="mt-2 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                      {index + 1}
                    </span>
                    <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[1fr_180px]">
                      <input
                        name="auto-field-hxluqaq"
                        value={field.label}
                        onChange={(event) => updateField(index, { label: event.target.value })}
                        placeholder={t("عنوان الحقل", "Field label")}
                        className="h-9 rounded-lg border border-line bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-indigo-500"
                      />
                      <select
                        name="auto-field-3k02m40"
                        value={field.type}
                        onChange={(event) => {
                          const type = event.target.value as FormFieldType;
                          updateField(index, {
                            type,
                            options:
                              type === "select" || type === "radio"
                                ? field.options?.length
                                  ? field.options
                                  : [t("الخيار الأول", "Option one")]
                                : undefined,
                          });
                        }}
                        className={`${selectCls} h-9 text-[12px]`}
                      >
                        {fieldTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {t(type.ar, type.en)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        aria-label={t("نقل الحقل إلى الأعلى", "Move field up")}
                        onClick={() => moveField(index, -1)}
                        disabled={index === 0}
                        className="h-10 w-10 rounded-lg text-ink-faint hover:bg-raised disabled:opacity-30 sm:h-8 sm:w-7"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={t("نقل الحقل إلى الأسفل", "Move field down")}
                        onClick={() => moveField(index, 1)}
                        disabled={index === draft.fields.length - 1}
                        className="h-10 w-10 rounded-lg text-ink-faint hover:bg-raised disabled:opacity-30 sm:h-8 sm:w-7"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={t("حذف الحقل", "Delete field")}
                        onClick={() => removeField(index)}
                        disabled={draft.fields.length === 1}
                        className="grid h-10 w-10 place-items-center rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 sm:h-8 sm:w-8"
                      >
                        <IconX size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input
                      name="auto-field-5hocuna"
                      value={field.placeholder ?? ""}
                      onChange={(event) => updateField(index, { placeholder: event.target.value || undefined })}
                      placeholder={t("نص توضيحي اختياري", "Optional placeholder")}
                      className="h-9 rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-indigo-500"
                    />
                    {needsOptions && (
                      <input
                        name="auto-field-3h3upf1"
                        value={(field.options ?? []).join(", ")}
                        onChange={(event) =>
                          updateField(index, {
                            options: event.target.value
                              .split(",")
                              .map((option) => option.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder={t("الخيارات مفصولة بفاصلة", "Comma-separated options")}
                        className="h-9 rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-indigo-500"
                      />
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11.5px]">
                    <label className="flex items-center gap-2 text-ink">
                      <input
                        name="auto-field-u4orl9c"
                        type="checkbox"
                        checked={field.required ?? false}
                        onChange={(event) => updateField(index, { required: event.target.checked })}
                      />
                      {t("مطلوب", "Required")}
                    </label>
                    {priorFields.length > 0 && (
                      <label className="flex items-center gap-2 text-ink">
                        <input
                          name="auto-field-swu4t3s"
                          type="checkbox"
                          checked={Boolean(field.condition)}
                          onChange={(event) =>
                            updateField(index, {
                              condition: event.target.checked
                                ? { fieldId: priorFields[0]!.id, operator: "equals", value: "" }
                                : undefined,
                            })
                          }
                        />
                        {t("إظهار بشرط", "Conditional visibility")}
                      </label>
                    )}
                  </div>

                  {field.condition && (
                    <div className="mt-3 grid gap-2 rounded-xl bg-raised/50 p-3 md:grid-cols-3">
                      <select
                        name="auto-field-nxsanll"
                        value={field.condition.fieldId}
                        onChange={(event) =>
                          updateField(index, { condition: { ...field.condition!, fieldId: event.target.value } })
                        }
                        className="h-9 rounded-lg border border-line bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-indigo-500"
                      >
                        {priorFields.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.label}
                          </option>
                        ))}
                      </select>
                      <select
                        name="auto-field-twuph0q"
                        value={field.condition.operator}
                        onChange={(event) =>
                          updateField(index, {
                            condition: {
                              ...field.condition!,
                              operator: event.target.value as FormConditionOperator,
                              value: ["is_empty", "not_empty"].includes(event.target.value)
                                ? undefined
                                : field.condition?.value,
                            },
                          })
                        }
                        className="h-9 rounded-lg border border-line bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-indigo-500"
                      >
                        {operators.map((operator) => (
                          <option key={operator.value} value={operator.value}>
                            {t(operator.ar, operator.en)}
                          </option>
                        ))}
                      </select>
                      {conditionNeedsValue && (
                        <input
                          name="auto-field-xceo4hv"
                          value={field.condition.value ?? ""}
                          onChange={(event) =>
                            updateField(index, { condition: { ...field.condition!, value: event.target.value } })
                          }
                          placeholder={t("القيمة", "Value")}
                          className="h-9 rounded-lg border border-line bg-surface px-3 text-[11.5px] text-ink outline-none focus:border-indigo-500"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <aside className="space-y-5 border-t border-line bg-raised/30 p-5 lg:border-s lg:border-t-0">
            <h4 className="text-[13px] font-bold text-ink">{t("إعدادات الإرسال", "Submission settings")}</h4>
            <SettingToggle
              label={t("حماية CAPTCHA", "CAPTCHA protection")}
              hint={t("Cloudflare Turnstile مع تحقق خادمي", "Cloudflare Turnstile with server verification")}
              checked={draft.settings.captchaEnabled}
              onChange={(captchaEnabled) => setDraft({ ...draft, settings: { ...draft.settings, captchaEnabled } })}
            />
            <SettingToggle
              label={t("إنشاء مهمة", "Create a task")}
              hint={t("حوّل كل رد إلى مهمة في المشروع", "Convert each response into a project task")}
              checked={draft.settings.createTask}
              onChange={(createTask) => setDraft({ ...draft, settings: { ...draft.settings, createTask } })}
            />
            {draft.settings.createTask && (
              <>
                <BuilderSelect
                  label={t("حقل عنوان المهمة", "Task title field")}
                  value={draft.settings.taskTitleFieldId ?? ""}
                  onChange={(taskTitleFieldId) =>
                    setDraft({ ...draft, settings: { ...draft.settings, taskTitleFieldId } })
                  }
                  options={draft.fields.map((field) => ({ value: field.id, label: field.label }))}
                />
                <BuilderSelect
                  label={t("حقل وصف المهمة", "Task description field")}
                  value={draft.settings.taskDescriptionFieldId ?? ""}
                  onChange={(taskDescriptionFieldId) =>
                    setDraft({ ...draft, settings: { ...draft.settings, taskDescriptionFieldId } })
                  }
                  options={[
                    { value: "", label: t("بدون وصف", "No description") },
                    ...draft.fields.map((field) => ({ value: field.id, label: field.label })),
                  ]}
                />
                <BuilderSelect
                  label={t("حالة المهمة", "Task status")}
                  value={draft.settings.status}
                  onChange={(status) =>
                    setDraft({
                      ...draft,
                      settings: { ...draft.settings, status: status as FormInput["settings"]["status"] },
                    })
                  }
                  options={[
                    { value: "backlog", label: t("متراكم", "Backlog") },
                    { value: "todo", label: t("للعمل", "To do") },
                    { value: "in_progress", label: t("قيد التنفيذ", "In progress") },
                    { value: "review", label: t("مراجعة", "Review") },
                  ]}
                />
                <BuilderSelect
                  label={t("الأولوية", "Priority")}
                  value={draft.settings.priority}
                  onChange={(priority) =>
                    setDraft({
                      ...draft,
                      settings: { ...draft.settings, priority: priority as FormInput["settings"]["priority"] },
                    })
                  }
                  options={[
                    { value: "low", label: t("منخفضة", "Low") },
                    { value: "medium", label: t("متوسطة", "Medium") },
                    { value: "high", label: t("مرتفعة", "High") },
                    { value: "urgent", label: t("عاجلة", "Urgent") },
                  ]}
                />
              </>
            )}
            <BuilderText
              label={t("نص زر الإرسال", "Submit button label")}
              value={draft.settings.submitLabel ?? ""}
              onChange={(submitLabel) => setDraft({ ...draft, settings: { ...draft.settings, submitLabel } })}
            />
            <BuilderText
              label={t("رسالة النجاح", "Success message")}
              value={draft.settings.successMessage ?? ""}
              onChange={(successMessage) => setDraft({ ...draft, settings: { ...draft.settings, successMessage } })}
            />
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-4">
          <Btn variant="outline" onClick={onClose} disabled={saving}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn variant="glow" onClick={save} disabled={saving} aria-busy={saving}>
            {form ? t("حفظ التغييرات", "Save changes") : t("إنشاء النموذج", "Create form")}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function SettingToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[12px] font-semibold text-ink">{label}</div>
        <div className="mt-0.5 text-[10.5px] leading-relaxed text-ink-faint">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function BuilderSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[11px] font-semibold text-ink-soft">
      {label}
      <select
        name="auto-field-15gmudt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-indigo-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function BuilderText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[11px] font-semibold text-ink-soft">
      {label}
      <input
        name="auto-field-gjyb1d1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-3 text-[11.5px] text-ink outline-none focus:border-indigo-500"
      />
    </label>
  );
}
