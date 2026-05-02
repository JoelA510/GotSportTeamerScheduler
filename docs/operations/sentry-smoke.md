[← Back to Documentation Index](../README.md)
---

# Sentry Integration — Smoke Test Runbook

> **Audit F-2-05 + progress-log `PHASE-9`**: the `@sentry/react` SDK is wired in
> `frontend/src/main.jsx` and `frontend/src/components/ErrorBoundary.jsx`, but
> `VITE_SENTRY_DSN` must be populated in Vercel **Production** (and **Preview**
> if you want preview errors captured) for errors to actually reach Sentry.
> This runbook is the smoke operators run after setting the DSN.

## Prerequisites

- Sentry account with a project of type "Browser JavaScript" (or "React").
- The project's DSN string, format: `https://<hash>@<sub>.ingest.sentry.io/<id>`.
- Vercel project access (the `squadlogic` project on the `secureyourtech` team).
- 5 minutes for the redeploy.

## One-time setup

1. **Set the env var in Vercel**:
   - Vercel dashboard → Settings → Environment Variables → Add.
   - Key: `VITE_SENTRY_DSN`. Value: the DSN string. Environments: Production (required), Preview (recommended).
   - **Do NOT set `Development`** — local `npm run dev` does not need prod error capture.
2. **Re-deploy production**:
   - Vercel dashboard → Deployments → top of the Production branch → Redeploy.
   - Alternatively, push any no-op commit to `main` to trigger an auto-deploy.
3. **Confirm the bundle includes the DSN**:
   ```bash
   curl -s https://squadlogic.vercel.app/ | grep -oE "ingest\.sentry\.io[^\"']*" | head -3
   ```
   Expected output: at least one `*.ingest.sentry.io/<id>` match. If the command
   returns nothing, the env var was not included in the build (most commonly
   because the redeploy used cached artifacts — trigger a fresh deploy with
   `[skip cache]` in the commit message or via Vercel's "Redeploy without cache").

## Smoke test (run once after each DSN change)

1. **Force a client-side error** via the `__FORCE_ERROR__` E2E hook:
   - Open https://squadlogic.vercel.app/ in an incognito window.
   - DevTools → Console → run: `window.__FORCE_ERROR__()`.
   - Expected: the React `ErrorBoundary` renders its glass-panel fallback.
2. **Check Sentry** — within 60 seconds:
   - Sentry dashboard → Issues → most recent event.
   - Expected: a `TypeError` (or whatever `__FORCE_ERROR__` throws) with
     `React.Component stack` populated (via the Sentry React integration).
   - Release tag should match the current `package.json:version`.
3. **Check the network tab** of the incognito window:
   - Expected: a successful `POST https://<sub>.ingest.sentry.io/api/<id>/envelope/` returning 200/202.
   - **If blocked by CSP**: F-2-06 (Wave 7b). The CSP `connect-src` needs to
     include `https://*.ingest.sentry.io`. Temporary workaround: add to
     `connect-src` in `vercel.json`; permanent fix lands in Wave 7b.

## Failure modes

| Symptom | Diagnosis | Remedy |
| --- | --- | --- |
| No event appears in Sentry within 5 minutes | DSN typo or bundle cache | Re-run `curl | grep ingest.sentry.io` check; re-deploy without cache. |
| Event appears but no React component stack | `Sentry.init({ integrations: [reactRouterV7BrowserTracingIntegration()] })` missing a component | Check `frontend/src/main.jsx` — the `Sentry.init` call must have the React integration. |
| Event appears with wrong release tag | `Sentry.init` missing `release` or env-var not injected at build time | Add `release: import.meta.env.VITE_APP_VERSION` in `Sentry.init`; ensure Vercel sets `VITE_APP_VERSION` from `package.json:version`. |
| CSP console errors (`Refused to connect to ...`) | F-2-06 (CSP `connect-src` missing Sentry host) | Wave 7b fix. Interim: temporary add to `vercel.json`. |

## De-commissioning

To stop sending errors to Sentry:

1. Remove `VITE_SENTRY_DSN` from Vercel.
2. Redeploy.
3. Confirm the `curl | grep ingest.sentry.io` check returns nothing.

No code change required — the frontend `Sentry.init` call is a no-op when the
DSN env var is absent (see `frontend/src/main.jsx`).
