# CalmBoard staging load test

This test exercises readiness plus the authenticated, tenant-scoped task
pagination path under 50 concurrent virtual users. It deliberately refuses to
run unless the operator records a staging workspace containing at least 100,000
tasks. Do not point it at production.

Use a short-lived access token for a staging-only member and revoke its session
after the run. The default per-actor API rate limit is intentionally lower than
this stress profile; on an isolated staging deployment only, set
`API_GENERAL_RATE_LIMIT=1000000` before starting the API. Never raise the
production limit merely to make this test pass.

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

The API holds one database connection for the full tenant-scoped transaction.
Size the staging API pool for the chosen concurrency with
`API_DATABASE_POOL_MAX` after measuring the target environment. Keep the worker
pool independently bounded with `WORKER_DATABASE_POOL_MAX`; across all replicas,
the sum must remain below PostgreSQL's connection limit with headroom for
migrations and administration. A larger pool can reduce queueing, but values
above the database's CPU capacity increase contention and latency.

## Verified baseline

On 2026-08-04, Grafana k6 2.0.0 completed this five-minute profile against an
isolated staging workspace with 100,000 tasks and up to 50 VUs. All 46,685
checks passed, the HTTP failure rate was 0%, readiness p95 was 11.95ms, and the
task endpoint measured p95 83.66ms / p99 110.39ms. The API used the conservative
10-connection pool; increasing the pool without additional database CPU made
latency worse in the same environment.
