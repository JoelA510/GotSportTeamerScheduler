import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * @typedef {'idle' | 'running' | 'polling' | 'completed' | 'failed'} AutoSchedulerStatus
 */

/**
 * @typedef {Object} AutoSchedulerResult
 * @property {Array<{ teamId: string, slotId: string, source: string }>} assignments
 * @property {Array<Object>} unassigned
 * @property {Object} evaluation
 * @property {Object} optimization
 * @property {string|null} runId
 */

/**
 * Hook to trigger and track auto-scheduler runs.
 *
 * Calls the auto-scheduler Edge Function and subscribes to Supabase Realtime
 * on the audit_log table for live progress events (scheduler.auto_progress).
 * The subscription is cleaned up on completion, failure, or manual cancel/reset.
 *
 * @param {Object} options
 * @param {string} options.organizationId
 * @returns {{ trigger: Function, cancel: Function, status: AutoSchedulerStatus, result: AutoSchedulerResult|null, error: string|null, progress: { iteration: number, bestScore: number, elapsedMs: number }|null, reset: Function }}
 */
export function useAutoScheduler({ organizationId }) {
  /** @type {[AutoSchedulerStatus, Function]} */
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const abortRef = useRef(null);
  const channelRef = useRef(null);

  /** Remove the Realtime channel subscription if active. */
  const teardownChannel = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    teardownChannel();
    setStatus('idle');
    setResult(null);
    setError(null);
    setProgress(null);
  }, [teardownChannel]);

  /**
   * Cancel a running optimization.
   * Aborting the fetch causes the Deno Edge Function to terminate
   * (Deno handles client disconnects by ending the handler).
   */
  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    teardownChannel();
    setStatus('idle');
    setProgress(null);
  }, [teardownChannel]);

  const trigger = useCallback(
    async ({
      teams,
      slots,
      coachPreferences,
      divisionPreferences,
      lockedAssignments,
      scoringWeights,
      schoolDayEnd,
      timezone,
      config,
    }) => {
      if (!organizationId) {
        setError('No organization selected');
        setStatus('failed');
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setStatus('running');
      setError(null);
      setResult(null);
      setProgress({ iteration: 0, bestScore: 0, elapsedMs: 0 });

      // --- Realtime subscription for live progress ---
      teardownChannel();

      const channel = supabase
        .channel('auto-scheduler-progress')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'audit_log',
            filter: `organization_id=eq.${organizationId}`,
          },
          (payload) => {
            const row = payload.new;
            if (row?.action === 'scheduler.auto_progress' && row?.metadata) {
              const meta =
                typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
              setProgress({
                iteration: meta.iteration ?? 0,
                bestScore: meta.bestScore ?? 0,
                elapsedMs: meta.elapsedMs ?? 0,
              });
            }
          }
        )
        .subscribe();

      channelRef.current = channel;

      // --- Edge Function call ---
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        if (!token) {
          throw new Error('Not authenticated');
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(`${supabaseUrl}/functions/v1/auto-scheduler`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            organizationId,
            teams,
            slots,
            coachPreferences: coachPreferences ?? {},
            divisionPreferences: divisionPreferences ?? {},
            lockedAssignments: lockedAssignments ?? [],
            scoringWeights: scoringWeights ?? {},
            schoolDayEnd,
            timezone,
            config: config ?? {},
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.error || `Server error: ${response.status}`);
        }

        const data = await response.json();

        setResult({
          assignments: data.assignments,
          unassigned: data.unassigned,
          evaluation: data.evaluation,
          optimization: data.optimization,
          runId: data.runId,
        });
        setProgress({
          iteration: data.optimization?.iterations ?? 0,
          bestScore: data.optimization?.bestScore ?? 0,
          elapsedMs: data.optimization?.elapsedMs ?? 0,
        });
        setStatus('completed');
      } catch (err) {
        if (err.name === 'AbortError') {
          setStatus('idle');
          return;
        }
        setError(err.message || 'Auto-scheduler failed');
        setStatus('failed');
      } finally {
        teardownChannel();
      }
    },
    [organizationId, teardownChannel]
  );

  return { trigger, cancel, status, result, error, progress, reset };
}
