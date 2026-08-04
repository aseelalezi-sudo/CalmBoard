import { and, desc, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../client.js";
import { attachments, comments, docs, memberships, projects, tasks, teams, users } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { createDocumentsRepository } from "./documents.js";

const SEARCH_LIMITS = {
  tasks: 20,
  projects: 10,
  docs: 10,
  comments: 10,
  users: 10,
  teams: 10,
  attachments: 10,
} as const;

export const MAX_SEARCH_QUERY_LENGTH = 200;

function postgresSearchCondition(searchText: SQL, query: string) {
  const substringPattern = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return sql`(
    to_tsvector('simple'::regconfig, ${searchText}) @@ websearch_to_tsquery('simple'::regconfig, ${query})
    or lower(${searchText}) % lower(${query})
    or lower(${query}) <% lower(${searchText})
    or word_similarity(lower(${query}), lower(${searchText})) >= 0.35
    or lower(${searchText}) like lower(${substringPattern}) escape '\'
  )`;
}

function postgresSearchRank(searchText: SQL, primaryText: SQL, query: string) {
  return sql<number>`(
    case
      when lower(${primaryText}) = lower(${query}) then 8
      when starts_with(lower(${primaryText}), lower(${query})) then 4
      when strpos(lower(${primaryText}), lower(${query})) > 0 then 2
      else 0
    end
    + ts_rank_cd(
        to_tsvector('simple'::regconfig, ${searchText}),
        websearch_to_tsquery('simple'::regconfig, ${query}),
        32
      ) * 4
    + similarity(lower(${primaryText}), lower(${query})) * 2
    + similarity(lower(${searchText}), lower(${query}))
    + word_similarity(lower(${query}), lower(${searchText})) * 1.5
  )::double precision`;
}

function withoutSearchRank<T extends { searchRank: number }>(row: T): Omit<T, "searchRank"> {
  const { searchRank: _searchRank, ...record } = row;
  return record;
}

export function emptySearchResults() {
  return {
    tasks: [],
    projects: [],
    docs: [],
    comments: [],
    users: [],
    teams: [],
    attachments: [],
  };
}

export function createSearchRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;

  return {
    async search(input: string) {
      const query = input.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
      if (query.length < 2) return emptySearchResults();

      const visibleMemberships = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
          ),
        );
      const visibleDocuments = actorId ? await createDocumentsRepository(context).list() : [];
      const userIds = [...new Set(visibleMemberships.map((membership) => membership.userId))];
      const visibleDocumentIds = visibleDocuments.map((document) => document.id);

      const taskSearchText = sql`coalesce(${tasks.title}, '') || ' ' || coalesce(${tasks.description}, '') || ' ' || coalesce(${tasks.serial}, '')`;
      const taskPrimaryText = sql`coalesce(${tasks.title}, '')`;
      const taskRank = sql<number>`(
        ${postgresSearchRank(taskSearchText, taskPrimaryText, query)}
        + case
            when lower(${tasks.serial}) = lower(${query}) then 10
            when starts_with(lower(${tasks.serial}), lower(${query})) then 5
            else 0
          end
      )::double precision`;

      const projectSearchText = sql`coalesce(${projects.name}, '') || ' ' || coalesce(${projects.description}, '')`;
      const projectRank = postgresSearchRank(projectSearchText, sql`coalesce(${projects.name}, '')`, query);

      const documentSearchText = sql`coalesce(${docs.title}, '') || ' ' || coalesce(${docs.content}, '')`;
      const documentRank = postgresSearchRank(documentSearchText, sql`coalesce(${docs.title}, '')`, query);

      const commentSearchText = sql`coalesce(${comments.content}, '')`;
      const commentRank = postgresSearchRank(commentSearchText, commentSearchText, query);

      const teamSearchText = sql`coalesce(${teams.name}, '') || ' ' || coalesce(${teams.description}, '')`;
      const teamRank = postgresSearchRank(teamSearchText, sql`coalesce(${teams.name}, '')`, query);

      const attachmentSearchText = sql`coalesce(${attachments.fileName}, '') || ' ' || coalesce(${attachments.mimeType}, '')`;
      const attachmentRank = postgresSearchRank(
        attachmentSearchText,
        sql`coalesce(${attachments.fileName}, '')`,
        query,
      );

      const userSearchText = sql`coalesce(${users.name}, '') || ' ' || coalesce(${users.email}, '')`;
      const userRank = postgresSearchRank(userSearchText, sql`coalesce(${users.name}, '')`, query);

      const taskRows = await db
        .select({ ...getTableColumns(tasks), searchRank: taskRank })
        .from(tasks)
        .where(
          and(
            eq(tasks.organizationId, organizationId),
            eq(tasks.workspaceId, workspaceId),
            isNull(tasks.deletedAt),
            postgresSearchCondition(taskSearchText, query),
          ),
        )
        .orderBy(desc(taskRank), desc(tasks.updatedAt))
        .limit(SEARCH_LIMITS.tasks);
      const projectRows = await db
        .select({ ...getTableColumns(projects), searchRank: projectRank })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projects.workspaceId, workspaceId),
            isNull(projects.deletedAt),
            postgresSearchCondition(projectSearchText, query),
          ),
        )
        .orderBy(desc(projectRank), desc(projects.updatedAt))
        .limit(SEARCH_LIMITS.projects);
      const documentRows = visibleDocumentIds.length
        ? await db
            .select({ ...getTableColumns(docs), searchRank: documentRank })
            .from(docs)
            .where(
              and(
                eq(docs.organizationId, organizationId),
                eq(docs.workspaceId, workspaceId),
                isNull(docs.deletedAt),
                inArray(docs.id, visibleDocumentIds),
                postgresSearchCondition(documentSearchText, query),
              ),
            )
            .orderBy(desc(documentRank), desc(docs.updatedAt))
            .limit(SEARCH_LIMITS.docs)
        : [];
      const commentRows = await db
        .select({ ...getTableColumns(comments), searchRank: commentRank })
        .from(comments)
        .where(
          and(
            eq(comments.organizationId, organizationId),
            eq(comments.workspaceId, workspaceId),
            isNull(comments.deletedAt),
            postgresSearchCondition(commentSearchText, query),
          ),
        )
        .orderBy(desc(commentRank), desc(comments.updatedAt))
        .limit(SEARCH_LIMITS.comments);
      const teamRows = await db
        .select({ ...getTableColumns(teams), searchRank: teamRank })
        .from(teams)
        .where(
          and(
            eq(teams.organizationId, organizationId),
            eq(teams.workspaceId, workspaceId),
            isNull(teams.deletedAt),
            postgresSearchCondition(teamSearchText, query),
          ),
        )
        .orderBy(desc(teamRank), desc(teams.updatedAt))
        .limit(SEARCH_LIMITS.teams);
      const attachmentRows = await db
        .select({
          id: attachments.id,
          organizationId: attachments.organizationId,
          workspaceId: attachments.workspaceId,
          taskId: attachments.taskId,
          projectId: attachments.projectId,
          uploaderId: attachments.uploaderId,
          fileName: attachments.fileName,
          fileSize: attachments.fileSize,
          mimeType: attachments.mimeType,
          scanStatus: attachments.scanStatus,
          previewStatus: attachments.previewStatus,
          createdAt: attachments.createdAt,
          updatedAt: attachments.updatedAt,
          searchRank: attachmentRank,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.organizationId, organizationId),
            eq(attachments.workspaceId, workspaceId),
            isNull(attachments.deletedAt),
            postgresSearchCondition(attachmentSearchText, query),
          ),
        )
        .orderBy(desc(attachmentRank), desc(attachments.updatedAt))
        .limit(SEARCH_LIMITS.attachments);
      const userRows = userIds.length
        ? await db
            .select({
              id: users.id,
              email: users.email,
              name: users.name,
              avatarUrl: users.avatarUrl,
              skills: users.skills,
              searchRank: userRank,
            })
            .from(users)
            .where(and(inArray(users.id, userIds), postgresSearchCondition(userSearchText, query)))
            .orderBy(desc(userRank), desc(users.updatedAt))
            .limit(SEARCH_LIMITS.users)
        : [];

      return {
        tasks: taskRows.map(withoutSearchRank),
        projects: projectRows.map(withoutSearchRank),
        docs: documentRows.map(withoutSearchRank),
        comments: commentRows.map(withoutSearchRank),
        users: userRows.map(withoutSearchRank),
        teams: teamRows.map(withoutSearchRank),
        attachments: attachmentRows.map(withoutSearchRank),
      };
    },
  };
}

export type WorkspaceSearchResults = Awaited<ReturnType<ReturnType<typeof createSearchRepository>["search"]>>;
