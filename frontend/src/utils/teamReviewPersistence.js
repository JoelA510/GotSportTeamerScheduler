const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function createUuid() {
  const cryptoSource = globalThis.crypto;
  if (typeof cryptoSource?.randomUUID === 'function') {
    return cryptoSource.randomUUID();
  }

  if (typeof cryptoSource?.getRandomValues !== 'function') {
    throw new Error('Secure UUID generation is unavailable in this environment.');
  }

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function firstString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

export function getPlayerExternalId(row) {
  return firstString(row, [
    'external_registration_id',
    'gotsport_id',
    'registration_id',
    'player_registration_id',
  ]);
}

function groupTeamRows(teamRows) {
  return teamRows.reduce((acc, team) => {
    const key = team.division || team.division_id || 'Unassigned';
    acc[key] = acc[key] || [];
    acc[key].push({
      id: team.id,
      name: team.name,
      division: key,
      division_id: team.division_id,
      coachId: team.coach_id ?? null,
      players: [],
    });
    return acc;
  }, {});
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function findDivisionIdForTeam(teamRow, displayTeam, divisionRows = []) {
  const candidates = [
    teamRow.division_id,
    teamRow.division,
    teamRow.divisionName,
    displayTeam?.division_id,
    displayTeam?.division,
    displayTeam?.divisionName,
  ].filter(Boolean);

  const uuidCandidate = candidates.find(isUuid);
  if (uuidCandidate) return uuidCandidate;

  const normalizedCandidates = new Set(candidates.map(normalizeKey));
  const matchedDivision = divisionRows.find(
    (division) =>
      normalizedCandidates.has(normalizeKey(division.id)) ||
      normalizedCandidates.has(normalizeKey(division.name))
  );

  return matchedDivision?.id || null;
}

function remapTeamStatsByDivision(statsByDivision = {}, teamIdMap) {
  return Object.fromEntries(
    Object.entries(statsByDivision).map(([division, value]) => [
      division,
      {
        ...value,
        teamStats: (value?.teamStats || []).map((entry) => ({
          ...entry,
          teamId: teamIdMap[entry.teamId] || entry.teamId,
        })),
        summary: value?.summary
          ? {
              ...value.summary,
              teamsNeedingPlayers: (value.summary.teamsNeedingPlayers || []).map(
                (teamId) => teamIdMap[teamId] || teamId
              ),
              teamsBelowMinRoster: Array.isArray(value.summary.teamsBelowMinRoster)
                ? value.summary.teamsBelowMinRoster.map((teamId) => teamIdMap[teamId] || teamId)
                : value.summary.teamsBelowMinRoster,
            }
          : value?.summary,
      },
    ])
  );
}

function remapTeamsByDivision(teamsByDivision, teamIdMap, teamRowById) {
  return Object.fromEntries(
    Object.entries(teamsByDivision || {}).map(([division, teams]) => [
      division,
      (teams || []).map((team) => {
        const mappedId = teamIdMap[team.id] || team.id;
        const teamRow = teamRowById.get(mappedId);
        return {
          ...team,
          id: mappedId,
          division_id: teamRow?.division_id || team.division_id,
        };
      }),
    ])
  );
}

/**
 * @param {any} params
 */
export function buildTeamReviewSnapshot(
  {
    generatedResult,
    divisionKey,
    divisionId,
    organizationId,
    seasonSettingsId,
    userId,
    selectedProgramId,
    divisionConfig,
    nowIso = new Date().toISOString(),
    runId = createUuid(),
    idFactory = createUuid,
  } = /** @type {any} */ ({})
) {
  if (!generatedResult?.teamsByDivision || !divisionKey || !divisionId) {
    throw new Error('Generated teams and a saved division are required before review.');
  }

  const originalTeams = generatedResult.teamsByDivision[divisionKey] || [];
  const teamIdMap = {};
  const teamRows = originalTeams.map((team) => {
    const dbTeamId = isUuid(team.id) ? team.id : idFactory();
    teamIdMap[team.id] = dbTeamId;
    return {
      id: dbTeamId,
      organization_id: organizationId,
      division_id: divisionId,
      division: divisionKey,
      name: team.name,
      coach_id: isUuid(team.coachId) ? team.coachId : null,
    };
  });

  const teamPlayerRows = originalTeams.flatMap((team) => {
    const teamId = teamIdMap[team.id];
    return (team.players || []).map((player) => ({
      team_id: teamId,
      player_id: player.id,
      role: 'player',
      source: player.assignment_source === 'manual' ? 'manual' : 'auto',
      player_name: player.name || `${player.firstName || ''} ${player.lastName || ''}`.trim(),
      skill: player.skillRating ?? player.skill ?? null,
    }));
  });

  const teamsByDivision = {
    ...generatedResult.teamsByDivision,
    [divisionKey]: originalTeams.map((team) => ({
      ...team,
      id: teamIdMap[team.id],
      generatorId: team.id,
      division: team.division || divisionKey,
      division_id: divisionId,
    })),
  };

  const results = {
    ...generatedResult,
    teamsByDivision,
    rosterBalanceByDivision: remapTeamStatsByDivision(
      generatedResult.rosterBalanceByDivision,
      teamIdMap
    ),
    skillBalanceByDivision: remapTeamStatsByDivision(
      generatedResult.skillBalanceByDivision,
      teamIdMap
    ),
    teams: Object.values(teamsByDivision).flat(),
    team_players: teamPlayerRows,
  };

  const overflowPlayers = Object.values(generatedResult.overflowSummaryByDivision || {}).reduce(
    (sum, summary) => sum + (summary?.totalPlayers || 0),
    0
  );
  const metrics = {
    progress: 100,
    generatedTeams: teamRows.length,
    assignedPlayers: teamPlayerRows.length,
    overflowPlayers,
  };
  const parameters = {
    source: 'team_analysis_review',
    selectedProgramId,
    divisionConfigs: { [divisionKey]: divisionConfig },
  };
  const runMetadata = {
    runId,
    organizationId,
    seasonId: seasonSettingsId,
    seasonSettingsId,
    runType: 'team',
    status: 'completed',
    parameters,
    metrics,
    results,
    createdBy: userId,
    startedAt: nowIso,
    completedAt: nowIso,
  };

  return {
    lastRunId: runId,
    lastSyncedAt: null,
    preparedTeamRows: teamRows.length,
    preparedPlayerRows: teamPlayerRows.length,
    manualOverrides: [],
    runHistory: [
      {
        runId,
        status: 'review',
        startedAt: nowIso,
        updatedTeams: teamRows.length,
        updatedPlayers: teamPlayerRows.length,
        notes: 'Pending review',
      },
    ],
    runMetadata,
    payload: {
      teamRows,
      teamPlayerRows,
      teamIdMap,
    },
  };
}

/**
 * @param {any} params
 */
export function buildManualRosterSnapshot(
  {
    baseSnapshot,
    teams,
    organizationId,
    seasonSettingsId,
    userId,
    divisionRows = [],
    nowIso = new Date().toISOString(),
    runId = createUuid(),
    idFactory = createUuid,
  } = /** @type {any} */ ({})
) {
  const basePayload = baseSnapshot?.payload;
  const sourceTeamRows = basePayload?.teamRows || [];
  if (!Array.isArray(sourceTeamRows) || sourceTeamRows.length === 0) {
    throw new Error('No persisted team rows are available for manual roster changes.');
  }

  const displayTeamById = new Map((teams || []).map((team) => [team.id, team]));
  const teamIdMap = {};
  const teamRows = sourceTeamRows.map((teamRow) => {
    const targetId = isUuid(teamRow.id) ? teamRow.id : idFactory();
    const displayTeam = displayTeamById.get(teamRow.id);
    const divisionId = findDivisionIdForTeam(teamRow, displayTeam, divisionRows);

    if (!divisionId || !isUuid(divisionId)) {
      throw new Error('Manual roster changes require saved UUID-backed divisions.');
    }

    teamIdMap[teamRow.id] = targetId;
    return {
      ...teamRow,
      id: targetId,
      organization_id: organizationId,
      division_id: divisionId,
      coach_id: isUuid(teamRow.coach_id) ? teamRow.coach_id : null,
    };
  });

  const validTeamIds = new Set(sourceTeamRows.map((team) => team.id));
  const invalidTeam = (teams || []).find((team) => !validTeamIds.has(team.id));
  if (invalidTeam) {
    throw new Error('Manual roster changes include a team outside the persisted snapshot.');
  }

  const teamPlayerRows = (teams || []).flatMap((team) =>
    (team.players || []).map((player) => ({
      team_id: teamIdMap[team.id] || team.id,
      player_id: player.id,
      role: player.role || 'player',
      source:
        player.assignment_source === 'manual' || player.source === 'manual' ? 'manual' : 'auto',
      player_name: player.name || null,
      skill: player.skill || player.skillRating || null,
    }))
  );
  const invalidPlayer = teamPlayerRows.find((row) => !isUuid(row.player_id));
  if (invalidPlayer) {
    throw new Error('Manual roster changes require durable UUID-backed players.');
  }

  const manualAssignments = teamPlayerRows.filter((row) => row.source === 'manual').length;
  const baseResults = baseSnapshot?.runMetadata?.results || {};
  const teamRowById = new Map(teamRows.map((team) => [team.id, team]));
  const teamsByDivision = remapTeamsByDivision(
    baseResults.teamsByDivision || groupTeamRows(sourceTeamRows),
    teamIdMap,
    teamRowById
  );
  const results = {
    ...baseResults,
    teams: teamRows,
    teamsByDivision,
    team_players: teamPlayerRows,
  };
  const runMetadata = {
    ...(baseSnapshot?.runMetadata || {}),
    runId,
    organizationId,
    seasonId: seasonSettingsId,
    seasonSettingsId,
    runType: 'team',
    status: 'completed',
    parameters: {
      ...(baseSnapshot?.runMetadata?.parameters || {}),
      source: 'manual_roster_review',
      previousRunId: baseSnapshot?.lastRunId || baseSnapshot?.runMetadata?.runId || null,
    },
    metrics: {
      ...(baseSnapshot?.runMetadata?.metrics || {}),
      progress: 100,
      generatedTeams: teamRows.length,
      assignedPlayers: teamPlayerRows.length,
      manualAssignments,
    },
    results,
    createdBy: userId,
    startedAt: nowIso,
    completedAt: nowIso,
  };

  return {
    ...baseSnapshot,
    lastRunId: runId,
    lastSyncedAt: null,
    preparedTeamRows: teamRows.length,
    preparedPlayerRows: teamPlayerRows.length,
    manualOverrides: [],
    runHistory: [
      {
        runId,
        status: 'review',
        startedAt: nowIso,
        updatedTeams: teamRows.length,
        updatedPlayers: teamPlayerRows.length,
        notes: 'Manual roster edits pending sync',
      },
      ...(baseSnapshot?.runHistory || []),
    ],
    runMetadata,
    payload: {
      ...basePayload,
      teamRows,
      teamPlayerRows,
      teamIdMap: {
        ...(basePayload?.teamIdMap || {}),
        ...teamIdMap,
      },
    },
  };
}
