import React from 'react';
import * as Sentry from '@sentry/react';
import { ShieldAlert } from 'lucide-react';
import { logger } from '../lib/logger.js';

/**
 * Fallback UI shown when the error boundary catches an unhandled error.
 * Rendered inside Sentry.ErrorBoundary's `fallback` prop so that Sentry
 * automatically captures the exception with full React component stack.
 */
function ErrorFallback({ error: _error, resetError: _resetError }) {
  return (
    <div className="min-h-screen bg-bg-app flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-bg-surface/50 backdrop-blur-xl border border-border-subtle rounded-3xl p-8 text-center shadow-2xl">
        <div className="w-20 h-20 bg-status-error-bg rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldAlert className="text-status-error" size={40} />
        </div>
        <h1 className="text-2xl font-display font-bold text-text-primary mb-2">
          Something went wrong
        </h1>
        <p className="text-text-muted mb-8 text-sm leading-relaxed">
          The application encountered an unexpected error.
        </p>
        <button
          onClick={() => (window.location.href = '/')}
          className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg shadow-brand-glow"
        >
          Return Home
        </button>
      </div>
    </div>
  );
}

/**
 * ErrorBoundary — Phase 9 Production Hardening
 *
 * Uses Sentry.ErrorBoundary when the Sentry SDK is initialized (VITE_SENTRY_DSN set),
 * falling back to a vanilla React class-based error boundary otherwise.
 * This ensures Sentry captures the full component stack, breadcrumbs, and replay
 * for every unhandled render error.
 */
function ErrorBoundary({ children }) {
  return (
    <Sentry.ErrorBoundary
      fallback={(props) => <ErrorFallback {...props} />}
      onError={(/** @type {Error} */ error, componentStack) => {
        logger.captureException(error, {
          extra: { componentStack },
          tags: { boundary: 'root' },
        });
      }}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}

export default ErrorBoundary;
