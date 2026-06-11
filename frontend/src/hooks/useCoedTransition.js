import { useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { planCoedMerge, planGenderSplit } from '@squadlogic/core/coedTransition.js';
import { logger } from '../lib/logger.js';

/**
 * Applies a co-ed merge or gender split for the active org/season:
 * plans with the pure core module, upserts the target divisions through
 * the audited upsert_division_for_import RPC, moves players via
 * admin_update_player (team_id cleared — rosters are rebuilt afterwards
 * in the Team Builder or via a teaming re-run), and records an audit
 * event. Returns { success, moved, error? }.
 */
export function useCoedTransition() {
  const { currentOrganization, currentSeasonSetting } = useOrganization();
  const orgId = currentOrganization?.id;
  const seasonId = currentSeasonSetting?.id;

  const fetchInputs = useCallback(async () => {
    const [divisionsRes, playersRes, teamsRes] = await Promise.all([
      supabase.from('divisions').select('*').eq('organization_id', orgId),
      supabase
        .from('players')
        .select('id, division_id, team_id, gender')
        .eq('organization_id', orgId),
      supabase.from('teams').select('id, division_id').eq('organization_id', orgId),
    ]);
    if (divisionsRes.error) throw divisionsRes.error;
    if (playersRes.error) throw playersRes.error;
    if (teamsRes.error) throw teamsRes.error;
    return {
      divisions: divisionsRes.data || [],
      players: playersRes.data || [],
      teams: teamsRes.data || [],
    };
  }, [orgId]);

  const upsertDivision = useCallback(
    async ({ name, gender_policy: genderPolicy }) => {
      const { data, error } = await supabase.rpc('upsert_division_for_import', {
        p_organization_id: orgId,
        p_season_settings_id: seasonId,
        p_name: name,
        p_gender: genderPolicy,
      });
      if (error) throw error;
      return data;
    },
    [orgId, seasonId]
  );

  const movePlayers = useCallback(async (playerIds, divisionId) => {
    for (const playerId of playerIds) {
      // Sequential audited updates; bulk RPC intentionally excludes
      // division/team reassignment.

      const { error } = await supabase.rpc('admin_update_player', {
        p_player_id: playerId,
        p_patch: { division_id: divisionId, team_id: null },
      });
      if (error) throw error;
    }
  }, []);

  const applyCoedMerge = useCallback(async () => {
    if (!orgId || !seasonId) return { success: false, error: 'No active season' };
    try {
      const inputs = await fetchInputs();
      const { merges } = planCoedMerge(inputs);
      let moved = 0;
      for (const merge of merges) {
        const division = await upsertDivision(merge.divisionUpsert);

        await movePlayers(merge.playerIds, division.id);
        moved += merge.playerIds.length;
      }
      await supabase.rpc('record_audit_event', {
        p_organization_id: orgId,
        p_action: 'divisions.coed_merged',
        p_metadata: { age_groups: merges.map((m) => m.age), players_moved: moved },
      });
      return { success: true, moved };
    } catch (err) {
      logger.error('[useCoedTransition] merge failed:', err);
      return { success: false, error: err.message || 'Merge failed' };
    }
  }, [orgId, seasonId, fetchInputs, upsertDivision, movePlayers]);

  const applyGenderSplit = useCallback(async () => {
    if (!orgId || !seasonId) return { success: false, error: 'No active season' };
    try {
      const inputs = await fetchInputs();
      const { splits } = planGenderSplit(inputs);
      let moved = 0;
      for (const split of splits) {
        for (const target of split.targets) {
          const division = await upsertDivision(target.divisionUpsert);
          // eslint-disable-next-loop no-await-in-loop

          await movePlayers(target.playerIds, division.id);
          moved += target.playerIds.length;
        }
      }
      await supabase.rpc('record_audit_event', {
        p_organization_id: orgId,
        p_action: 'divisions.gender_split',
        p_metadata: { age_groups: splits.map((s) => s.age), players_moved: moved },
      });
      return { success: true, moved };
    } catch (err) {
      logger.error('[useCoedTransition] split failed:', err);
      return { success: false, error: err.message || 'Split failed' };
    }
  }, [orgId, seasonId, fetchInputs, upsertDivision, movePlayers]);

  return { applyCoedMerge, applyGenderSplit };
}
