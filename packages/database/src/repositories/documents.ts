import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { documentPermissions, docs, docVersions, memberships, projects, users, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type DocumentAccessLevel = "viewer" | "editor" | "manager";
export type DocumentWorkspaceAccess = "none" | "viewer" | "editor";
export type CreateDocumentInput = Omit<typeof docs.$inferInsert, "organizationId" | "workspaceId" | "authorId">;
export type UpdateDocumentInput = Partial<
  Pick<
    typeof docs.$inferInsert,
    "title" | "content" | "icon" | "projectId" | "parentId" | "isPublic" | "workspaceAccess" | "inheritPermissions"
  >
>;
export type DocumentsRepositoryOptions = {
  canManageWorkspaceDocuments?: boolean;
};

const MAX_DOCUMENT_DEPTH = 10;
const accessRank: Record<DocumentAccessLevel, number> = { viewer: 1, editor: 2, manager: 3 };

function strongestAccess(
  current: DocumentAccessLevel | null,
  candidate: DocumentAccessLevel | null,
): DocumentAccessLevel | null {
  if (!candidate) return current;
  if (!current || accessRank[candidate] > accessRank[current]) return candidate;
  return current;
}

export function createDocumentsRepository(context: DatabaseTenantContext, options: DocumentsRepositoryOptions = {}) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const tenantScope = and(
    eq(docs.organizationId, organizationId),
    eq(docs.workspaceId, workspaceId),
    isNull(docs.deletedAt),
  )!;

  function requireActor() {
    if (!actorId) throw new TenantPermissionDeniedError("An authenticated actor is required for document access");
    return actorId;
  }

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function loadAccessState() {
    const currentActorId = requireActor();
    const documents = await db.select().from(docs).where(tenantScope);
    const grants = await db
      .select({
        docId: documentPermissions.docId,
        accessLevel: documentPermissions.accessLevel,
      })
      .from(documentPermissions)
      .where(
        and(
          eq(documentPermissions.organizationId, organizationId),
          eq(documentPermissions.workspaceId, workspaceId),
          eq(documentPermissions.userId, currentActorId),
        ),
      );
    const documentMap = new Map(documents.map((document) => [document.id, document]));
    const grantMap = new Map(grants.map((grant) => [grant.docId, grant.accessLevel]));
    const accessCache = new Map<string, DocumentAccessLevel | null>();

    const resolve = (documentId: string, visited = new Set<string>()): DocumentAccessLevel | null => {
      const cached = accessCache.get(documentId);
      if (cached !== undefined) return cached;
      const document = documentMap.get(documentId);
      if (!document || visited.has(documentId)) return null;

      let access: DocumentAccessLevel | null = null;
      if (options.canManageWorkspaceDocuments || document.authorId === currentActorId) {
        access = "manager";
      }
      access = strongestAccess(access, grantMap.get(documentId) ?? null);
      access = strongestAccess(access, document.workspaceAccess === "none" ? null : document.workspaceAccess);
      if (document.isPublic) access = strongestAccess(access, "viewer");
      if (document.inheritPermissions && document.parentId) {
        const nextVisited = new Set(visited);
        nextVisited.add(documentId);
        access = strongestAccess(access, resolve(document.parentId, nextVisited));
      }
      accessCache.set(documentId, access);
      return access;
    };

    return { documents, documentMap, resolve };
  }

  async function requireAccess(documentId: string, required: DocumentAccessLevel) {
    const state = await loadAccessState();
    const document = state.documentMap.get(documentId);
    if (!document) throw new TenantResourceNotFoundError("document");
    const accessLevel = state.resolve(documentId);
    if (!accessLevel || accessRank[accessLevel] < accessRank[required]) {
      throw new TenantPermissionDeniedError(`Document ${required} access is required`);
    }
    return { document, accessLevel, state };
  }

  async function requireProject(projectId: string) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          eq(projects.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!project) throw new TenantResourceNotFoundError("project");
  }

  async function requireActiveMember(userId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantResourceNotFoundError("workspace member");
  }

  async function validateParent(documentId: string | null, parentId: string | null) {
    if (!parentId) return;
    const { state } = await requireAccess(parentId, "editor");
    const parent = state.documentMap.get(parentId);
    if (!parent) throw new TenantResourceNotFoundError("parent document");

    let ancestorDepth = 0;
    let current: typeof parent | undefined = parent;
    const visited = new Set<string>();
    while (current) {
      if (current.id === documentId || visited.has(current.id)) {
        throw new TenantConflictError("Document parent would create a cycle");
      }
      visited.add(current.id);
      ancestorDepth += 1;
      if (ancestorDepth >= MAX_DOCUMENT_DEPTH) {
        throw new TenantConflictError(`Document nesting cannot exceed ${MAX_DOCUMENT_DEPTH} levels`);
      }
      current = current.parentId ? state.documentMap.get(current.parentId) : undefined;
    }

    if (!documentId) return;
    const children = new Map<string, string[]>();
    for (const candidate of state.documents) {
      if (!candidate.parentId) continue;
      const siblings = children.get(candidate.parentId) ?? [];
      siblings.push(candidate.id);
      children.set(candidate.parentId, siblings);
    }
    const descendantDepth = (id: string, path = new Set<string>()): number => {
      if (path.has(id)) throw new TenantConflictError("Document hierarchy contains a cycle");
      const nextPath = new Set(path);
      nextPath.add(id);
      return Math.max(1, ...(children.get(id) ?? []).map((childId) => 1 + descendantDepth(childId, nextPath)));
    };
    if (ancestorDepth + descendantDepth(documentId) > MAX_DOCUMENT_DEPTH) {
      throw new TenantConflictError(`Document nesting cannot exceed ${MAX_DOCUMENT_DEPTH} levels`);
    }
  }

  async function nextVersionNumber(
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
    documentId: string,
  ) {
    const [latest] = await transaction
      .select({ value: max(docVersions.versionNumber) })
      .from(docVersions)
      .where(
        and(
          eq(docVersions.docId, documentId),
          eq(docVersions.organizationId, organizationId),
          eq(docVersions.workspaceId, workspaceId),
        ),
      );
    return (latest?.value ?? 0) + 1;
  }

  return {
    async list() {
      await requireWorkspace();
      const state = await loadAccessState();
      const records = state.documents
        .map((document) => ({ ...document, accessLevel: state.resolve(document.id) }))
        .filter(
          (document): document is typeof document & { accessLevel: DocumentAccessLevel } =>
            document.accessLevel !== null,
        )
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
      const authorIds = [...new Set(records.map((document) => document.authorId))];
      const authors = authorIds.length ? await db.select().from(users).where(inArray(users.id, authorIds)) : [];
      const authorMap = new Map(authors.map((author) => [author.id, author]));
      return records.map((document) => ({ ...document, author: authorMap.get(document.authorId) ?? null }));
    },

    async create(input: CreateDocumentInput) {
      const currentActorId = requireActor();
      await requireWorkspace();
      if (input.projectId) await requireProject(input.projectId);
      await validateParent(null, input.parentId ?? null);
      const [document] = await db
        .insert(docs)
        .values({ ...input, organizationId, workspaceId, authorId: currentActorId })
        .returning();
      return { ...document, accessLevel: "manager" as const };
    },

    async update(documentId: string, input: UpdateDocumentInput) {
      const managerFields: Array<keyof UpdateDocumentInput> = [
        "parentId",
        "isPublic",
        "workspaceAccess",
        "inheritPermissions",
      ];
      const requiredAccess = managerFields.some((field) => input[field] !== undefined) ? "manager" : "editor";
      const { accessLevel } = await requireAccess(documentId, requiredAccess);
      if (input.projectId) await requireProject(input.projectId);
      if (input.parentId !== undefined) await validateParent(documentId, input.parentId);
      const [document] = await db
        .update(docs)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(docs.id, documentId), tenantScope))
        .returning();
      if (!document) throw new TenantResourceNotFoundError("document");
      return { ...document, accessLevel };
    },

    async listPermissions(documentId: string) {
      await requireAccess(documentId, "manager");
      const grants = await db
        .select()
        .from(documentPermissions)
        .where(
          and(
            eq(documentPermissions.docId, documentId),
            eq(documentPermissions.organizationId, organizationId),
            eq(documentPermissions.workspaceId, workspaceId),
          ),
        )
        .orderBy(desc(documentPermissions.updatedAt));
      const userIds = [...new Set(grants.map((grant) => grant.userId))];
      const grantedUsers = userIds.length
        ? await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
      const userMap = new Map(grantedUsers.map((user) => [user.id, user]));
      return grants.map((grant) => ({ ...grant, user: userMap.get(grant.userId) ?? null }));
    },

    async setPermission(documentId: string, userId: string, accessLevel: DocumentAccessLevel) {
      const currentActorId = requireActor();
      const { document } = await requireAccess(documentId, "manager");
      if (userId === currentActorId) {
        throw new TenantConflictError("Document managers cannot change their own access");
      }
      if (userId === document.authorId) {
        throw new TenantConflictError("The document author already has manager access");
      }
      await requireActiveMember(userId);
      const [permission] = await db
        .insert(documentPermissions)
        .values({
          organizationId,
          workspaceId,
          docId: documentId,
          userId,
          accessLevel,
          grantedById: currentActorId,
        })
        .onConflictDoUpdate({
          target: [documentPermissions.docId, documentPermissions.userId],
          set: { accessLevel, grantedById: currentActorId, updatedAt: new Date() },
        })
        .returning();
      return permission;
    },

    async removePermission(documentId: string, userId: string) {
      await requireAccess(documentId, "manager");
      await db
        .delete(documentPermissions)
        .where(
          and(
            eq(documentPermissions.docId, documentId),
            eq(documentPermissions.userId, userId),
            eq(documentPermissions.organizationId, organizationId),
            eq(documentPermissions.workspaceId, workspaceId),
          ),
        );
      return { ok: true };
    },

    async listVersions(documentId: string) {
      await requireAccess(documentId, "viewer");
      const versions = await db
        .select()
        .from(docVersions)
        .where(
          and(
            eq(docVersions.docId, documentId),
            eq(docVersions.organizationId, organizationId),
            eq(docVersions.workspaceId, workspaceId),
          ),
        )
        .orderBy(desc(docVersions.versionNumber));
      const saverIds = [...new Set(versions.map((version) => version.savedById))];
      const savers = saverIds.length ? await db.select().from(users).where(inArray(users.id, saverIds)) : [];
      const saverMap = new Map(savers.map((saver) => [saver.id, saver]));
      return versions.map((version) => ({ ...version, savedBy: saverMap.get(version.savedById) ?? null }));
    },

    async saveSnapshot(documentId: string) {
      const currentActorId = requireActor();
      await requireAccess(documentId, "editor");
      return db.transaction(async (transaction) => {
        const [document] = await transaction
          .select()
          .from(docs)
          .where(and(eq(docs.id, documentId), tenantScope))
          .for("update")
          .limit(1);
        if (!document) throw new TenantResourceNotFoundError("document");
        const versionNumber = await nextVersionNumber(transaction, documentId);
        const [version] = await transaction
          .insert(docVersions)
          .values({
            organizationId,
            workspaceId,
            docId: documentId,
            versionNumber,
            title: document.title,
            content: document.content,
            savedById: currentActorId,
          })
          .returning();
        return version;
      });
    },

    async restoreVersion(documentId: string, versionId: string) {
      const currentActorId = requireActor();
      const { accessLevel } = await requireAccess(documentId, "editor");
      return db.transaction(async (transaction) => {
        const [document] = await transaction
          .select()
          .from(docs)
          .where(and(eq(docs.id, documentId), tenantScope))
          .for("update")
          .limit(1);
        if (!document) throw new TenantResourceNotFoundError("document");
        const [version] = await transaction
          .select()
          .from(docVersions)
          .where(
            and(
              eq(docVersions.id, versionId),
              eq(docVersions.docId, documentId),
              eq(docVersions.organizationId, organizationId),
              eq(docVersions.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        if (!version) throw new TenantResourceNotFoundError("document version");

        const versionNumber = await nextVersionNumber(transaction, documentId);
        await transaction.insert(docVersions).values({
          organizationId,
          workspaceId,
          docId: documentId,
          versionNumber,
          title: document.title,
          content: document.content,
          savedById: currentActorId,
        });
        const [restored] = await transaction
          .update(docs)
          .set({ title: version.title, content: version.content, updatedAt: new Date() })
          .where(and(eq(docs.id, documentId), tenantScope))
          .returning();
        if (!restored) throw new TenantResourceNotFoundError("document");
        return { ...restored, accessLevel };
      });
    },
  };
}

export function createPublicDocumentsRepository() {
  return {
    async get(documentId: string) {
      const [document] = await db
        .select({
          id: docs.id,
          title: docs.title,
          content: docs.content,
          icon: docs.icon,
          updatedAt: docs.updatedAt,
        })
        .from(docs)
        .where(and(eq(docs.id, documentId), eq(docs.isPublic, true), isNull(docs.deletedAt)))
        .limit(1);
      if (!document) throw new TenantResourceNotFoundError("public document");
      return document;
    },
  };
}
