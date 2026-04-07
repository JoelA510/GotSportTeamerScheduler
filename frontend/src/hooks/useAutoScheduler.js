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
 * Calls the auto-scheduler Edge Function, then polls evaluation_runs
 * for status updates until completion.
 *
 * @param {Object} options
 * @param {string} options.organizationId
 * @returns {{ trigger: Function, status: AutoSchedulerStatus, result: AutoSchedulerResult|null, error: string|null, progress: { iteration: number, bestScore: number, elapsedMs: number }|null, reset: Function }}
 */
export function useAutoScheduler({ organizationId }) {
  /** @type {[AutoSchedulerStatus, Function]} */
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const abortRef = useRef(null);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus('idle');
    setResult(null);
    setError(null);
    setProgress(null);
  }, []);

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
      }
    },
    [organizationId]
  );

  return { trigger, status, result, error, progress, reset };
}
