# REVENGE — availability and hosting plan

**Decision:** keep the interactive Next.js app and short request/response APIs on Vercel; keep Supabase Postgres/Auth as the managed data layer. Do not add an always-running web process just to prevent a serverless function from sleeping. Add a durable queue/worker only for work that cannot finish within an HTTP request. Verify the account plans, regions, quotas, and service terms before presenting this as an uptime commitment.

This is an architecture recommendation, not an uptime guarantee. No architecture can promise uninterrupted service; provider outages, upstream-tool failures, network events, and maintenance can still affect users.

## Fit for REVENGE

- Vercel Functions scale request handling without a user-operated server process. They have per-request duration and resource limits, so they are right for chat/tool calls that can complete within those limits—not for an indefinitely running consumer. Function maximum duration and region availability depend on plan: [Vercel Functions limits](https://vercel.com/docs/functions/limitations).
- Vercel documents Daemons for continuously running workers and Queues/Workflows for durable asynchronous work. Adopt those only if the product needs persistent background jobs and after verifying current availability and plan/cost: [Background workers on Vercel](https://vercel.com/kb/guide/background-workers-on-vercel), [Agent frameworks and Vercel services](https://vercel.com/docs/frameworks/agents).
- Supabase is already the REVENGE database and auth provider. Its current connector health reported Auth, Database, REST, and Storage as healthy. For serverless functions, Supabase recommends transaction-mode pooling and a small application-side pool; session mode is more appropriate for persistent sessions and some third-party tools: [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres), [Pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).
- If a continuously running worker is hosted outside Vercel, Render paid services do not sleep; the free web tier does sleep after inactivity. For stronger availability, use more than one instance and external health monitoring: [Render service types](https://render.com/docs/service-types), [Render FAQ](https://render.com/docs/faq).
- Fly.io supports health-check routing, restart policies, and configured minimum running Machines; use multiple Machines/regions where the workload and budget justify them: [Fly app availability](https://fly.io/docs/apps/app-availability/), [Fly configuration](https://fly.io/docs/reference/configuration/).

## Recommended production shape

1. **Frontend and interactive API:** Vercel production deployment on an appropriate paid production plan, with the function region chosen to minimize latency to the Supabase region and upstream providers. Keep server/provider secrets in server-side environment variables only.
2. **Postgres:** Supabase on a plan with backups and recovery features appropriate to the data. Review `DATABASE_URL`: current repository comments describe a Supabase session-pooler connection. For Vercel/serverless traffic, test a move to Supabase transaction pooling (port 6543) and a smaller per-instance `pg` pool before changing production. Monitor Supabase connection and saturation metrics; do not switch the live secret without staging and a rollback plan.
3. **Background work (future, only when required):** enqueue durable jobs in Postgres/managed queue, process idempotently in a supported always-on worker. Prefer Vercel Daemons/Queues/Workflows if available on the account and suitable for the task; otherwise use a paid Fly.io or Render worker with at least two replicas for redundancy. Persist job state and expose progress/retry/cancel separately from the request path.
4. **Resilience:** bound upstream HTTP timeouts, validate and normalize provider responses, use limited retries with backoff only for safe/idempotent requests, and introduce provider circuit breakers. A fallback provider must not receive user content unless the user has consented to that provider.
5. **Monitoring and response:** configure an independent external monitor (for example Better Stack or an equivalent) to probe both `/api/health?live=1` and `/api/health` from more than one location. Alert on sustained failure, elevated latency, database errors, upstream failure rate, and worker queue age. Add a written incident contact/runbook and periodically test restoring a backup.

## Health checks

- `/api/health?live=1` is a **liveness** check and deliberately does not call the database. A failure means the app is not responding.
- `/api/health` is a **readiness** check and verifies Postgres/schema availability. A 503 means the deployment is responding but not ready to serve database-backed traffic.
- Health checks and synthetic probes detect failure; they do not keep a host awake, override provider sleep policy, or guarantee uptime. A scheduled ping by itself is not an availability architecture.

## Rollout and release gates

1. Confirm the Vercel and Supabase plan, project regions, limits, backups, and applicable SLA with the account owner.
2. Deploy the database-pooler change to a staging environment; run authentication, conversation, chat, API-key, and migration tests under concurrent requests.
3. Add external monitoring and alerts before routing production traffic to any replacement service.
4. Run failure drills: database unavailable, upstream timeout, throttled upstream, worker restart, and process termination during a job. Check that errors are useful, secrets are redacted, and jobs are resumable/idempotent.
5. Deploy in a controlled window, verify health, login, chat, downloader, developer-key creation/revoke, script authentication, and rollback readiness.

## Important current gap

The health route and per-key rate limiting are implemented in the working tree, but monitoring, paid-plan verification, a transaction-pooler migration, durable workers, multi-region failover, and an SLA are **not** configured by this code change. Do not describe REVENGE as guaranteed 24/7 until those operational decisions and external checks are completed.
