import { InternalServerErrorException, NotFoundException } from "@nestjs/common";
import {
  createSprintAnalyticsQueries,
  type DatabaseTenantContext,
  AnalyticsIntegrityError,
  TenantResourceNotFoundError,
} from "@calmboard/database";

export function createSprintAnalyticsService(context: DatabaseTenantContext) {
  const queries = createSprintAnalyticsQueries(context);

  async function wrapError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AnalyticsIntegrityError) {
        throw new InternalServerErrorException({
          statusCode: 500,
          message: "Analytics Integrity Error",
          error: "ANALYTICS_INTEGRITY_ERROR",
        });
      }
      if (error instanceof TenantResourceNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  async function getOverview(projectId: string) {
    return wrapError(() => queries.getProjectSprintAnalyticsOverview(projectId));
  }

  async function getVelocity(projectId: string, limit: number) {
    return wrapError(() => queries.getVelocitySeries(projectId, limit));
  }

  async function getSprintAnalytics(sprintId: string, projectId: string) {
    const summary = await wrapError(() => queries.getSprintSummary(sprintId, projectId));
    if (!summary) {
      throw new NotFoundException("Sprint not found");
    }
    return summary;
  }

  async function getSprintTimeline(sprintId: string, projectId: string, timezone: string) {
    return wrapError(() => queries.getSprintTimeline(sprintId, projectId, timezone));
  }

  return {
    getOverview,
    getVelocity,
    getSprintAnalytics,
    getSprintTimeline,
  };
}
