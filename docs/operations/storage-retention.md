[← Back to Documentation Index](../README.md)
---

# Storage Retention — `raw-imports` bucket

> Free-tier Supabase Storage cap is 1 GB. The `raw-imports`
> bucket holds transient GotSport CSV uploads that feed the ingestion
> pipeline; once the import has been validated and tracked, the raw file
> is operational history rather than live data. Durable promotion into
> player/coach/team records is tracked separately as v1.1 work. This workflow
> expires raw objects older than the retention window so the bucket cannot
> drift toward the cap.

## Retention window

- **30 days.** Raw upload copies only exist for re-validation/debugging of recent imports; staged data is durable in Postgres.
- Imports older than 30 days are operational history; if a user needs the
  original CSV they re-upload it.

## Enforcement

- GitHub Actions workflow: [`.github/workflows/cleanup-raw-imports.yml`](../../.github/workflows/cleanup-raw-imports.yml).
- Schedule: **daily at 04:00 UTC** (`cron: '0 4 * * *'`). Low-traffic hour.
- Also manually dispatchable from the Actions UI (supports `dry_run=true`).

### Why GitHub Actions, not `pg_cron`

A plain `DELETE FROM storage.objects` executed in `pg_cron` removes only
the metadata row — the physical bytes remain in the S3-backed storage tier
and continue to count against the 1 GB quota. Calling the Supabase
Storage REST API (`DELETE /storage/v1/object/raw-imports/<path>`) cascades
through to the S3 backend AND deletes the metadata row, actually freeing
storage. That API call requires a **service-role credential**, which is
unsafe to stash in the database. GitHub Actions (free ~2,000 minutes/month
for private repos; this job consumes ~16 min/month) is the simplest
free-tier-compatible host.

### Actions minutes budget

One run per day, ~30 s each ≈ **16 minutes/month**, well inside the
2,000 minutes/month free-tier Actions budget for private repos.

## Required repo secrets

Configure in GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | The Supabase project URL (same origin as `VITE_SUPABASE_URL`). |
| `SUPABASE_SERVICE_ROLE_KEY` | The project's **service-role** API key. Never commit. Never expose via a `VITE_*` env var (claude.md §2, §10). |

The workflow fails fast if either secret is missing — it does not silently
degrade to no-op.

> **Release-prep note (2026-05-02):** do not count this scheduled cleanup as
> release-ready until the two Actions secrets above are configured, or until an
> operator explicitly disables/replaces the scheduled retention policy.

The `dry_run` input must be either `true` or `false`. Invalid values fail
before any Storage API call is made.

## Manually triggering a run

1. Go to the GitHub repository → **Actions** tab.
2. Select the **Cleanup raw-imports bucket (30-day retention)** workflow.
3. Click **Run workflow**.
4. (Optional) Set `dry_run` to `true` to list the paths that would be
   deleted without calling the DELETE API — useful when validating changes
   to the retention window or filter logic.
5. Click **Run workflow**. The job logs `scanned`, `deleted`, `skipped`,
   and (in dry-run) prefixes each candidate with `[dry-run] would delete`.

## Post-run verification

- Inspect the Actions run log. Look for the final `Run summary:` line:
  `scanned=<N> deleted=<M> skipped=<K>`.
- Open the Supabase dashboard → **Storage** → `raw-imports`.
- Sort by `Created at`. Confirm objects older than the retention window
  are gone; objects inside the window are retained.
- Over a 30+ day observation window, the bucket size should be stable or
  declining (new uploads balance against expiring old uploads).

## Safety behavior

- **Non-destructive on unexpected responses.** If the Supabase API
  returns HTTP 5xx (or any non-2xx) from the LIST or DELETE endpoints, the
  job fails loudly. It does NOT silently skip — silent-skip on a storage
  leak would mask the bug.
- **Safety cap.** If a single run would delete more than 10,000 objects,
  the job aborts with a clear error. Prevents a runaway deletion if bucket
  state is unexpected (clock skew, retention misconfig, orphaned
  pseudo-folders, etc.). To recover, manually delete a batch of objects or
  temporarily increase the cap in the workflow file.
- **Dry-run mode.** `workflow_dispatch` with `dry_run=true` exercises the
  list + filter path end-to-end without issuing any DELETE.

## Revert / pause

- **Pause the schedule** (keep the workflow, just stop firing):
  comment out or delete the `schedule:` block in
  `.github/workflows/cleanup-raw-imports.yml`. The workflow remains
  available via manual `workflow_dispatch`.
- **Remove entirely**: delete
  `.github/workflows/cleanup-raw-imports.yml`. Optionally also rotate the
  `SUPABASE_SERVICE_ROLE_KEY` repo secret if it was added exclusively for
  this workflow.
- Neither path requires a database migration — this feature ships zero
  SQL artifacts (no `pg_cron` job, no migration, no revert script).

## Out of scope

- Retention on other buckets. If another bucket needs retention, clone
  this workflow with a different `BUCKET` env + `RETENTION_DAYS` value.
- User-facing "download past imports" UI. Deleted objects are not
  restorable at the free tier.
- Email notification of deletions. Actions run logs are the audit trail.
