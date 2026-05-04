import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { mapKeysToCamelCase } from '../utils/caseConverters.js';
import { logger } from '../lib/logger.js';

export function usePracticeAssignments(runId) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!runId) {
      setAssignments([]);
      return;
    }

    async function fetchAssignments() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fetchError } = await supabase
          .from('practice_assignments')
          .select(
            `
            *,
            practice_slots (
              id,
              day_of_week,
              start_time,
              end_time,
              field_id,
              fields (
                id,
                name
              )
            ),
            teams (
              id,
              name,
              divisions (
                id,
                name
              )
            )
          `
          )
          .eq('run_id', runId);

        if (fetchError) throw fetchError;

        const mapped = (data || []).map(mapKeysToCamelCase);
        setAssignments(mapped);
      } catch (err) {
        logger.error('Error fetching practice assignments:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchAssignments();
  }, [runId]);

  return { assignments, loading, error };
}
