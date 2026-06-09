/**
 * Pure delta reconciliation between current registrations and an existing team snapshot.
 * Introduced in project-hardening PR 02. It classifies every player (preserved / late / dropped /
 * moved-division / orphaned) and detects dropped coaches — WITHOUT changing allocation, buddy, or
 * coach-continuity behavior (those land in later PRs). Inputs are never mutated.
 *
 * See docs/architecture/incremental-teaming-hardening.md (§5–§6).
 */

import { indexTeamSnapshot, normalizeExistingSnapshot, SNAPSHOT_STATUSES } from './teamSnapshot.js';

/** Modes in which manual roster assignments are treated as locked (rule 4). */
const LOCKING_MODES = ['review', 'published', 'locked'];

function toIdString(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str === '' ? undefined : str;
}

function addToBucket(bucket, key, value) {
  if (!bucket[key]) bucket[key] = [];
  bucket[key].push(value);
}

/**
 * @param {{
 *   players?: Array<{ id: string, division?: string }>,
 *   existingSnapshot?: any,
 *   generationMode?: string,
 *   changePolicy?: { lockManualAssignments?: boolean },
 *   divisionConfigs?: Record<string, any>,
 * }} [args]
 * @returns {{
 *   preservedTeamsByDivision: Record<string, any[]>,
 *   activeLockedPlayerIds: string[],
 *   unassignedPlayersByDivision: Record<string, string[]>,
 *   droppedPlayersByDivision: Record<string, string[]>,
 *   changedDivisionPlayers: Array<{ playerId: string, fromDivision: string, toDivision: string }>,
 *   orphanedSnapshotPlayers: Array<{ playerId: string, teamId: string | null }>,
 *   coachDeltas: Array<{ teamId: string, division: string, coachId: string | null, coachDropped: boolean, droppedAssistantCoachIds: string[] }>,
 *   diagnostics: Array<{ code: string, severity: string, message: string }>,
 * }}
 */
export function reconcileTeamDeltas({
  players,
  existingSnapshot,
  generationMode,
  changePolicy = {},
  divisionConfigs = {},
} = {}) {
  const incoming = Array.isArray(players) ? players : [];
  const normalized = normalizeExistingSnapshot(existingSnapshot, { status: generationMode });
  const index = indexTeamSnapshot(normalized);
  const mode = SNAPSHOT_STATUSES.includes(String(generationMode))
    ? String(generationMode)
    : normalized.status;
  const lockManualAssignments =
    typeof changePolicy.lockManualAssignments === 'boolean'
      ? changePolicy.lockManualAssignments
      : LOCKING_MODES.includes(mode);
  const knownDivisions = new Set(Object.keys(divisionConfigs ?? {}));
  const diagnostics = [...normalized.diagnostics];

  // Index the incoming registrations by id.
  const incomingById = new Map();
  for (const player of incoming) {
    const id = toIdString(player?.id);
    if (!id) {
      diagnostics.push({
        code: 'invalid-incoming-player',
        severity: 'warning',
        message: 'an incoming player without an id was ignored',
      });
      continue;
    }
    incomingById.set(id, player);
  }

  /** @type {string[]} */
  const activeLockedPlayerIds = [];
  /** @type {Record<string, string[]>} */
  const droppedPlayersByDivision = {};
  /** @type {Array<{ playerId: string, fromDivision: string, toDivision: string }>} */
  const changedDivisionPlayers = [];

  // Preserve team shells; reduce each roster to players still in the incoming data
  // (rule 1 preserve metadata, rule 3 drop, rule 5 keep empty shells, rule 6 keep divisions).
  /** @type {Record<string, any[]>} */
  const preservedTeamsByDivision = {};
  for (const [division, teams] of Object.entries(normalized.teamsByDivision)) {
    preservedTeamsByDivision[division] = teams.map((team) => {
      const activePlayers = [];
      for (const player of team.players) {
        const incomingPlayer = incomingById.get(player.id);
        if (!incomingPlayer) {
          addToBucket(droppedPlayersByDivision, division, player.id);
          continue;
        }
        const incomingDivision = toIdString(incomingPlayer.division) ?? division;
        if (incomingDivision !== division) {
          changedDivisionPlayers.push({
            playerId: player.id,
            fromDivision: division,
            toDivision: incomingDivision,
          });
        }
        const locked =
          player.locked || (lockManualAssignments && player.assignment_source === 'manual');
        if (locked) activeLockedPlayerIds.push(player.id);
        activePlayers.push({ ...player, locked });
      }
      return { ...team, players: activePlayers };
    });
  }

  // Late / unassigned players: present now, absent from the snapshot (rule 2).
  /** @type {Record<string, string[]>} */
  const unassignedPlayersByDivision = {};
  for (const [id, player] of incomingById) {
    if (index.teamIdByPlayerId[id]) continue;
    const division = toIdString(player.division) ?? 'unknown';
    addToBucket(unassignedPlayersByDivision, division, id);
    if (knownDivisions.size > 0 && !knownDivisions.has(division)) {
      diagnostics.push({
        code: 'unknown-division',
        severity: 'info',
        message: `late player ${id} belongs to division "${division}" which is not in divisionConfigs`,
      });
    }
  }

  // Dropped coaches / assistants — classification only; continuity & backfill are PR 06.
  /** @type {Array<{ teamId: string, division: string, coachId: string | null, coachDropped: boolean, droppedAssistantCoachIds: string[] }>} */
  const coachDeltas = [];
  for (const [division, teams] of Object.entries(normalized.teamsByDivision)) {
    for (const team of teams) {
      const coachDropped = team.coachId != null && !incomingById.has(team.coachId);
      const droppedAssistantCoachIds = team.assistantCoachIds.filter((id) => !incomingById.has(id));
      if (coachDropped || droppedAssistantCoachIds.length > 0) {
        coachDeltas.push({
          teamId: team.id,
          division,
          coachId: team.coachId,
          coachDropped,
          droppedAssistantCoachIds,
        });
      }
    }
  }

  const orphanedSnapshotPlayers = normalized.orphanedPlayers.map((orphan) => ({
    playerId: orphan.playerId,
    teamId: orphan.teamId,
  }));

  return {
    preservedTeamsByDivision,
    activeLockedPlayerIds,
    unassignedPlayersByDivision,
    droppedPlayersByDivision,
    changedDivisionPlayers,
    orphanedSnapshotPlayers,
    coachDeltas,
    diagnostics,
  };
}
