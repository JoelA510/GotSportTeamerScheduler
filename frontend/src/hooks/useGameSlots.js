import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { mapKeysToCamelCase } from '../utils/caseConverters.js';
import { logger } from '../lib/logger.js';

/**
 * Fetches all game_slots for the current organization.
 * These represent the full set of available time slots across fields,
 * including empty ones that have no assignments yet.
 */
export function useGameSlots() {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchSlots() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fetchError } = await supabase.from('game_slots').select('*');

        if (fetchError) throw fetchError;

        const mapped = (data || []).map(mapKeysToCamelCase);
        setSlots(mapped);
      } catch (err) {
        logger.error('Error fetching game slots:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchSlots();
  }, []);

  return { slots, loading, error };
}
