/**
 * Pure helpers for representing an existing team snapshot in ONE canonical shape, and indexing
 * it for fast lookup. Introduced in project-hardening PR 02 as the foundation for snapshot-aware
 * incremental teaming. These helpers do NOT change allocation — they are consumed by delta
 * reconciliation (`teamDelta.js`) and, in later PRs, by snapshot-aware generation.
 *
 * `normalizeExistingSnapshot` tolerates the shapes that can actually carry an existing roster:
 *   - the generation / design shape `{ teamsByDivision: { [division]: Team[] } }`
 *   - the persistence / review shape `{ payload: { teamRows, teamPlayerRows } }` (snake_case,
 *     relational — assistants are separate `role: 'assistant_coach'` rows)
 *   - `null` / `undefined` (treated as an empty snapshot)
 * and always returns the same normalized object. Invalid rows produce diagnostics, not throws.
 *
 * See docs/architecture/incremental-teaming-hardening.md (§6).
 *
 * @typedef {'draft' | 'review' | 'published' | 'locked'} SnapshotStatus
 *
 * @typedef {Object} NormalizedSnapshotPlayer
 * @property {string} id
 * @property {'auto' | 'manual'} assignment_source
 * @property {boolean} locked
 *
 * @typedef {Object} NormalizedTeam
 * @property {string} id
 * @property {string} [generatorId]
 * @property {string} [name]
 * @property {string} division
 * @property {string | null} coachId
 * @property {string[]} assistantCoachIds
 * @property {boolean} locked
 * @property {NormalizedSnapshotPlayer[]} players
 *
 * @typedef {Object} SnapshotDiagnostic
 * @property {string} code
 * @property {'info' | 'warning'} severity
 * @property {string} message
 *
 * @typedef {Object} OrphanedSnapshotPlayer
 * @property {string} playerId
 * @property {string | null} teamId
 *
 * @typedef {Object} NormalizedSnapshot
 * @property {SnapshotStatus} status
 * @property {string | null} runId
 * @property {Record<string, NormalizedTeam[]>} teamsByDivision
 * @property {OrphanedSnapshotPlayer[]} orphanedPlayers
 * @property {SnapshotDiagnostic[]} diagnostics
 */

/** Allowed normalized snapshot statuses (lifecycle order). */
export const SNAPSHOT_STATUSES = ['draft', 'review', 'published', 'locked'];

/** Relational team-player roles that map to assistant coaches vs. the head coach. */
const ASSISTANT_COACH_ROLES = new Set(['assistant_coach', 'assistant coach', 'assistant']);
const HEAD_COACH_ROLES = new Set(['coach', 'head_coach', 'head coach']);

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Coerce an id-like value to a trimmed non-empty string, or undefined. */
function coerceId(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str === '' ? undefined : str;
}

function dedupeIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const id = coerceId(value);
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * @param {unknown} rawStatus
 * @param {SnapshotStatus} fallback
 * @param {SnapshotDiagnostic[]} [diagnostics]
 * @returns {SnapshotStatus}
 */
function normalizeStatus(rawStatus, fallback, diagnostics) {
  if (typeof rawStatus === 'string') {
    const lower = rawStatus.toLowerCase();
    if (SNAPSHOT_STATUSES.includes(lower)) {
      return /** @type {SnapshotStatus} */ (lower);
    }
    if (diagnostics) {
      diagnostics.push({
        code: 'unknown-status',
        severity: 'info',
        message: `unknown snapshot status "${rawStatus}"; defaulting to "${fallback}"`,
      });
    }
  }
  return fallback;
}

function normalizeAssistantCoachIds(rawTeam) {
  const source = firstDefined(rawTeam.assistantCoachIds, rawTeam.assistant_coach_ids);
  return Array.isArray(source) ? dedupeIds(source) : [];
}

/**
 * @param {any} rawPlayer
 * @param {{ teamId: string, diagnostics: SnapshotDiagnostic[] }} context
 * @returns {NormalizedSnapshotPlayer | null}
 */
function normalizeSnapshotPlayer(rawPlayer, context) {
  const id = coerceId(firstDefined(rawPlayer?.id, rawPlayer?.player_id));
  if (!id) {
    context.diagnostics.push({
      code: 'invalid-player-row',
      severity: 'warning',
      message: `team ${context.teamId} has a player row without an id`,
    });
    return null;
  }
  const rawSource = firstDefined(rawPlayer.assignment_source, rawPlayer.source);
  return {
    id,
    assignment_source: rawSource === 'manual' ? 'manual' : 'auto',
    locked: Boolean(rawPlayer.locked),
  };
}

/** Reduce a raw player list to normalized players, deduping within the team. */
function normalizeTeamPlayers(rawPlayers, teamId, diagnostics) {
  const players = [];
  const seen = new Set();
  for (const rawPlayer of Array.isArray(rawPlayers) ? rawPlayers : []) {
    const player = normalizeSnapshotPlayer(rawPlayer, { teamId, diagnostics });
    if (!player) continue;
    if (seen.has(player.id)) {
      diagnostics.push({
        code: 'duplicate-player-in-team',
        severity: 'warning',
        message: `player ${player.id} appears more than once on team ${teamId}`,
      });
      continue;
    }
    seen.add(player.id);
    players.push(player);
  }
  return players;
}

function buildNormalizedTeam({
  id,
  generatorId,
  name,
  division,
  coachId,
  assistantCoachIds,
  locked,
  players,
}) {
  return {
    id,
    ...(generatorId ? { generatorId } : {}),
    ...(name != null ? { name: String(name) } : {}),
    division,
    coachId: coachId ?? null,
    assistantCoachIds,
    locked: Boolean(locked),
    players,
  };
}

/**
 * Normalize the generation / design `teamsByDivision` shape. Players under a team that is itself
 * invalid (missing id) are surfaced as orphans rather than silently dropped.
 */
function normalizeFromTeamsByDivision(teamsByDivision, diagnostics, orphanedPlayers) {
  /** @type {Record<string, NormalizedTeam[]>} */
  const result = {};
  for (const [divisionKey, rawTeams] of Object.entries(teamsByDivision)) {
    if (!Array.isArray(rawTeams)) {
      diagnostics.push({
        code: 'invalid-division-entry',
        severity: 'warning',
        message: `teamsByDivision["${divisionKey}"] is not an array; skipped`,
      });
      continue;
    }
    const teams = [];
    for (const rawTeam of rawTeams) {
      const id = coerceId(firstDefined(rawTeam?.id, rawTeam?.team_id));
      if (!id) {
        diagnostics.push({
          code: 'invalid-team-row',
          severity: 'warning',
          message: `division "${divisionKey}" has a team without an id; skipped`,
        });
        for (const rawPlayer of Array.isArray(rawTeam?.players) ? rawTeam.players : []) {
          const playerId = coerceId(firstDefined(rawPlayer?.id, rawPlayer?.player_id));
          if (playerId) orphanedPlayers.push({ playerId, teamId: null });
        }
        continue;
      }
      const statedDivision = firstDefined(rawTeam.division, rawTeam.division_id);
      if (statedDivision != null && String(statedDivision) !== String(divisionKey)) {
        diagnostics.push({
          code: 'team-division-mismatch',
          severity: 'warning',
          message: `team ${id} is listed under division "${divisionKey}" but declares division "${statedDivision}"`,
        });
      }
      teams.push(
        buildNormalizedTeam({
          id,
          generatorId: coerceId(firstDefined(rawTeam.generatorId, rawTeam.generator_id)),
          name: rawTeam.name,
          division: String(divisionKey),
          coachId: coerceId(firstDefined(rawTeam.coachId, rawTeam.coach_id)),
          assistantCoachIds: normalizeAssistantCoachIds(rawTeam),
          locked: rawTeam.locked,
          players: normalizeTeamPlayers(rawTeam.players, id, diagnostics),
        })
      );
    }
    // Preserve the division key even when it has no valid teams (rule 6).
    result[divisionKey] = teams;
  }
  return result;
}

/**
 * Normalize the persistence / review relational shape (teamRows + teamPlayerRows). Assistant
 * rows (`role: 'assistant_coach'`) become `assistantCoachIds`; player rows with an unresolved
 * `team_id` are surfaced as orphans.
 */
function normalizeFromRelationalRows(teamRows, teamPlayerRows, diagnostics, orphanedPlayers) {
  /** @type {Map<string, NormalizedSnapshotPlayer[]>} */
  const playersByTeam = new Map();
  /** @type {Map<string, string[]>} */
  const assistantsByTeam = new Map();
  /** @type {Array<{ playerId: string, teamId: string }>} */
  const playerRowTeamRefs = [];

  for (const row of Array.isArray(teamPlayerRows) ? teamPlayerRows : []) {
    const teamId = coerceId(row?.team_id);
    const playerId = coerceId(firstDefined(row?.player_id, row?.id));
    if (!teamId || !playerId) {
      diagnostics.push({
        code: 'invalid-player-row',
        severity: 'warning',
        message: 'team-player row is missing team_id or player_id; skipped',
      });
      continue;
    }
    const role = typeof row.role === 'string' ? row.role.toLowerCase() : 'player';
    if (ASSISTANT_COACH_ROLES.has(role)) {
      if (!assistantsByTeam.has(teamId)) assistantsByTeam.set(teamId, []);
      assistantsByTeam.get(teamId).push(playerId);
    } else if (HEAD_COACH_ROLES.has(role)) {
      // The head coach is carried on the team row's coach_id, not the active roster.
      continue;
    } else {
      if (!playersByTeam.has(teamId)) playersByTeam.set(teamId, []);
      playersByTeam.get(teamId).push({
        id: playerId,
        assignment_source:
          firstDefined(row.assignment_source, row.source) === 'manual' ? 'manual' : 'auto',
        locked: Boolean(row.locked),
      });
      playerRowTeamRefs.push({ playerId, teamId });
    }
  }

  /** @type {Record<string, NormalizedTeam[]>} */
  const result = {};
  const knownTeamIds = new Set();
  for (const teamRow of Array.isArray(teamRows) ? teamRows : []) {
    const id = coerceId(teamRow?.id);
    if (!id) {
      diagnostics.push({
        code: 'invalid-team-row',
        severity: 'warning',
        message: 'team row is missing an id; skipped',
      });
      continue;
    }
    knownTeamIds.add(id);
    const division = String(firstDefined(teamRow.division, teamRow.division_id, 'unknown'));
    const rawPlayers = playersByTeam.get(id) ?? [];
    const seen = new Set();
    const players = [];
    for (const player of rawPlayers) {
      if (seen.has(player.id)) {
        diagnostics.push({
          code: 'duplicate-player-in-team',
          severity: 'warning',
          message: `player ${player.id} appears more than once on team ${id}`,
        });
        continue;
      }
      seen.add(player.id);
      players.push(player);
    }
    const team = buildNormalizedTeam({
      id,
      generatorId: undefined,
      name: teamRow.name,
      division,
      coachId: coerceId(teamRow.coach_id),
      assistantCoachIds: dedupeIds(assistantsByTeam.get(id) ?? []),
      locked: teamRow.locked,
      players,
    });
    if (!result[division]) result[division] = [];
    result[division].push(team);
  }

  for (const ref of playerRowTeamRefs) {
    if (!knownTeamIds.has(ref.teamId)) {
      diagnostics.push({
        code: 'orphaned-player-row',
        severity: 'warning',
        message: `player ${ref.playerId} references team ${ref.teamId} which has no team row`,
      });
      orphanedPlayers.push({ playerId: ref.playerId, teamId: ref.teamId });
    }
  }
  return result;
}

/** Flag any player id that appears on more than one team across the whole snapshot. */
function detectCrossTeamDuplicates(teamsByDivision, diagnostics) {
  const teamByPlayer = new Map();
  for (const teams of Object.values(teamsByDivision)) {
    for (const team of teams) {
      for (const player of team.players) {
        const existing = teamByPlayer.get(player.id);
        if (existing && existing !== team.id) {
          diagnostics.push({
            code: 'duplicate-player-id',
            severity: 'warning',
            message: `player ${player.id} is assigned to multiple teams (${existing} and ${team.id})`,
          });
        } else {
          teamByPlayer.set(player.id, team.id);
        }
      }
    }
  }
}

/**
 * Normalize any supported existing-snapshot shape into one canonical {@link NormalizedSnapshot}.
 * Never throws on malformed rows — it records diagnostics instead (rule 7).
 *
 * @param {any} existingSnapshot
 * @param {{ status?: string, runId?: string }} [options]
 * @returns {NormalizedSnapshot}
 */
export function normalizeExistingSnapshot(existingSnapshot, options = {}) {
  /** @type {SnapshotDiagnostic[]} */
  const diagnostics = [];
  /** @type {OrphanedSnapshotPlayer[]} */
  const orphanedPlayers = [];
  const fallbackStatus = normalizeStatus(options.status, 'draft');

  if (existingSnapshot == null) {
    return {
      status: fallbackStatus,
      runId: coerceId(options.runId) ?? null,
      teamsByDivision: {},
      orphanedPlayers,
      diagnostics,
    };
  }
  if (typeof existingSnapshot !== 'object') {
    diagnostics.push({
      code: 'invalid-snapshot',
      severity: 'warning',
      message: 'existingSnapshot must be an object; treated as empty',
    });
    return {
      status: fallbackStatus,
      runId: coerceId(options.runId) ?? null,
      teamsByDivision: {},
      orphanedPlayers,
      diagnostics,
    };
  }

  // Only the snapshot's OWN status can raise an 'unknown-status' diagnostic; the options.status
  // fallback (e.g. the caller's generationMode) is applied silently.
  const ownRawStatus = firstDefined(
    existingSnapshot.status,
    existingSnapshot.runHistory?.[0]?.status
  );
  const optionStatus = normalizeStatus(options.status, 'draft');
  const status =
    ownRawStatus !== undefined
      ? normalizeStatus(ownRawStatus, optionStatus, diagnostics)
      : optionStatus;
  const runId =
    coerceId(firstDefined(existingSnapshot.runId, existingSnapshot.lastRunId, options.runId)) ??
    null;

  const rawTeamsByDivision = existingSnapshot.teamsByDivision;
  const hasTeamsByDivision = rawTeamsByDivision != null && typeof rawTeamsByDivision === 'object';
  const payload =
    existingSnapshot.payload && typeof existingSnapshot.payload === 'object'
      ? existingSnapshot.payload
      : existingSnapshot;

  /** @type {Record<string, NormalizedTeam[]>} */
  let teamsByDivision;
  if (hasTeamsByDivision && Object.keys(rawTeamsByDivision).length > 0) {
    teamsByDivision = normalizeFromTeamsByDivision(
      rawTeamsByDivision,
      diagnostics,
      orphanedPlayers
    );
  } else if (Array.isArray(payload.teamRows)) {
    teamsByDivision = normalizeFromRelationalRows(
      payload.teamRows,
      payload.teamPlayerRows,
      diagnostics,
      orphanedPlayers
    );
  } else if (hasTeamsByDivision) {
    // An explicitly empty teamsByDivision is a valid (empty) snapshot, not an error.
    teamsByDivision = {};
  } else {
    diagnostics.push({
      code: 'unrecognized-snapshot-shape',
      severity: 'warning',
      message: 'snapshot has neither teamsByDivision nor payload.teamRows; treated as empty',
    });
    teamsByDivision = {};
  }

  detectCrossTeamDuplicates(teamsByDivision, diagnostics);

  return { status, runId, teamsByDivision, orphanedPlayers, diagnostics };
}

/**
 * Build id lookups over a normalized snapshot.
 *
 * @param {NormalizedSnapshot | null | undefined} normalizedSnapshot
 * @returns {{
 *   teamsById: Record<string, NormalizedTeam>,
 *   playersById: Record<string, { teamId: string, division: string, assignment_source: 'auto' | 'manual', locked: boolean }>,
 *   teamIdByPlayerId: Record<string, string>,
 *   divisions: string[],
 * }}
 */
export function indexTeamSnapshot(normalizedSnapshot) {
  /** @type {Record<string, NormalizedTeam>} */
  const teamsById = {};
  /** @type {Record<string, { teamId: string, division: string, assignment_source: 'auto' | 'manual', locked: boolean }>} */
  const playersById = {};
  /** @type {Record<string, string>} */
  const teamIdByPlayerId = {};
  const divisions = [];

  const teamsByDivision = normalizedSnapshot?.teamsByDivision ?? {};
  for (const [division, teams] of Object.entries(teamsByDivision)) {
    divisions.push(division);
    for (const team of teams) {
      teamsById[team.id] = team;
      for (const player of team.players) {
        // First-write-wins: a player duplicated across teams (already flagged by
        // detectCrossTeamDuplicates) resolves deterministically to the first team.
        if (player.id in teamIdByPlayerId) continue;
        playersById[player.id] = {
          teamId: team.id,
          division: team.division,
          assignment_source: player.assignment_source,
          locked: player.locked,
        };
        teamIdByPlayerId[player.id] = team.id;
      }
    }
  }

  return { teamsById, playersById, teamIdByPlayerId, divisions };
}
