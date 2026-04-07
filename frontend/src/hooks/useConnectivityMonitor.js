import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { IS_MOCK_MODE } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * @typedef {'online' | 'degraded' | 'offline' | 'maintenance'} ConnectivityStatus
 */

/**
 * useConnectivityMonitor — Phase 9 Production Hardening
 *
 * Monitors browser online/offline state AND Supabase backend reachability.
 * Returns a connectivity status that drives the Offline Guard overlay.
 *
 * Strategy:
 *  - Listens to `navigator.onLine` for coarse browser connectivity.
 *  - Periodically pings the Supabase REST health endpoint (every 30s when online,
 *    every 10s when degraded/offline to detect recovery quickly).
 *  - Detects "maintenance" if the backend returns a 503 or a custom header.
 *  - In mock mode, always reports 'online' (no real backend to check).
 *
 * @param {Object} [options]
 * @param {number} [options.pollIntervalMs=30000]  Healthy-state poll interval.
 * @param {number} [options.recoveryIntervalMs=10000]  Degraded/offline poll interval.
 * @param {number} [options.timeoutMs=5000]  Per-ping timeout.
 * @returns {{ status: ConnectivityStatus, lastChecked: Date|null, checkNow: () => Promise<void> }}
 */
export function useConnectivityMonitor({
  pollIntervalMs = 30_000,
  recoveryIntervalMs = 10_000,
  timeoutMs = 5_000,
} = {}) {
  const [status, setStatus] = useState(
    /** @type {ConnectivityStatus} */ (navigator.onLine ? 'online' : 'offline')
  );
  const [lastChecked, setLastChecked] = useState(/** @type {Date|null} */ (null));
  const intervalRef = useRef(/** @type {ReturnType<typeof setInterval>|null} */ (null));
  const consecutiveFailures = useRef(0);

  const checkBackend = useCallback(async () => {
    // Mock mode — always online
    if (IS_MOCK_MODE) {
      setStatus('online');
      setLastChecked(new Date());
      return;
    }

    // Browser says offline — skip network call
    if (!navigator.onLine) {
      setStatus('offline');
      setLastChecked(new Date());
      consecutiveFailures.current++;
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Use a lightweight Supabase REST call (select 0 rows from a public table).
      // The real check is whether we get any HTTP response at all.
      const { error } = await supabase
        .from('organizations')
        .select('id', { count: 'exact', head: true })
        .limit(0)
        .abortSignal(controller.signal);

      clearTimeout(timer);

      if (error) {
        // 503 = maintenance mode
        if (error.code === '503' || error.message?.includes('maintenance')) {
          setStatus('maintenance');
          consecutiveFailures.current++;
        } else {
          // Could be RLS blocking (which is fine — backend is reachable)
          // or a genuine problem. We only care that the round-trip succeeded.
          consecutiveFailures.current = 0;
          setStatus('online');
        }
      } else {
        consecutiveFailures.current = 0;
        setStatus('online');
      }
    } catch (err) {
      consecutiveFailures.current++;
      if (err.name === 'AbortError') {
        logger.warn('[connectivity] Health check timed out');
      } else {
        logger.warn('[connectivity] Health check failed', err.message);
      }
      // 2+ consecutive failures → offline; 1 failure → degraded
      setStatus(consecutiveFailures.current >= 2 ? 'offline' : 'degraded');
    }

    setLastChecked(new Date());
  }, [timeoutMs]);

  // Browser online/offline events
  useEffect(() => {
    const handleOnline = () => {
      logger.log('[connectivity] Browser reports online');
      checkBackend();
    };
    const handleOffline = () => {
      logger.log('[connectivity] Browser reports offline');
      setStatus('offline');
      consecutiveFailures.current++;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkBackend]);

  // Polling loop (adaptive interval based on current status)
  useEffect(() => {
    if (IS_MOCK_MODE) return;

    const interval = status === 'online' ? pollIntervalMs : recoveryIntervalMs;

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(checkBackend, interval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status, pollIntervalMs, recoveryIntervalMs, checkBackend]);

  // Initial check on mount
  useEffect(() => {
    checkBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, lastChecked, checkNow: checkBackend };
}
