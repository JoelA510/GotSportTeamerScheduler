import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { scopeSchedulerRunsToActiveSeason } from '../utils/schedulerRunFilters.js';

const EMPTY_PERSISTENCE_SNAPSHOT = {
  manualOverrides: [],
  runHistory: [],
  lastRunId: null,
  lastSyncedAt: null,
  preparedTeamRows: 0,
  preparedPlayerRows: 0,
  runMetadata: {},
  payload: {
    teamRows: [],
    teamPlayerRows: [],
  },
};

export function useTeamPersistence() {
  const { currentOrganization, currentSeasonSetting } = useOrganization();
  const [persistenceSnapshot, setPersistenceSnapshot] = useState(EMPTY_PERSISTENCE_SNAPSHOT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrganization?.id || !currentSeasonSetting?.id) {
      setPersistenceSnapshot(EMPTY_PERSISTENCE_SNAPSHOT);
      setLoading(false);
      return;
    }

    async function fetchPersistenceHistory() {
      setLoading(true);
      try {
        // Fetch recent team runs scoped to the current organization
        let runQuery = supabase
          .from('scheduler_runs')
          .select('*')
          .eq('run_type', 'team')
          .eq('organization_id', currentOrganization.id)
          .order('created_at', { ascending: false });

        runQuery = scopeSchedulerRunsToActiveSeason(runQuery, currentSeasonSetting.id);

        const { data: runs, error } = await runQuery.limit(5);

        if (error) {
          logger.error('Error fetching persistence history:', error);
          return;
        }

        // Map runs to the format expected by TeamPersistencePanel
        const history = runs.map((run) => ({
          runId: run.id,
          status: run.status,
          startedAt: run.started_at,
          updatedTeams: run.results?.teams?.length || 0,
          updatedPlayers: 0, // Not explicitly tracked in run results usually
          notes: run.status === 'completed' ? 'Scheduled successfully' : 'Run failed',
        }));

        const lastRun = runs[0];
        const lastRunMetadata = lastRun
          ? {
              runId: lastRun.id,
              organizationId: lastRun.organization_id,
              seasonId: lastRun.season_id ?? lastRun.season_settings_id,
              seasonSettingsId: lastRun.season_settings_id,
              runType: lastRun.run_type,
              status: lastRun.status,
              parameters: lastRun.parameters ?? {},
              metrics: lastRun.metrics ?? {},
              results: lastRun.results ?? {},
              createdBy: lastRun.created_by,
              startedAt: lastRun.started_at,
              completedAt: lastRun.completed_at,
            }
          : {
              organizationId: currentOrganization.id,
              seasonId: currentSeasonSetting.id,
              seasonSettingsId: currentSeasonSetting.id,
              runType: 'team',
            };

        setPersistenceSnapshot({
          manualOverrides: [], // No table for overrides yet
          runHistory: history,
          lastRunId: lastRun?.id || null,
          lastSyncedAt: lastRun?.completed_at || null,
          preparedTeamRows: lastRun?.results?.teams?.length || 0,
          preparedPlayerRows: lastRun?.results?.team_players?.length || 0,
          runMetadata: lastRunMetadata,
          payload: {
            teamRows: lastRun?.results?.teams || [],
            teamPlayerRows: lastRun?.results?.team_players || [],
          },
        });
      } catch (err) {
        logger.error('Failed to init persistence snapshot:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchPersistenceHistory();
  }, [currentOrganization?.id, currentSeasonSetting?.id]);

  return { persistenceSnapshot, loading };
}
