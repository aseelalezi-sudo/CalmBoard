# ADR 0023: Trusted timesheets and locked periods

- Status: Accepted
- Date: 2026-07-30

## Context

Time entries were flat records whose owner was accepted from the request body. The approvals screen rendered fixed sample people and stored approvals only in React state. There was no submission lifecycle, reviewer authorization, concurrency protection, or database rule preventing changes after approval.

## Decision

Every time entry belongs to one weekly timesheet period for one active workspace member. The API derives the entry owner from the authenticated actor and never accepts a different owner from the client. The repository creates the Monday-through-Sunday period automatically when the member records the first entry.

Timesheets use `draft`, `submitted`, `approved`, and `rejected` states with optimistic versions. Members submit their own non-empty periods. Users with the `timesheets.review` permission may approve or reject another member's submitted period; owner, administrator, and manager system roles receive this permission. Rejection requires a reason and permits the member to return the period to draft by recording corrected time. Approval records the reviewer and lock time and is irreversible.

PostgreSQL validates tenant, workspace, task, member, reviewer, and period boundaries. Row-level security is forced on the timesheet table. Triggers reject time-entry insertion, update, or deletion while a period is submitted or approved, reject invalid status transitions, prevent self-approval, and make approved timesheets immutable. Existing time entries are migrated into UTC weekly periods before the new foreign key becomes mandatory.

The web application displays the authenticated member's real periods and the authorized review queue returned by the API. It no longer estimates billing from a hard-coded hourly rate or renders sample approval rows.

## Consequences

- A client cannot record time on behalf of another user by changing request data.
- Submitted periods cannot change while a reviewer is making a decision.
- Approved periods remain locked even if a future API path attempts to mutate their entries.
- Review decisions have a trusted reviewer identity and an auditable timestamp.
- Rejected periods can be corrected and resubmitted; editing clears the obsolete review fields and increments the optimistic version.
- Weekly boundaries use UTC; supporting organization-specific payroll time zones requires a future versioned period policy.
