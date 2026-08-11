import archiver from "archiver";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { PoolClient, QueryResult } from "pg";
import {
  assertPortabilitySecretExclusion,
  sanitizeNested,
  workspacePortabilityInventory,
  type InventoryEntry,
} from "./portability-export.js";

export type OrganizationPortabilityJob = { id: string; organizationId: string };

export type OrganizationPortabilityStorage = {
  getReference(reference: string): Promise<Uint8Array>;
};

export type OrganizationPortabilityOptions = {
  pageSize: number;
};

export type OrganizationPortabilityArchive = {
  filePath: string;
  fileName: string;
  contentType: "application/zip";
  fileSize: number;
  checksum: string;
  cleanup(): Promise<void>;
};

type AttachmentReference = {
  id: string;
  workspaceId: string;
  taskId: string | null;
  projectId: string | null;
  uploaderId: string;
  fileName: string;
  declaredFileSize: number;
  mimeType: string | null;
  sourceReference: string;
  previewReference: string | null;
  previewMimeType: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function safeComponent(value: string, fallback: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120) || fallback
  );
}

async function ensureParent(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function writeJson(filePath: string, value: unknown) {
  assertPortabilitySecretExclusion(value);
  await ensureParent(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function writePagedJsonArray(
  client: PoolClient,
  filePath: string,
  select: string,
  parameters: unknown[],
  pageSize: number,
) {
  await ensureParent(filePath);
  const handle = await open(filePath, "w", 0o600);
  let lastId: string | null = null;
  let first = true;
  let count = 0;
  try {
    await handle.write("[\n");
    while (true) {
      const cursorParameter = parameters.length + 1;
      const limitParameter = parameters.length + 2;
      const result: QueryResult<{ id: string }> = await client.query<{ id: string }>(
        `${select} and id > coalesce($${cursorParameter}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         order by id limit $${limitParameter}`,
        [...parameters, lastId, pageSize],
      );
      if (!result.rowCount) break;
      const safeRows = sanitizeNested(result.rows) as Array<Record<string, unknown>>;
      assertPortabilitySecretExclusion(safeRows);
      for (const row of safeRows) {
        await handle.write(`${first ? "" : ",\n"}${JSON.stringify(row)}`);
        first = false;
        count += 1;
      }
      lastId = result.rows.at(-1)!.id;
      if (result.rows.length < pageSize) break;
    }
    await handle.write("\n]\n");
  } finally {
    await handle.close();
  }
  return count;
}

function inventorySelect(entry: InventoryEntry, organizationIdParameter = 1, workspaceIdParameter?: number) {
  const projection = entry.columns.map((column) => `"${column}"`).join(", ");
  if (entry.scope === "workspace") {
    if (!workspaceIdParameter) throw new Error("Workspace inventory requires a persisted Workspace target");
    return `select ${projection} from ${entry.table}
            where organization_id = $${organizationIdParameter} and workspace_id = $${workspaceIdParameter}`;
  }
  if (entry.scope === "organization") {
    return `select ${projection} from ${entry.table} where organization_id = $${organizationIdParameter}`;
  }
  if (entry.scope === "organization-workspace-optional") {
    return `select ${projection} from ${entry.table} where organization_id = $${organizationIdParameter}`;
  }
  return `select ${projection} from ${entry.table}
          where role_id in (select id from roles where organization_id = $${organizationIdParameter})`;
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function writeAttachmentBinary(
  storage: OrganizationPortabilityStorage,
  reference: string,
  filePath: string,
  declaredMaximum: number,
) {
  const bytes = Buffer.from(await storage.getReference(reference));
  if (bytes.byteLength > declaredMaximum || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment object exceeds its bounded export size");
  }
  await ensureParent(filePath);
  await writeFile(filePath, bytes, { mode: 0o600 });
  return { size: bytes.byteLength, checksumSha256: createHash("sha256").update(bytes).digest("hex") };
}

async function packageArchive(archiveRoot: string, destination: string) {
  await ensureParent(destination);
  const output = createWriteStream(destination, { mode: 0o600 });
  const archive = archiver("zip", { zlib: { level: 6 } });
  const completed = new Promise<void>((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    archive.on("warning", (error) => (error.code === "ENOENT" ? undefined : reject(error)));
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.directory(archiveRoot, false);
  await archive.finalize();
  await completed;
}

export async function createOrganizationPortabilityArchive(
  client: PoolClient,
  job: OrganizationPortabilityJob,
  storage: OrganizationPortabilityStorage,
  options: OrganizationPortabilityOptions,
): Promise<OrganizationPortabilityArchive> {
  if (!Number.isInteger(options.pageSize) || options.pageSize < 25 || options.pageSize > 2_000) {
    throw new Error("Organization portability page size must be between 25 and 2000");
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "calmboard-organization-export-"));
  const archiveRoot = join(temporaryRoot, "archive");
  const attachmentReferencesPath = join(temporaryRoot, "attachment-references.jsonl");
  const archivePath = join(temporaryRoot, `${job.id}.zip`);
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  await writeFile(attachmentReferencesPath, "", { encoding: "utf8", mode: 0o600 });

  let organizationSlug = job.organizationId;
  let workspaceCount = 0;
  const inventoryManifest: Array<{ file: string; table: string; scope: string; records: number }> = [];
  await client.query("begin isolation level repeatable read read only");
  try {
    const organization = await client.query(
      `select id, name, slug, owner_id, plan, seats, settings, created_at, updated_at
       from organizations where id = $1 and deleted_at is null`,
      [job.organizationId],
    );
    if (!organization.rowCount) throw new Error("Export Organization is unavailable");
    organizationSlug = String((organization.rows[0] as { slug?: unknown }).slug ?? job.organizationId);
    await writeJson(join(archiveRoot, "organization.json"), organization.rows[0]);

    const usersCount = await writePagedJsonArray(
      client,
      join(archiveRoot, "memberships", "users.json"),
      `select account.id, account.name, account.email, account.avatar_url, account.locale
       from users account
       where exists (
         select 1 from memberships membership
         where membership.user_id = account.id and membership.organization_id = $1
       )`,
      [job.organizationId],
      options.pageSize,
    );
    inventoryManifest.push({
      file: "memberships/users.json",
      table: "users",
      scope: "organization",
      records: usersCount,
    });

    for (const entry of workspacePortabilityInventory.filter((item) => item.scope !== "workspace")) {
      const count = await writePagedJsonArray(
        client,
        join(archiveRoot, entry.file),
        inventorySelect(entry),
        [job.organizationId],
        options.pageSize,
      );
      inventoryManifest.push({ file: entry.file, table: entry.table, scope: entry.scope, records: count });
    }

    let lastWorkspaceId: string | null = null;
    while (true) {
      const workspaces: QueryResult<{ id: string; slug: string }> = await client.query<{
        id: string;
        slug: string;
      }>(
        `select id, organization_id, name, slug, color, icon, description, created_at, updated_at
         from workspaces
         where organization_id = $1 and deleted_at is null
           and id > coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         order by id limit $3`,
        [job.organizationId, lastWorkspaceId, options.pageSize],
      );
      if (!workspaces.rowCount) break;
      for (const workspace of workspaces.rows) {
        workspaceCount += 1;
        await writeJson(join(archiveRoot, "workspaces", workspace.id, "workspace.json"), workspace);
        for (const entry of workspacePortabilityInventory.filter((item) => item.scope === "workspace")) {
          const relativeFile = join("workspaces", workspace.id, entry.file).replaceAll("\\", "/");
          const count = await writePagedJsonArray(
            client,
            join(archiveRoot, relativeFile),
            inventorySelect(entry, 1, 2),
            [job.organizationId, workspace.id],
            options.pageSize,
          );
          inventoryManifest.push({ file: relativeFile, table: entry.table, scope: "workspace", records: count });
        }

        let lastAttachmentId: string | null = null;
        while (true) {
          const attachments: QueryResult<{
            id: string;
            task_id: string | null;
            project_id: string | null;
            uploader_id: string;
            file_name: string;
            file_size: number;
            mime_type: string | null;
            url: string;
            preview_reference: string | null;
            preview_mime_type: string | null;
            created_at: Date;
            deleted_at: Date | null;
          }> = await client.query<{
            id: string;
            task_id: string | null;
            project_id: string | null;
            uploader_id: string;
            file_name: string;
            file_size: number;
            mime_type: string | null;
            url: string;
            preview_reference: string | null;
            preview_mime_type: string | null;
            created_at: Date;
            deleted_at: Date | null;
          }>(
            `select id, task_id, project_id, uploader_id, file_name, file_size, mime_type, url,
                    preview_reference, preview_mime_type, created_at, deleted_at
             from attachments
             where organization_id = $1 and workspace_id = $2
               and id > coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
             order by id limit $4`,
            [job.organizationId, workspace.id, lastAttachmentId, options.pageSize],
          );
          if (!attachments.rowCount) break;
          for (const attachment of attachments.rows) {
            const reference: AttachmentReference = {
              id: attachment.id,
              workspaceId: workspace.id,
              taskId: attachment.task_id,
              projectId: attachment.project_id,
              uploaderId: attachment.uploader_id,
              fileName: attachment.file_name,
              declaredFileSize: attachment.file_size,
              mimeType: attachment.mime_type,
              sourceReference: attachment.url,
              previewReference: attachment.preview_reference,
              previewMimeType: attachment.preview_mime_type,
              createdAt: attachment.created_at,
              deletedAt: attachment.deleted_at,
            };
            await appendFile(attachmentReferencesPath, `${JSON.stringify(reference)}\n`, "utf8");
          }
          lastAttachmentId = attachments.rows.at(-1)!.id;
          if (attachments.rows.length < options.pageSize) break;
        }
      }
      lastWorkspaceId = workspaces.rows.at(-1)!.id;
      if (workspaces.rows.length < options.pageSize) break;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }

  const attachmentMetadataPath = join(archiveRoot, "attachments", "metadata.json");
  await ensureParent(attachmentMetadataPath);
  const metadata = await open(attachmentMetadataPath, "w", 0o600);
  let firstAttachment = true;
  let attachmentCount = 0;
  let unavailableAttachmentCount = 0;
  try {
    await metadata.write("[\n");
    const lines = createInterface({ input: createReadStream(attachmentReferencesPath), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const attachment = JSON.parse(line) as AttachmentReference;
      const archiveDirectory = join("attachments", attachment.workspaceId, attachment.id);
      const originalRelativePath = join(
        archiveDirectory,
        `original-${safeComponent(attachment.fileName, "attachment")}`,
      ).replaceAll("\\", "/");
      let original:
        | { result: "included"; archivePath: string; size: number; checksumSha256: string }
        | { result: "unavailable"; archivePath: null; reason: "object_unavailable" };
      try {
        const persisted = await writeAttachmentBinary(
          storage,
          attachment.sourceReference,
          join(archiveRoot, originalRelativePath),
          attachment.declaredFileSize,
        );
        original = { result: "included", archivePath: originalRelativePath, ...persisted };
      } catch {
        original = { result: "unavailable", archivePath: null, reason: "object_unavailable" };
        unavailableAttachmentCount += 1;
      }

      let preview:
        | { result: "not_present"; archivePath: null }
        | { result: "included"; archivePath: string; size: number; checksumSha256: string }
        | { result: "unavailable"; archivePath: null; reason: "object_unavailable" } = {
        result: "not_present",
        archivePath: null,
      };
      if (attachment.previewReference && attachment.previewReference !== attachment.sourceReference) {
        const previewRelativePath = join(archiveDirectory, "preview").replaceAll("\\", "/");
        try {
          const persisted = await writeAttachmentBinary(
            storage,
            attachment.previewReference,
            join(archiveRoot, previewRelativePath),
            MAX_ATTACHMENT_BYTES,
          );
          preview = { result: "included", archivePath: previewRelativePath, ...persisted };
        } catch {
          preview = { result: "unavailable", archivePath: null, reason: "object_unavailable" };
          unavailableAttachmentCount += 1;
        }
      }

      const safeMetadata = {
        id: attachment.id,
        workspaceId: attachment.workspaceId,
        taskId: attachment.taskId,
        projectId: attachment.projectId,
        uploaderId: attachment.uploaderId,
        fileName: attachment.fileName,
        declaredFileSize: attachment.declaredFileSize,
        mimeType: attachment.mimeType,
        previewMimeType: attachment.previewMimeType,
        createdAt: attachment.createdAt,
        deletedAt: attachment.deletedAt,
        original,
        preview,
      };
      assertPortabilitySecretExclusion(safeMetadata);
      await metadata.write(`${firstAttachment ? "" : ",\n"}${JSON.stringify(safeMetadata)}`);
      firstAttachment = false;
      attachmentCount += 1;
    }
    await metadata.write("\n]\n");
  } finally {
    await metadata.close();
  }

  const generatedAt = new Date().toISOString();
  await writeJson(join(archiveRoot, "manifest.json"), {
    archiveType: "calmboard-portability",
    schemaVersion: "1.1.0",
    exportId: job.id,
    scope: "organization",
    organizationId: job.organizationId,
    generatedAt,
    consistency: {
      relational: "One PostgreSQL REPEATABLE READ snapshot for the Organization and every eligible Workspace",
      binaries:
        "Object bytes are read after the relational snapshot commits; every included object is individually hashed and unavailable objects are recorded explicitly",
    },
    resourceBehavior: {
      relationalReads: `UUID keyset pages of at most ${options.pageSize} rows`,
      archive: "streamed from restricted temporary files; the full Organization archive is not held in memory",
      attachmentMaximumBytes: MAX_ATTACHMENT_BYTES,
    },
    workspaceCount,
    attachmentCount,
    unavailableAttachmentCount,
    inventory: inventoryManifest,
  });

  // The private locator file intentionally remains outside archiveRoot and is never packaged.
  await packageArchive(archiveRoot, archivePath);
  const file = await stat(archivePath);
  const checksum = await hashFile(archivePath);
  return {
    filePath: archivePath,
    fileName: `calmboard-organization-portability-${safeComponent(organizationSlug, job.organizationId)}-${job.id}.zip`,
    contentType: "application/zip",
    fileSize: file.size,
    checksum,
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
  };
}
