import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { logger } from '../lib/logger.js';

/**
 * Players-grid data layer: org-scoped players + divisions, with optimistic
 * mutations that all flow through the audited admin RPCs (never direct
 * table writes). Failed mutations roll back to the server snapshot.
 */
export function usePlayersData() {
  const { currentOrganization } = useOrganization();
  const orgId = currentOrganization?.id;
  const [players, setPlayers] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [playersRes, divisionsRes] = await Promise.all([
        supabase.from('players').select('*').eq('organization_id', orgId),
        supabase.from('divisions').select('*').eq('organization_id', orgId),
      ]);
      if (playersRes.error) throw playersRes.error;
      if (divisionsRes.error) throw divisionsRes.error;
      setPlayers(playersRes.data || []);
      setDivisions(divisionsRes.data || []);
    } catch (err) {
      logger.error('[usePlayersData] fetch failed:', err);
      setError(err.message || 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** Optimistically apply `patch` to `ids`, run `rpc`, roll back on error. */
  const optimistic = useCallback(async (ids, patch, runRpc) => {
    let snapshot;
    setPlayers((current) => {
      snapshot = current;
      return current.map((player) => (ids.includes(player.id) ? { ...player, ...patch } : player));
    });
    try {
      const { error: rpcError } = await runRpc();
      if (rpcError) throw rpcError;
      return { success: true };
    } catch (err) {
      logger.error('[usePlayersData] mutation failed:', err);
      setPlayers(snapshot);
      return { success: false, error: err.message || 'Update failed' };
    }
  }, []);

  const updatePlayer = useCallback(
    (playerId, patch) =>
      optimistic([playerId], patch, () =>
        supabase.rpc('admin_update_player', { p_player_id: playerId, p_patch: patch })
      ),
    [optimistic]
  );

  const bulkUpdatePlayers = useCallback(
    (playerIds, patch) =>
      optimistic(playerIds, patch, () =>
        supabase.rpc('admin_bulk_update_players', { p_player_ids: playerIds, p_patch: patch })
      ),
    [optimistic]
  );

  const createPlayer = useCallback(
    async (fields = {}) => {
      try {
        const { data, error: rpcError } = await supabase.rpc('admin_create_player', {
          p_organization_id: orgId,
          p_fields: fields,
        });
        if (rpcError) throw rpcError;
        if (data) setPlayers((current) => [...current, data]);
        return { success: true, player: data };
      } catch (err) {
        logger.error('[usePlayersData] create failed:', err);
        return { success: false, error: err.message || 'Create failed' };
      }
    },
    [orgId]
  );

  const deletePlayers = useCallback(async (playerIds) => {
    let snapshot;
    setPlayers((current) => {
      snapshot = current;
      return current.filter((player) => !playerIds.includes(player.id));
    });
    try {
      const { error: rpcError } = await supabase.rpc('admin_delete_players', {
        p_player_ids: playerIds,
      });
      if (rpcError) throw rpcError;
      return { success: true };
    } catch (err) {
      logger.error('[usePlayersData] delete failed:', err);
      setPlayers(snapshot);
      return { success: false, error: err.message || 'Delete failed' };
    }
  }, []);

  return {
    players,
    divisions,
    loading,
    error,
    refetch: fetchAll,
    updatePlayer,
    bulkUpdatePlayers,
    createPlayer,
    deletePlayers,
  };
}
