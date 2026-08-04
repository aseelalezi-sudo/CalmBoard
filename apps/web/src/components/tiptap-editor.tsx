"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@/lib/utils";

type TiptapEditorInstance = ReturnType<typeof useEditor> | null;
type Translator = (arabic: string, english: string) => string;

type ToolbarButtonProps = {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  title?: string;
};

function ToolbarButton({ active, disabled, label, onClick, title }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      title={title ?? label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-lg border px-2 text-[11.5px] font-semibold transition",
        active
          ? "border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-400/15 dark:text-indigo-200"
          : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 dark:text-zinc-300 dark:hover:border-white/10 dark:hover:bg-white/[0.06]",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {label}
    </button>
  );
}

function safeWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function selectedBlockText(editor: NonNullable<TiptapEditorInstance>) {
  const { from, to, $from } = editor.state.selection;
  return (from === to ? $from.parent.textContent : editor.state.doc.textBetween(from, to, "\n")).trim();
}

function RichTextToolbar({
  editor,
  editable,
  onTurnIntoTask,
  t,
}: {
  editor: TiptapEditorInstance;
  editable: boolean;
  onTurnIntoTask?: (text: string) => void;
  t: Translator;
}) {
  if (!editor) return null;
  const disabled = !editable;
  const setLink = () => {
    const previous = String(editor.getAttributes("link").href ?? "");
    const requested = window.prompt(t("أدخل رابطاً آمناً", "Enter a safe link"), previous || "https://");
    if (requested === null) return;
    if (!requested.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = safeWebUrl(requested.trim());
    if (!href) {
      window.alert(
        t("يُسمح فقط بروابط HTTP وHTTPS والبريد الإلكتروني.", "Only HTTP, HTTPS, and email links are allowed."),
      );
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };
  const addImage = () => {
    const requested = window.prompt(t("رابط الصورة (HTTPS)", "Image URL (HTTPS)"), "https://");
    if (requested === null) return;
    const src = safeWebUrl(requested.trim());
    if (!src || !src.startsWith("https://")) {
      window.alert(t("رابط الصورة يجب أن يستخدم HTTPS.", "Image URLs must use HTTPS."));
      return;
    }
    editor.chain().focus().setImage({ src }).run();
  };

  return (
    <div
      role="toolbar"
      aria-label={t("أدوات تنسيق المستند", "Document formatting tools")}
      className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 bg-white/95 p-2 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/95 dark:shadow-none"
    >
      <ToolbarButton
        label="↶"
        title={t("تراجع", "Undo")}
        disabled={disabled || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolbarButton
        label="↷"
        title={t("إعادة", "Redo")}
        disabled={disabled || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />
      <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
      <ToolbarButton
        label={t("نص", "Text")}
        active={editor.isActive("paragraph")}
        disabled={disabled}
        onClick={() => editor.chain().focus().setParagraph().run()}
      />
      {([1, 2, 3] as const).map((level) => (
        <ToolbarButton
          key={level}
          label={`H${level}`}
          active={editor.isActive("heading", { level })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
        />
      ))}
      <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
      <ToolbarButton
        label="B"
        title={t("عريض", "Bold")}
        active={editor.isActive("bold")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="I"
        title={t("مائل", "Italic")}
        active={editor.isActive("italic")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="U"
        title={t("تحته خط", "Underline")}
        active={editor.isActive("underline")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolbarButton
        label="S"
        title={t("يتوسطه خط", "Strike")}
        active={editor.isActive("strike")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton
        label="<>"
        title={t("كود ضمن السطر", "Inline code")}
        active={editor.isActive("code")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
      <ToolbarButton
        label="• List"
        active={editor.isActive("bulletList")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="1. List"
        active={editor.isActive("orderedList")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        label="☑"
        title={t("قائمة تحقق", "Checklist")}
        active={editor.isActive("taskList")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <ToolbarButton
        label={t("تنبيه", "Callout")}
        active={editor.isActive("blockquote")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolbarButton
        label={t("كتلة كود", "Code block")}
        active={editor.isActive("codeBlock")}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <ToolbarButton
        label={t("جدول", "Table")}
        active={editor.isActive("table")}
        disabled={disabled}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
      <ToolbarButton label={t("رابط", "Link")} active={editor.isActive("link")} disabled={disabled} onClick={setLink} />
      <ToolbarButton label={t("صورة", "Image")} disabled={disabled} onClick={addImage} />
      <ToolbarButton
        label="—"
        title={t("خط فاصل", "Divider")}
        disabled={disabled}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
      {editor.isActive("table") && (
        <>
          <ToolbarButton
            label={t("+ صف", "+ Row")}
            disabled={disabled}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          />
          <ToolbarButton
            label={t("+ عمود", "+ Column")}
            disabled={disabled}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          />
          <ToolbarButton
            label={t("حذف جدول", "Delete table")}
            disabled={disabled}
            onClick={() => editor.chain().focus().deleteTable().run()}
          />
        </>
      )}
      {onTurnIntoTask && (
        <ToolbarButton
          label={t("✨ إلى مهمة", "✨ To task")}
          disabled={disabled || !selectedBlockText(editor)}
          onClick={() => onTurnIntoTask(selectedBlockText(editor))}
        />
      )}
      <span className="ms-auto px-2 text-[10.5px] text-slate-400 dark:text-zinc-500">
        {editable ? t("اكتب / للأوامر", "Type / for commands") : t("للقراءة فقط", "Read only")}
      </span>
    </div>
  );
}

type SlashCommand = {
  id: string;
  labelAr: string;
  labelEn: string;
  keywords: string;
  run: (editor: NonNullable<TiptapEditorInstance>) => void;
};

const slashCommands: SlashCommand[] = [
  {
    id: "heading-1",
    labelAr: "عنوان رئيسي",
    labelEn: "Heading 1",
    keywords: "h1 heading عنوان",
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    labelAr: "عنوان فرعي",
    labelEn: "Heading 2",
    keywords: "h2 heading عنوان",
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "bullet-list",
    labelAr: "قائمة نقطية",
    labelEn: "Bullet list",
    keywords: "list bullet قائمة",
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "checklist",
    labelAr: "قائمة تحقق",
    labelEn: "Checklist",
    keywords: "task checklist check قائمة مهام",
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: "callout",
    labelAr: "تنبيه",
    labelEn: "Callout",
    keywords: "quote callout تنبيه اقتباس",
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    labelAr: "كتلة كود",
    labelEn: "Code block",
    keywords: "code كود",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "table",
    labelAr: "جدول",
    labelEn: "Table",
    keywords: "table جدول",
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "divider",
    labelAr: "خط فاصل",
    labelEn: "Divider",
    keywords: "divider line فاصل",
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

export function TiptapEditor({
  initialContent,
  onChange,
  onTurnIntoTask,
  locale = "ar",
  editable = true,
}: {
  initialContent: string;
  onChange: (markdown: string) => void;
  onTurnIntoTask?: (text: string) => void;
  locale?: "ar" | "en";
  editable?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  const pendingMarkdown = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const t = useCallback((arabic: string, english: string) => (locale === "ar" ? arabic : english), [locale]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const flushChange = useCallback((markdown?: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const value = markdown ?? pendingMarkdown.current;
    pendingMarkdown.current = null;
    if (value !== null && value !== undefined) onChangeRef.current(value);
  }, []);

  const scheduleChange = useCallback(
    (markdown: string) => {
      pendingMarkdown.current = markdown;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushChange(), 400);
    },
    [flushChange],
  );

  const detectSlashCommand = useCallback((instance: NonNullable<TiptapEditorInstance>) => {
    const { $from } = instance.state.selection;
    const match =
      $from.parent.type.name === "paragraph" ? $from.parent.textContent.match(/^\/([\p{L}\p{N}-]*)$/u) : null;
    setSlashQuery(match?.[1]?.toLowerCase() ?? null);
  }, []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
      }),
      Markdown,
      TaskList.configure({ HTMLAttributes: { class: "task-list" } }),
      TaskItem.configure({ nested: true }),
      TableKit.configure({
        table: {
          resizable: true,
          HTMLAttributes: { class: "document-table" },
        },
      }),
      Image.configure({
        allowBase64: false,
        HTMLAttributes: { class: "document-image", loading: "lazy" },
      }),
      Placeholder.configure({
        placeholder: t("ابدأ الكتابة، أو اكتب / لإضافة كتلة…", "Start writing, or type / to add a block…"),
      }),
    ],
    [t],
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    contentType: "markdown",
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: "tiptap-document min-h-[360px] outline-none",
        dir: locale === "ar" ? "rtl" : "ltr",
      },
    },
    onUpdate: ({ editor: instance }) => {
      scheduleChange(instance.getMarkdown());
      detectSlashCommand(instance);
    },
    onSelectionUpdate: ({ editor: instance }) => detectSlashCommand(instance),
    onBlur: ({ editor: instance }) => flushChange(instance.getMarkdown()),
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...editor.options.editorProps.attributes,
          class: "tiptap-document min-h-[360px] outline-none",
          dir: locale === "ar" ? "rtl" : "ltr",
        },
      },
    });
  }, [editable, editor, locale]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getMarkdown().trimEnd();
    if (current !== initialContent.trimEnd()) {
      editor.commands.setContent(initialContent, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, initialContent]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingMarkdown.current !== null) onChangeRef.current(pendingMarkdown.current);
    },
    [],
  );

  const visibleSlashCommands = slashCommands.filter((command) => {
    if (slashQuery === null) return false;
    return `${command.labelAr} ${command.labelEn} ${command.keywords}`.toLowerCase().includes(slashQuery);
  });

  const runSlashCommand = (command: SlashCommand) => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    editor.chain().focus().deleteRange({ from: $from.start(), to: $from.end() }).run();
    command.run(editor);
    setSlashQuery(null);
  };

  return (
    <div className="relative py-4">
      <RichTextToolbar editor={editor} editable={editable} onTurnIntoTask={onTurnIntoTask} t={t} />
      {editable && slashQuery !== null && (
        <div className="relative z-30 mb-3 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-zinc-900">
          <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            {t("أوامر الكتل", "Block commands")}
          </div>
          {visibleSlashCommands.map((command) => (
            <button
              type="button"
              key={command.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runSlashCommand(command)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-start text-[12.5px] font-semibold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700 dark:text-zinc-200 dark:hover:bg-white/[0.06] dark:hover:text-indigo-200"
            >
              <span>{t(command.labelAr, command.labelEn)}</span>
              <span className="font-mono text-[10px] text-slate-400">/{command.id}</span>
            </button>
          ))}
          {!visibleSlashCommands.length && (
            <div className="px-3 py-4 text-center text-[12px] text-slate-400">
              {t("لا توجد أوامر مطابقة", "No matching commands")}
            </div>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-[11px] text-slate-400 dark:border-white/[0.05] dark:text-zinc-500">
        <span>{t("TipTap • Markdown • حفظ تلقائي", "TipTap • Markdown • Auto-save")}</span>
        <span>{t("يدعم العناوين والقوائم والجداول والروابط والكود", "Headings, lists, tables, links, and code")}</span>
      </div>
    </div>
  );
}
