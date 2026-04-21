[← Back to Documentation Index](../README.md)
---

# Content-Security-Policy — SquadLogic

> Wave 7b Task 1 (Audit F-2-06): canonical reference for the production CSP
> header set in [`vercel.json`](../../vercel.json). Lists every directive,
> rationale, and the concrete follow-ups for the two remaining loose
> directives (`style-src 'unsafe-inline'` and `connect-src` wildcard scoping).

## Current policy (enforcing, not Report-Only)

```
default-src 'self';
script-src  'self';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
font-src    'self';
connect-src 'self' https://mmwupqsjkikqzvmdvuzm.supabase.co wss://mmwupqsjkikqzvmdvuzm.supabase.co https://*.ingest.sentry.io;
frame-ancestors 'none';
object-src  'none';
base-uri    'self';
form-action 'self';
upgrade-insecure-requests;
```

Served as `Content-Security-Policy: …` (enforcing). Wave 2 flipped it from
Report-Only. Wave 7b added Sentry ingest to `connect-src` (Wave 2 gap — DSN
was set but captures were CSP-blocked).

## Directive rationale

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Deny-by-default; anything not explicitly allowed below falls through to this. |
| `script-src` | `'self'` | NO `'unsafe-inline'`. Bundled + hashed by Vite. A nonce- or `'strict-dynamic'`-based pattern is v1.1 work; `'self'` is a reasonable SPA baseline. |
| `style-src` | `'self' 'unsafe-inline'` | **Waiver** — Tailwind 4 runtime injects classes via dynamic `<style>` tags and React's `style={{...}}` prop renders inline. Nonce migration requires Tailwind 4.x nonce-propagation (not yet stable) + audit of every inline style site. See §`Follow-ups`. |
| `img-src` | `'self' data: blob:` | `data:` for small icons / placeholder SVGs in-bundle; `blob:` for the `OfflineGuard` Supabase-Storage-loaded brand assets. No third-party image CDNs. |
| `font-src` | `'self'` | All fonts bundled via Vite (`index.css` imports). No Google Fonts / third-party font CDNs. |
| `connect-src` | `'self' https://mmwupqsjkikqzvmdvuzm.supabase.co wss://mmwupqsjkikqzvmdvuzm.supabase.co https://*.ingest.sentry.io` | Allows (1) same-origin XHR, (2) the SquadLogic-specific Supabase project over HTTPS + WSS for Realtime, (3) Sentry ingest. **Supabase host is pinned** to the specific project ref — an earlier draft used `*.supabase.co`; Gemini PR #175 review correctly flagged the wildcard as an XSS-exfiltration broadening. If the project ref ever changes, update this directive in the same PR that updates the Supabase env vars. **Sentry is wildcard-scoped** to `*.ingest.sentry.io` because the Sentry SDK dispatches to region/org-specific subdomains (`o<id>.ingest.sentry.io`) not known at deploy time; the apex `ingest.sentry.io` is Sentry-operated single-tenant and does not host guest content. |
| `frame-ancestors` | `'none'` | Clickjacking defense. SquadLogic is never embedded. |
| `object-src` | `'none'` | Legacy `<object>` / Flash blocker — zero legitimate use. |
| `base-uri` | `'self'` | Prevents `<base>` tag injection that would rewrite all relative URLs. |
| `form-action` | `'self'` | All form submissions stay on origin (Supabase RPCs go via fetch, not form POST). |
| `upgrade-insecure-requests` | present | Auto-upgrades any stray `http://` subresource to `https://` — defense against mixed-content regressions during refactors. |

## Companion headers (also in `vercel.json`)

- `X-Content-Type-Options: nosniff` — MIME sniffing off.
- `X-Frame-Options: DENY` — legacy frame-defense paired with `frame-ancestors 'none'`.
- `Referrer-Policy: strict-origin-when-cross-origin` — don't leak paths/query to third parties.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` — explicit deny on sensor APIs the app never uses.

## Known waivers + follow-ups

### Waiver 1 — `style-src 'unsafe-inline'`

- **Why**: Tailwind 4's runtime + React's `style={{...}}` prop emit inline styles throughout the SPA. A strict `style-src 'self'` policy would break rendering within seconds of load.
- **Follow-up**: v1.1+. Blocked on (a) a stable Tailwind 4 nonce-propagation API and (b) an audit of every `style={...}` site in `frontend/src/**`.
- **Interim discipline**: don't ADD new inline `<style>` tags; use Tailwind utility classes or CSS-var design tokens (`src/index.css`). Audit `CQ-13` / `CQ-14` (Wave 1a code-quality findings — hardcoded hex colors) land before the nonce migration.

### Waiver 2 — `script-src 'self'` without `'strict-dynamic'` / nonce

- **Why**: Vite emits bundled scripts at known paths; `'self'` is sufficient for the SPA attack surface. A nonce-based policy is strictly tighter but adds build complexity.
- **Follow-up**: v1.1+. Preconditions: (a) Vercel Edge Middleware to mint a per-response nonce, (b) Vite plugin to inject the nonce into `<script>` tags at SSR/render time, (c) E2E test coverage for the nonce rotation.
- **Interim discipline**: do NOT inline any `<script>` in `frontend/index.html` or a component; everything must route through a Vite-bundled module.

### Missing — `report-uri` / `Content-Security-Policy-Report-Only`

- **Why**: free-tier Supabase doesn't include a CSP-report collector, and sending reports to a third-party (report-uri.com) introduces a new outbound dependency + bandwidth line item. Violations are caught by the Wave 5 E2E `console-errors` scenario + manual smoke per the production-cutover runbook.
- **Follow-up**: v1.1+ when observability budget allows a Sentry CSP-violation pipeline.

### Missing — Subresource Integrity (SRI)

- **Why**: all scripts are bundled self-hosted; no `<script>` tags pull from third-party CDNs. SRI is only meaningful when loading cross-origin bytes.
- **Follow-up**: N/A unless a future migration moves part of the bundle to a CDN.

## Editing the policy

1. Every directive change lands via a PR that touches `vercel.json` AND this doc.
2. **Adding a new third-party origin** (e.g., a new analytics provider) goes in `connect-src` and MUST include the specific host — never `*` by itself.
3. **Removing** an origin is free; widening requires a security-review comment in the PR explaining what threat model the new origin introduces.
4. After merge, the Vercel deploy picks up the new header on the next redeploy. Verify in the browser's Network tab (Response Headers) that the new value is served.

## Verification

After deploying a CSP change:

```bash
# 1. Fetch the header and pretty-print.
curl -sI https://squadlogic.vercel.app/ | awk '/^content-security-policy/i' | tr ';' '\n' | sed 's/^ //'

# 2. Expect: each directive on its own line, values as shown above.

# 3. Sentry ingest smoke (Wave 2 runbook):
#    Open DevTools, run window.__FORCE_ERROR__(), confirm POST to
#    *.ingest.sentry.io returns 200/202 with NO CSP console warning.
```

If DevTools shows `Refused to connect to '...ingest.sentry.io' because it
violates the following Content Security Policy directive: "connect-src ..."`,
the deploy either used a stale cache (redeploy without cache) or the
`vercel.json` change was not included in the deploy (check `git log
vercel.json`).

## Related docs

- [`docs/operations/sentry-smoke.md`](../operations/sentry-smoke.md) — step-by-step DSN setup + CSP verification.
- [`docs/audits/wave-1a/security.md`](../audits/wave-1a/security.md) — source of F-2-06 (CSP ingest gap) + F-2-07 (style-src unsafe-inline waiver).
- [`docs/audits/wave-1a/index.md`](../audits/wave-1a/index.md) — distribution table; CSP findings closed here.
