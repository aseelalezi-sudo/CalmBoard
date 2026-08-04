import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { PrometheusModule } from "@willsoto/nestjs-prometheus";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { HealthController } from "./health.controller.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { ProjectsController, WorkspacesController } from "./workspace-projects.controller.js";
import { AdminOverviewController } from "./admin-overview.controller.js";
import { ActivitiesController } from "./activities.controller.js";
import { AutomationsController } from "./automations.controller.js";
import { CommentsController } from "./comments.controller.js";
import { CustomFieldsController } from "./custom-fields.controller.js";
import { MembersController } from "./members.controller.js";
import { NotificationsController } from "./notifications.controller.js";
import { AttachmentsController } from "./attachments.controller.js";
import { TasksController } from "./tasks.controller.js";
import {
  BranchesController,
  DashboardLayoutController,
  GoalsController,
  InvoicesController,
  SavedViewsController,
  TimeLogsController,
  TimesheetsController,
} from "./workspace-modules.controller.js";
import {
  ProfilePreferencesController,
  ProfileMfaController,
  ProfileSessionsController,
  UserSkillsController,
  WorkspaceResourceController,
} from "./account.controller.js";
import { DocumentsController, FormsController } from "./content.controller.js";
import {
  DigestController,
  IntegrationSyncController,
  SearchController,
  SecurityDiagnosticsController,
  WorkspaceExportController,
} from "./operations.controller.js";
import { BillingCheckoutController, BillingPortalController, BillingWebhookController } from "./billing.controller.js";
import { SeedController } from "./seed.controller.js";
import { IntegrationCredentialsController, IntegrationOAuthController } from "./integrations.controller.js";
import {
  IntegrationWebhookEndpointsController,
  IntegrationWebhookReceiverController,
} from "./integration-webhooks.controller.js";
import { IntegrationOAuthService } from "./integration-oauth.service.js";
import { TenantDatabaseInterceptor } from "./tenant-database.interceptor.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthEmailService } from "./auth-email.service.js";
import { CsrfGuard } from "./csrf.guard.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RedisRateLimitStore } from "./rate-limit.service.js";
import { OAuthService } from "./oauth.service.js";
import { AuthorizationService } from "./authorization.service.js";
import { TenantGuard } from "./tenant.guard.js";
import { PermissionGuard } from "./permission.guard.js";
import { AuthorizationCapabilitiesController, AuthorizationController } from "./authorization.controller.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";
import { PlatformAdministrationService } from "./platform-administration.service.js";
import { SecurityAuditController } from "./security-audit.controller.js";
import { AdminQueuesController } from "./admin-queues.controller.js";
import { QueueMonitoringService } from "./queue-monitoring.service.js";
import { RealtimeAccessService } from "./realtime-access.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimeService } from "./realtime.service.js";
import { ProjectBaselinesController } from "./project-baselines.controller.js";
import { WorkloadController } from "./workload.controller.js";
import { ReportSchedulesController } from "./report-schedules.controller.js";
import { createSearchProvider, SEARCH_PROVIDER_TOKEN } from "./search-provider.js";
import { AIController } from "./ai.controller.js";
import { createAIProvider, AI_PROVIDER_TOKEN } from "./ai-provider.js";
import { AIService } from "./ai.service.js";
import { MetricsController } from "./metrics.controller.js";
import { HttpMetricsInterceptor } from "./http-metrics.interceptor.js";
import { LicensingModule } from "./licensing/licensing.module.js";
import { LicensingGuard } from "./licensing/licensing.guard.js";

function correlationId(header: string | string[] | undefined) {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, response) => {
          const id = correlationId(req.headers["x-correlation-id"]);
          response.setHeader("x-correlation-id", id);
          return id;
        },
        autoLogging: {
          ignore: (request) =>
            request.url === "/health/liveness" || request.url === "/health/readiness" || request.url === "/metrics",
        },
        transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
      },
    }),
    PrometheusModule.register({ controller: MetricsController }),
    LicensingModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    AuthorizationController,
    AuthorizationCapabilitiesController,
    SecurityAuditController,
    WorkspacesController,
    ProjectsController,
    AdminOverviewController,
    AdminQueuesController,
    ActivitiesController,
    AutomationsController,
    CommentsController,
    CustomFieldsController,
    MembersController,
    NotificationsController,
    AttachmentsController,
    TasksController,
    ProjectBaselinesController,
    WorkloadController,
    BranchesController,
    DashboardLayoutController,
    GoalsController,
    InvoicesController,
    SavedViewsController,
    TimeLogsController,
    TimesheetsController,
    WorkspaceResourceController,
    UserSkillsController,
    ProfilePreferencesController,
    ProfileMfaController,
    ProfileSessionsController,
    DocumentsController,
    FormsController,
    SearchController,
    IntegrationSyncController,
    IntegrationCredentialsController,
    IntegrationOAuthController,
    IntegrationWebhookEndpointsController,
    IntegrationWebhookReceiverController,
    DigestController,
    WorkspaceExportController,
    ReportSchedulesController,
    SecurityDiagnosticsController,
    AIController,
    BillingCheckoutController,
    BillingPortalController,
    BillingWebhookController,
    SeedController,
  ],
  providers: [
    AuthService,
    AuthEmailService,
    OAuthService,
    IntegrationOAuthService,
    AuthorizationService,
    PlatformAdministrationService,
    RedisRateLimitStore,
    QueueMonitoringService,
    RealtimeAccessService,
    RealtimeService,
    RealtimeGateway,
    AIService,
    { provide: AI_PROVIDER_TOKEN, useFactory: () => createAIProvider() },
    { provide: SEARCH_PROVIDER_TOKEN, useFactory: () => createSearchProvider() },
    { provide: APP_GUARD, useClass: LicensingGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PlatformAdminGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantDatabaseInterceptor },
  ],
})
export class AppModule {}
