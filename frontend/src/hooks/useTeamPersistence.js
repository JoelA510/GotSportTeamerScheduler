import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import {
  scopeSchedulerRunsToActiveSeason,
  buildPayloadByDivision,
} from '../utils/schedulerRunFilters.js';

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
  // Most-recent persisted payload PER division (a run persists one division). `payload` only
  // surfaces the single most-recent run; this lets a re-run of ANY previously-persisted division
  // — not just the most-recently-persisted one — still find its teams to preserve.
  payloadByDivision: {},
};

/**
 * Newest run per division, unbounded: the `get_latest_team_runs_per_division` RPC (DISTINCT ON in
 * the DB, SECURITY INVOKER so scheduler_runs RLS applies). Returns null when the RPC is
 * unavailable (older DB, mock without the handler, transient error) — callers then fall back to
 * deriving the map from the bounded recent-runs window.
 */
async function fetchLatestRunsPerDivision(organizationId, seasonSettingsId) {
  try {
    const { data, error } = await supabase.rpc('get_latest_team_runs_per_division', {
      p_organization_id: organizationId,
      p_season_settings_id: seasonSettingsId ?? null,
    });
    if (error || !Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

export function useTeamPersistence() {
  const { currentOrganization, currentSeasonSetting } = useOrganization();
  const [persistenceSnapshot, setPersistenceSnapshot] = useState(EMPTY_PERSISTENCE_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  // Bumping refreshKey re-runs the fetch effect — e.g. after a sync persists a new run, so a
  // same-session re-run sees the just-persisted teams instead of the stale pre-sync snapshot.
  const [refreshKey, setRefreshKey] = useState(0);

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

        // Fetch a wider window than we display so payloadByDivision (below) can preserve a
        // re-run of a division whose last run is older than the few most-recent ones. Very
        // high-churn orgs (>20 recent runs without touching a division) may still need a reload.
        const { data: runs, error } = await runQuery.limit(20);

        if (error) {
          logger.error('Error fetching persistence history:', error);
          return;
        }

        // Map the few most-recent runs to the format expected by TeamPersistencePanel.
        const history = runs.slice(0, 5).map((run) => ({
          runId: run.id,
          status: run.status,
          startedAt: run.started_at,
          updatedTeams: run.results?.teams?.length || 0,
          updatedPlayers: 0, // Not explicitly tracked in run results usually
          notes: run.status === 'completed' ? 'Scheduled successfully' : 'Run failed',
        }));

        // Per-division preservation map: prefer the unbounded newest-per-division RPC; fall back
        // to the bounded window above when the RPC is unavailable.
        const latestPerDivision = await fetchLatestRunsPerDivision(
          currentOrganization.id,
          currentSeasonSetting.id
        );
        const runsForDivisionMap =
          latestPerDivision && latestPerDivision.length > 0 ? latestPerDivision : runs;

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
          payloadByDivision: buildPayloadByDivision(runsForDivisionMap),
        });
      } catch (err) {
        logger.error('Failed to init persistence snapshot:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchPersistenceHistory();
  }, [currentOrganization?.id, currentSeasonSetting?.id, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return { persistenceSnapshot, loading, refresh };
}
