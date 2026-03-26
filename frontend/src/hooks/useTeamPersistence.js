import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';

export function useTeamPersistence() {
  const { currentOrganization } = useOrganization();
  const [persistenceSnapshot, setPersistenceSnapshot] = useState({
    manualOverrides: [],
    runHistory: [],
    lastRunId: null,
    lastSyncedAt: null,
    preparedTeamRows: 0,
    preparedPlayerRows: 0,
    payload: {
      teamRows: [],
      teamPlayerRows: []
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrganization?.id) {
      setLoading(false);
      return;
    }

    async function fetchPersistenceHistory() {
      try {
        // Fetch recent team runs scoped to the current organization
        const { data: runs, error } = await supabase
          .from('scheduler_runs')
          .select('*')
          .eq('run_type', 'team')
          .eq('organization_id', currentOrganization.id)
          .order('created_at', { ascending: false })
          .limit(5);

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

        setPersistenceSnapshot({
          manualOverrides: [], // No table for overrides yet
          runHistory: history,
          lastRunId: lastRun?.id || null,
          lastSyncedAt: lastRun?.completed_at || null,
          preparedTeamRows: lastRun?.results?.teams?.length || 0,
          preparedPlayerRows: lastRun?.results?.team_players?.length || 0,
          payload: {
            teamRows: lastRun?.results?.teams || [],
            teamPlayerRows: lastRun?.results?.team_players || []
          }
        });
      } catch (err) {
        logger.error('Failed to init persistence snapshot:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchPersistenceHistory();
  }, [currentOrganization?.id]);

  return { persistenceSnapshot, loading };
}