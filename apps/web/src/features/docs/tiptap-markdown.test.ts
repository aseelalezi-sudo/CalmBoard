import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

test("TipTap round-trips the existing Markdown document contract", () => {
  const source = [
    "# Release plan",
    "",
    "> Important callout",
    "",
    "- [x] Review security",
    "",
    "| Owner | Status |",
    "| --- | --- |",
    "| Lina | Done |",
    "",
    "```typescript",
    "const ready = true;",
    "```",
  ].join("\n");
  const editor = new Editor({
    extensions: [StarterKit, Markdown, TaskList, TaskItem, TableKit],
    content: source,
    contentType: "markdown",
  });

  try {
    const serialized = editor.getMarkdown();
    assert.match(serialized, /^# Release plan/m);
    assert.match(serialized, /^> Important callout/m);
    assert.match(serialized, /^- \[x\] Review security/m);
    assert.match(serialized, /\| Owner\s+\| Status\s+\|/);
    assert.match(serialized, /```typescript\nconst ready = true;\n```/);

    editor.commands.setContent("## Restored version\n\nParagraph", {
      contentType: "markdown",
      emitUpdate: false,
    });
    assert.match(editor.getMarkdown(), /^## Restored version/m);
  } finally {
    editor.destroy();
  }
});
