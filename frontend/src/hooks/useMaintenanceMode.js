import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { IS_MOCK_MODE } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * useMaintenanceMode — Phase 9 Production Hardening
 *
 * Subscribes to the `organizations` table via Supabase Realtime to detect
 * when an admin toggles the `maintenance_mode` flag in `organizations.settings`.
 *
 * Returns `true` when the current organization is in maintenance mode.
 * In mock mode, always returns `false`.
 *
 * @param {string|null|undefined} organizationId — the active org ID
 * @returns {{ isMaintenanceMode: boolean }}
 */
export function useMaintenanceMode(organizationId) {
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);

  // Initial fetch of the maintenance_mode flag
  useEffect(() => {
    if (!organizationId || IS_MOCK_MODE) return;

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', organizationId)
          .single();

        if (!cancelled && !error && data?.settings) {
          setIsMaintenanceMode(data.settings.maintenance_mode === true);
        }
      } catch {
        // Swallow — connectivity monitor handles offline state
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Realtime subscription for live updates
  useEffect(() => {
    if (!organizationId || IS_MOCK_MODE) return;

    const channel = supabase
      .channel(`maintenance-mode-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'organizations',
          filter: `id=eq.${organizationId}`,
        },
        (payload) => {
          const settings = payload.new?.settings;
          if (settings && typeof settings.maintenance_mode === 'boolean') {
            logger.log('[maintenance] Mode changed:', settings.maintenance_mode);
            setIsMaintenanceMode(settings.maintenance_mode);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  return { isMaintenanceMode };
}
