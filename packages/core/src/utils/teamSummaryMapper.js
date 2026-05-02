/**
 * Maps a scheduler run result (from Supabase scheduler_runs table)
 * to the summary format expected by TeamOverviewPanel.
 */
export function mapSchedulerRunToSummary(run) {
  if (!run || !run.results) {
    return null;
  }

  const { results, completed_at, created_at } = run;

  // Use completed_at if available, otherwise created_at
  const generatedAt = completed_at || created_at;

  // Extract high-level metrics from the results payload
  const {
    teamsByDivision,
    overflowByDivision,
    overflowSummaryByDivision,
    buddyDiagnosticsByDivision,
    coachCoverageByDivision,
    rosterBalanceByDivision,
    team_players,
  } = results;

  // 1. Calculate Per-Division Statistics first
  const divisionKeys = Object.keys(teamsByDivision || {});

  const divisions = divisionKeys.map((divisionId) => {
    const teams = teamsByDivision[divisionId] || [];
    const rosterBalance = rosterBalanceByDivision?.[divisionId];
    const coachCoverage = coachCoverageByDivision?.[divisionId];
    const buddyDiagnostics = buddyDiagnosticsByDivision?.[divisionId];
    const overflowSummary = overflowSummaryByDivision?.[divisionId];

    // Derive teams needing players
    const teamsNeedingPlayers = (rosterBalance?.teamStats || [])
      .filter((t) => t.slotsRemaining > 0)
      .map((t) => t.teamId);

    // Sum unmatched buddy reasons
    const unmatchedBuddyReasons = {};
    (buddyDiagnostics?.unmatchedRequests || []).forEach((req) => {
      const reason = req.reason || 'unknown';
      unmatchedBuddyReasons[reason] = (unmatchedBuddyReasons[reason] || 0) + 1;
    });

    // Sum overflow reasons
    const overflowPlayersByReason = {};
    const overflowByReason = {};

    if (overflowSummary?.byReason) {
      Object.entries(overflowSummary.byReason).forEach(([reason, stats]) => {
        overflowByReason[reason] = stats.units;
        overflowPlayersByReason[reason] = stats.players;
      });
    }

    const overflowPlayersCount =
      overflowSummary?.totalPlayers ??
      (overflowByDivision?.[divisionId] || []).reduce(
        (sum, item) => sum + (item.players || []).length,
        0
      );

    return {
      divisionId,
      totalTeams: teams.length,
      playersAssigned: rosterBalance?.summary?.totalPlayers || 0,
      totalCapacity: rosterBalance?.summary?.totalCapacity || 0,
      averageFillRate: rosterBalance?.summary?.averageFillRate || 0,
      teamsNeedingPlayers,
      slotsRemaining:
        (rosterBalance?.summary?.totalCapacity || 0) - (rosterBalance?.summary?.totalPlayers || 0),
      needsAdditionalCoaches: coachCoverage?.needsAdditionalCoaches || false,
      coachCoverage: {
        totalTeams: coachCoverage?.totalTeams || 0,
        volunteerCoaches: coachCoverage?.volunteerCoaches || 0,
        teamsWithCoach: coachCoverage?.teamsWithCoach || 0,
        teamsWithoutCoach: coachCoverage?.teamsWithoutCoach || 0,
        coverageRate: coachCoverage?.coverageRate || 0,
        needsAdditionalCoaches: coachCoverage?.needsAdditionalCoaches || false,
      },
      mutualBuddyPairs: (buddyDiagnostics?.mutualPairs || []).length,
      unmatchedBuddyCount: (buddyDiagnostics?.unmatchedRequests || []).length,
      unmatchedBuddyReasons,
      overflowUnits: overflowSummary?.totalUnits || 0,
      overflowPlayers: overflowPlayersCount,
      overflowByReason,
      overflowPlayersByReason,
    };
  });

  // 2. Reduce divisions to get Grand Totals
  const totals = divisions.reduce(
    (acc, div) => {
      acc.divisions++;
      acc.teams += div.totalTeams;
      acc.totalTeams += div.totalTeams;
      acc.playersAssigned += div.playersAssigned;
      acc.playersTarget += div.totalCapacity;
      acc.overflowPlayers += div.overflowPlayers;
      acc.manualReviewRequired += div.overflowPlayers;

      if (div.needsAdditionalCoaches) {
        acc.divisionsNeedingCoaches++;
      }
      if (div.slotsRemaining > 0) {
        acc.divisionsWithOpenRosterSlots++;
      }
      return acc;
    },
    {
      divisions: 0,
      teams: 0,
      totalTeams: 0,
      playersAssigned: 0,
      playersTarget: 0,
      overflowPlayers: 0,
      manualReviewRequired: 0,
      divisionsNeedingCoaches: 0,
      divisionsWithOpenRosterSlots: 0,
    }
  );

  // 3. Flatten teams for other components
  const allTeams = [];
  divisionKeys.forEach((division) => {
    const divisionTeams = teamsByDivision[division] || [];
    divisionTeams.forEach((t) => {
      allTeams.push({
        ...t,
        divisionName: division,
      });
    });
  });

  return {
    generatedAt,
    runId: run.id,
    totals,
    divisions,
    teams: allTeams,
    team_players: team_players || [],
  };
}
