import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { mapKeysToCamelCase } from '../utils/caseConverters.js';

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
          .select(`
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
          `)
          .eq('run_id', runId);

        if (fetchError) throw fetchError;

        const mapped = (data || []).map(mapKeysToCamelCase);
        setAssignments(mapped);
      } catch (err) {
        console.error('Error fetching practice assignments:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchAssignments();
  }, [runId]);
  
  const updateAssignmentSource = async (assignmentId, newSource) => {
    try {
      const { error: updateError } = await supabase
        .from('practice_assignments')
        .update({ source: newSource })
        .eq('id', assignmentId);

      if (updateError) throw updateError;
      
      // Update local state
      setAssignments(prev => prev.map(a => 
        a.id === assignmentId ? { ...a, source: newSource } : a
      ));
    } catch (err) {
      console.error('Error updating assignment source:', err);
      setError(err);
      throw err;
    }
  };

  return { assignments, loading, error, updateAssignmentSource };
}
