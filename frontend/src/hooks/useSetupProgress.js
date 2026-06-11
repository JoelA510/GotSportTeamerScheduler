import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useOrganization } from '../contexts/OrganizationContext.jsx';
import { useDashboardData } from './useDashboardData.js';

/**
 * Season Setup checklist state, derived entirely from live data — which is
 * what makes the checklist resumable and non-destructive: leaving midway
 * loses nothing because nothing is stored about the checklist itself.
 *
 * Steps: features → import → teams → fields → practices → games → publish.
 */
export function useSetupProgress() {
  const { currentOrganization, featureFlags = {} } = useOrganization();
  const { team, practice, game } = useDashboardData();
  const orgId = currentOrganization?.id;
  const [counts, setCounts] = useState({ players: 0, teams: 0, fields: 0, loaded: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!orgId) return;
      const countOf = async (table) => {
        try {
          const { data, error } = await supabase
            .from(table)
            .select('id')
            .eq('organization_id', orgId);
          return error ? 0 : (data || []).length;
        } catch {
          return 0;
        }
      };
      const [players, teams, fields] = await Promise.all([
        countOf('players'),
        countOf('teams'),
        countOf('fields'),
      ]);
      if (!cancelled) setCounts({ players, teams, fields, loaded: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return useMemo(() => {
    const steps = [
      {
        id: 'features',
        title: 'Choose your tools',
        description:
          'Pick which optional fields and features your club uses — Rating, Years Played, division format, and more.',
        route: '/setup/features',
        done: Object.keys(featureFlags).length > 0 || !!currentOrganization?.is_onboarded,
        count: Object.keys(featureFlags).length ? 'Configured' : 'Recommended first',
      },
      {
        id: 'import',
        title: 'Import registrations',
        description: 'Upload the GotSport CSV and map columns to players & coaches.',
        route: '/import',
        done: counts.players > 0,
        count: counts.players ? `${counts.players} players` : 'Not started',
      },
      {
        id: 'teams',
        title: 'Generate & balance teams',
        description: 'Auto-allocate players honoring buddy requests and coach assignments.',
        route: '/teams',
        done: counts.teams > 0 || !!team?.generatedAt,
        count: counts.teams ? `${counts.teams} teams` : 'Not started',
      },
      {
        id: 'fields',
        title: 'Configure fields & blackouts',
        description: 'Set venues, field priorities, and unavailable dates.',
        route: '/fields',
        done: counts.fields > 0,
        count: counts.fields ? `${counts.fields} fields` : 'Not started',
      },
      {
        id: 'practices',
        title: 'Schedule practices',
        description: 'Run the conflict-aware practice allocator.',
        route: '/schedule/practice',
        done: !!practice?.generatedAt,
        count: practice?.generatedAt ? 'Generated' : 'Not started',
      },
      {
        id: 'games',
        title: 'Schedule games',
        description: 'Generate round-robin matchups and field slots.',
        route: '/schedule/game',
        done: !!game?.generatedAt,
        count: game?.generatedAt ? 'Generated' : 'Not started',
      },
      {
        id: 'publish',
        title: 'Publish & notify',
        description: 'Export schedules and share them with coaches and families.',
        route: '/exports',
        done: !!currentOrganization?.is_onboarded,
        count: currentOrganization?.is_onboarded ? 'Season live' : '',
      },
    ];
    const doneCount = steps.filter((step) => step.done).length;
    const nextStep = steps.find((step) => !step.done) || null;
    return {
      steps,
      doneCount,
      total: steps.length,
      percent: Math.round((doneCount / steps.length) * 100),
      nextStep,
      loaded: counts.loaded,
    };
  }, [featureFlags, currentOrganization?.is_onboarded, counts, team, practice, game]);
}
