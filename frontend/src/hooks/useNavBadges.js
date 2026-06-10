import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';

const EMPTY = { players: null, coaches: null, teams: null, complianceOpen: null };

/**
 * Lightweight per-org counts for the side-nav badges. Selects ids only and
 * counts client-side (the mock client does not support head/count queries).
 * Null means "no badge" (loading, error, or zero).
 */
export function useNavBadges() {
  const { currentOrganization } = useOrganization();
  const orgId = currentOrganization?.id;
  // Keyed by org so a stale org's counts never render after switching.
  const [state, setState] = useState({ orgId: null, badges: EMPTY });

  useEffect(() => {
    if (!orgId) return undefined;
    let cancelled = false;

    const countRows = async (table) => {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('id')
          .eq('organization_id', orgId);
        if (error) return null;
        return data?.length || null;
      } catch {
        return null;
      }
    };

    (async () => {
      const [players, coaches, teams] = await Promise.all([
        countRows('players'),
        countRows('coaches'),
        countRows('teams'),
      ]);
      if (!cancelled) {
        setState({ orgId, badges: { players, coaches, teams, complianceOpen: null } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return state.orgId === orgId ? state.badges : EMPTY;
}
