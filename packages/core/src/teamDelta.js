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
 *   players?: Array<{ id: string, division?: string, coachId?: string, coach_id?: string, assistantCoachId?: string, assistant_coach_id?: string }>,
 *   existingSnapshot?: any,
 *   generationMode?: string,
 *   changePolicy?: { lockManualAssignments?: boolean, divisionKeyById?: Record<string, string> },
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
  const policy = changePolicy ?? {};
  const normalized = normalizeExistingSnapshot(existingSnapshot, {
    status: generationMode,
    // Maps persisted division_id (UUID) → generator division key for relational snapshots.
    divisionKeyById: policy.divisionKeyById,
  });
  const index = indexTeamSnapshot(normalized);
  const mode = SNAPSHOT_STATUSES.includes(String(generationMode))
    ? String(generationMode)
    : normalized.status;
  const lockManualAssignments =
    typeof policy.lockManualAssignments === 'boolean'
      ? policy.lockManualAssignments
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

  // A coach/assistant is "active" if any incoming player still references them. Coaches are carried
  // on player records as coachId/assistantCoachId (and a coach may also be a player), so the active
  // set is built from player ids AND those coach fields — not player ids alone.
  const activeCoachIds = new Set();
  for (const player of incoming) {
    for (const value of [
      player?.id,
      player?.coachId,
      player?.coach_id,
      player?.assistantCoachId,
      player?.assistant_coach_id,
    ]) {
      const coachId = toIdString(value);
      if (coachId) activeCoachIds.add(coachId);
    }
  }

  /** @type {string[]} */
  const activeLockedPlayerIds = [];
  /** @type {Record<string, string[]>} */
  const droppedPlayersByDivision = {};
  /** @type {Array<{ playerId: string, fromDivision: string, toDivision: string }>} */
  const changedDivisionPlayers = [];

  // Preserve team shells; reduce each roster to players still in the incoming data
  // (rule 1 preserve metadata, rule 3 drop, rule 5 keep empty shells, rule 6 keep divisions).
  // A player duplicated across snapshot teams (already diagnosed by the normalizer) is classified
  // only on the FIRST team encountered — matching indexTeamSnapshot's first-write-wins lookup —
  // so they cannot be preserved twice or double-counted as dropped/moved.
  const processedSnapshotPlayerIds = new Set();
  /** @type {Record<string, any[]>} */
  const preservedTeamsByDivision = {};
  for (const [division, teams] of Object.entries(normalized.teamsByDivision)) {
    preservedTeamsByDivision[division] = teams.map((team) => {
      const activePlayers = [];
      for (const player of team.players) {
        if (processedSnapshotPlayerIds.has(player.id)) {
          continue;
        }
        processedSnapshotPlayerIds.add(player.id);
        const incomingPlayer = incomingById.get(player.id);
        if (!incomingPlayer) {
          addToBucket(droppedPlayersByDivision, division, player.id);
          continue;
        }
        const incomingDivision = toIdString(incomingPlayer.division) ?? division;
        if (incomingDivision !== division) {
          // The player moved divisions: drop them from the old team's active roster and let the
          // late/unassigned pass surface them in their new division.
          changedDivisionPlayers.push({
            playerId: player.id,
            fromDivision: division,
            toDivision: incomingDivision,
          });
          continue;
        }
        const locked =
          player.locked || (lockManualAssignments && player.assignment_source === 'manual');
        if (locked) activeLockedPlayerIds.push(player.id);
        activePlayers.push({ ...player, locked });
      }
      return { ...team, players: activePlayers };
    });
  }

  // Late / unassigned players: registered in a division where the snapshot does not already
  // place them — new arrivals (rule 2) and players who changed divisions.
  /** @type {Record<string, string[]>} */
  const unassignedPlayersByDivision = {};
  for (const [id, player] of incomingById) {
    const snapshotPlayer = index.playersById[id];
    const division = toIdString(player.division) ?? 'unknown';
    if (snapshotPlayer && snapshotPlayer.division === division) continue;
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
      const coachDropped = team.coachId != null && !activeCoachIds.has(team.coachId);
      const droppedAssistantCoachIds = team.assistantCoachIds.filter(
        (id) => !activeCoachIds.has(id)
      );
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
