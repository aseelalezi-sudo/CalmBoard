# ADR 0020: TipTap with Markdown persistence

- Status: Accepted
- Date: 2026-07-30

## Context

The document editor rendered a custom array of independent inputs and textareas. It approximated block editing but did not provide a real rich-text document model, selection-aware formatting, tables, links, or reliable keyboard behavior. Existing documents, templates, and version snapshots are stored as Markdown strings in PostgreSQL.

Changing persistence to HTML or ProseMirror JSON as part of the editor replacement would require a data migration, version-format detection, and compatibility rules for every historical snapshot. It would also make the existing Markdown templates and task-conversion flow inconsistent.

## Decision

The web application uses TipTap 3 with StarterKit, the official Markdown extension, task-list, table, placeholder, and image extensions. TipTap receives existing content with `contentType: "markdown"` and persists `editor.getMarkdown()`. Applying a template or restoring a historical version replaces the editor document through the same Markdown parser.

The editor supports headings, inline formatting, bullet and ordered lists, checklists, blockquotes styled as callouts, code blocks, resizable tables, links, HTTPS images, and dividers. A slash-command menu exposes the most common block operations. Selected text or the current block can be converted into a task.

Auto-save is debounced for 400 milliseconds and flushed on blur and unmount. Read-only authorization is applied to the TipTap editor itself. Link insertion accepts only HTTP, HTTPS, and email protocols; image insertion requires HTTPS and rejects base64 content.

## Consequences

- Existing documents, templates, and version snapshots require no database migration.
- Markdown remains portable and readable outside the editor.
- TipTap provides a real document model and selection-aware commands while the API contract remains stable.
- The official Markdown extension is currently marked beta, so round-trip coverage is required for every enabled node type.
- Markdown cannot represent every future collaborative or custom ProseMirror node. A future persistence version will be required before adding unsupported nodes such as inline comments or rich file attachments.
