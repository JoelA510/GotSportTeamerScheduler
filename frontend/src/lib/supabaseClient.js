/// <reference types="vite/client" />
/**
 * Supabase Client — Environment-Aware Switcher
 *
 * Exports a single `supabase` client that is either:
 *   - A real @supabase/supabase-js client (when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set)
 *   - A sessionStorage-backed mock client (for E2E tests and local dev without a backend)
 *
 * All consumers import `{ supabase }` from this module — the switch is transparent.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_MOCK_MODE } from '../config.js';
import { logger } from './logger.js';
import { mockSupabase } from './mockSupabaseClient.js';

if (IS_MOCK_MODE) {
  logger.log('[Supabase] Initializing MOCK client');
  logger.warn('Using mock Supabase client due to missing or placeholder environment variables.');
} else {
  logger.log('[Supabase] Initializing REAL client →', SUPABASE_URL);
}

/**
 * The Supabase client instance — real or mock depending on environment.
 * @type {import('@supabase/supabase-js').SupabaseClient}
 */
export const supabase = IS_MOCK_MODE
  ? /** @type {any} */ (mockSupabase)
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
