import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { logger } from '../lib/logger.js';
// Use absolute import via configured alias
import { mapSchedulerRunToSummary } from '../../../packages/core/src/utils/teamSummaryMapper.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { scopeSchedulerRunsToActiveSeason } from '../utils/schedulerRunFilters.js';

// Fallback skeleton
const EMPTY_SUMMARY = {
  totals: {
    divisions: 0,
    teams: 0,
    playersAssigned: 0,
    overflowPlayers: 0,
    divisionsNeedingCoaches: 0,
    divisionsWithOpenRosterSlots: 0,
  },
  divisions: [],
  teams: [],
  team_players: [],
  generatedAt: null,
};

export function useTeamSummary() {
  const { currentOrganization, currentSeasonSetting } = useOrganization();
  const [summary, setSummary] = useState(null); // null triggers loading state
  const [loading, setLoading] = useState(true);
  const [error, _setError] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, running, completed, error
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let pollInterval;

    if (!currentOrganization?.id || !currentSeasonSetting?.id) {
      setSummary(EMPTY_SUMMARY);
      setLoading(false);
      setStatus('idle');
      setProgress(0);
      return;
    }

    async function fetchLatestRun() {
      try {
        // Fetch the latest run for the CURRENT ORGANIZATION, regardless of status
        let runQuery = supabase
          .from('scheduler_runs')
          .select('*')
          .eq('run_type', 'team')
          .eq('organization_id', currentOrganization.id)
          .in('status', ['completed', 'running'])
          .order('created_at', { ascending: false });

        runQuery = scopeSchedulerRunsToActiveSeason(runQuery, currentSeasonSetting.id);

        const { data, error: queryError } = await runQuery.limit(1).single();

        if (queryError) {
          if (queryError.code === 'PGRST116') {
            setSummary(EMPTY_SUMMARY);
            setLoading(false);
            setStatus('idle');
            return;
          }
          throw queryError;
        }

        // Update status and progress
        setStatus(data.status);
        // Assume progress is stored in metrics or calculate it (mocking for now if not present)
        const currentProgress = data.metrics?.progress || (data.status === 'completed' ? 100 : 0);
        setProgress(currentProgress);

        if (data.status === 'completed') {
          const mapped = mapSchedulerRunToSummary(data);
          setSummary(mapped || EMPTY_SUMMARY);
          setLoading(false);
        } else if (data.status === 'running') {
          // If running, keep loading true (or handle partial data if available)
          // but we have status to show progress bar
          setLoading(true);
        }
      } catch (err) {
        logger.error('Failed to fetch team summary:', JSON.stringify(err, null, 2));
      }
    }

    setLoading(true);
    fetchLatestRun();

    // Poll if running
    pollInterval = setInterval(() => {
      fetchLatestRun();
    }, 2000);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [currentOrganization?.id, currentSeasonSetting?.id]);

  return { summary, loading, error, status, progress, generatedAt: summary?.generatedAt };
}
