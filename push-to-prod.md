### Phase 1: Critical Security & Backend (Must Fix Before Launch)
- [ ] **Patch RLS Gaps:** Add `organization_id` columns where missing and update the 15 tables currently using admin-only policies to use organization-scoped policies (`is_org_member`).
- [ ] **Fix Registration Policies:** Create a migration to drop the policies referencing the non-existent `organization_roles` table and recreate them pointing to `organization_members`.
- [ ] **Secure Edge Functions:** Add JWT and organization membership validation to all 7 Edge Functions (specifically `game-persistence`, `practice-persistence`, `import-validation`, `auto-scheduler`, and `fairness-scoring`) to prevent RLS bypass.
- [ ] **Server-Side Validation:** Enforce that the frontend routes CSV parsing through the `import-validation` Edge Function to reject bad data before writing to the database.
- [ ] **Resolve NPM Vulnerabilities:** Run `npm audit fix` to patch the 6 known vulnerabilities (react-router, rollup, flatted, ajv/minimatch).

### Phase 2: Onboarding UX (Zero-to-One Experience)
- [ ] **Create "Organization Creation" Step:** Build a pre-wizard form to capture initial tenant data (Organization Name, URL Slug, Timezone, Active Season Year) for users who log in without an existing organization.
- [ ] **Implement Initialization RPC:** Write a secure `initialize_new_tenant` RPC that creates the `organizations` record and immediately assigns the user the `admin` role in `organization_members`.
- [ ] **Update Routing Logic:** Modify the authentication context and routing to detect when a newly authenticated user has an empty organizations array, redirecting them to the creation step instead of hanging on the loading skeleton.

### Phase 3: UX Polish & Accessibility
- [ ] **Design "Cold Start" Empty States:** Implement clear empty state illustrations and call-to-action buttons (e.g., "Import registrations") for the main dashboard and scheduling views.
- [ ] **Fix Desktop Layout Density:** Increase the `max-width` constraints on primary views (like Team Generation and Practice Scheduler headers) from 460px/520px to `640px` or `65ch` to better utilize desktop screen real estate.
- [ ] **Unify Component Visuals:** Extract the bespoke shadows and transitions from the Team Persistence Panel buttons and update them to use shared "Deep Space Glass" CSS utility tokens.
- [ ] **Remediate A11y Structure:** Add `aria-labelledby` properties to all Insight articles so screen readers can correctly associate the article body with its corresponding heading.

### Phase 4: Operations & Deployment 
- [ ] **Connect Real Supabase:** Apply all 34 migrations to the live production database, deploy the updated Edge Functions, and configure the Vercel production environment variables.
- [ ] **Implement Rate Limiting:** Add token-bucket or sliding-window rate limiting to Edge Functions to protect the CPU-intensive auto-scheduler from being overwhelmed.
- [ ] **Gate Production Logging:** Wrap the frontend `logger` module in an `import.meta.env.PROD` check to suppress verbose debug/info statements in the live environment.
- [ ] **Automated Free-Tier Cleanup:** Set up a GitHub Actions cron job (or `pg_cron`) to automatically delete export jobs older than 7 days, staging players older than 30 days, and audit logs older than 180 days to protect Supabase storage limits.
