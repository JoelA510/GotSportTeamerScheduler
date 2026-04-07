/**
 * BetterStack (Logtail) logger for Supabase Edge Functions — Phase 9
 *
 * Streams structured JSON logs to BetterStack's Logtail ingestion endpoint.
 * Gated behind the BETTERSTACK_SOURCE_TOKEN env var; when absent, logs are
 * console-only (no-op for the HTTP transport).
 *
 * Usage in Edge Functions:
 *   import { edgeLogger } from '../_shared/logtail.ts';
 *   edgeLogger.info('Scheduler started', { teamCount: 12 });
 *   edgeLogger.error('RPC failed', { error: err.message });
 *   await edgeLogger.flush();  // call before returning the Response
 */

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  dt: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  function_name: string;
}

const LOGTAIL_URL = 'https://in.logs.betterstack.com';
const SOURCE_TOKEN = Deno.env.get('BETTERSTACK_SOURCE_TOKEN') ?? '';
const FUNCTION_NAME = Deno.env.get('FUNCTION_NAME') ?? 'unknown';

/** Buffered log entries waiting to be flushed. */
const buffer: LogEntry[] = [];

function log(level: LogLevel, message: string, context: Record<string, unknown> = {}) {
  const entry: LogEntry = {
    dt: new Date().toISOString(),
    level,
    message,
    context,
    function_name: FUNCTION_NAME,
  };

  // Always emit to console (visible in Supabase Dashboard logs)
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${level.toUpperCase()}] ${message}`, context);

  // Buffer for batch flush to BetterStack
  if (SOURCE_TOKEN) {
    buffer.push(entry);
  }
}

/**
 * Flush all buffered log entries to BetterStack.
 * Call this before returning the HTTP response from the Edge Function.
 * Returns silently on failure — logging should never break the function.
 */
async function flush(): Promise<void> {
  if (!SOURCE_TOKEN || buffer.length === 0) return;

  const entries = buffer.splice(0, buffer.length);

  try {
    await fetch(LOGTAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SOURCE_TOKEN}`,
      },
      body: JSON.stringify(entries),
    });
  } catch {
    // Swallow — logging must never crash the function
    console.warn('[logtail] Failed to flush logs to BetterStack');
  }
}

export const edgeLogger = {
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
  flush,
};
