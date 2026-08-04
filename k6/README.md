# CalmBoard staging load test

This test exercises readiness plus the authenticated, tenant-scoped task
pagination path under 50 concurrent virtual users. It deliberately refuses to
run unless the operator records a staging workspace containing at least 100,000
tasks. Do not point it at production.

Use a short-lived access token for a staging-only member and revoke its session
after the run:

```sh
k6 run \
  -e API_BASE_URL=https://api.staging.example \
  -e ORGANIZATION_ID=<staging-organization-uuid> \
  -e WORKSPACE_ID=<100k-task-workspace-uuid> \
  -e AUTH_ACCESS_TOKEN=<short-lived-access-token> \
  -e DATASET_TASK_COUNT=100000 \
  k6/load.js
```

Passing means at least 99% of checks succeed, HTTP failure rate stays below 1%,
health p95 remains below 250ms, task-list p95 remains below 750ms, and task-list
p99 remains below 1.5s. Save the k6 summary with the release evidence. The
`DATASET_TASK_COUNT` value is operator-supplied provenance; attach the staging
database count query result to the same evidence record.
