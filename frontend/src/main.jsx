import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import './index.css';

// ---------------------------------------------------------------------------
// Sentry initialization — Phase 9 Production Hardening
//
// Gated behind VITE_SENTRY_DSN. When the env var is absent or empty,
// Sentry.init() is skipped entirely and the SDK tree-shakes to near-zero
// in the production bundle (Vite dead-code elimination).
// ---------------------------------------------------------------------------
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.DEV ? 'development' : 'production',

    // React-specific integrations
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],

    // Free tier budget: 10k errors + 10k perf txns / month
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.DEV ? 1.0 : 0.5,

    // Filter noisy console breadcrumbs in dev
    beforeBreadcrumb(breadcrumb) {
      if (import.meta.env.DEV && breadcrumb.category === 'console') return null;
      return breadcrumb;
    },
  });
}

// ---------------------------------------------------------------------------
// App mount — withProfiler wraps <App /> for Sentry performance tracing
// (no-op if Sentry is not initialized)
// ---------------------------------------------------------------------------
const ProfiledApp = Sentry.withProfiler(App);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ProfiledApp />
  </React.StrictMode>
);
