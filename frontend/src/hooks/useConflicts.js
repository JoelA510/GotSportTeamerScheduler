import { useMemo } from 'react';
import { getCanonicalBuddyId } from '@squadlogic/core/buddyLinking.js';

/**
 * Reactive conflict detection hook for roster assignments.
 * Scans teams and players for buddy separations, gender mismatches, and age mismatches.
 * Buddy links are read through the core canonical helper so `buddyId` and `buddy_id`
 * variants are treated identically to generation.
 *
 * @param {Array} teams - Array of team objects with { id, name, gender, minAge, maxAge, players[] }
 * @returns {{ conflicts: Array, hasConflicts: boolean }}
 */
export function useConflicts(teams) {
  const conflicts = useMemo(() => {
    if (!teams || !Array.isArray(teams) || teams.length === 0) return [];

    const detected = [];
    const checkedBuddies = new Set();

    // Flatten all players with their team assignments safely
    const allPlayers = [];
    teams.forEach((team) => {
      if (!team) return;
      (team.players || []).forEach((player) => {
        if (!player) return;
        const name =
          player.name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown';
        allPlayers.push({ ...player, name, teamId: team.id, teamName: team.name });
      });
    });

    const playersById = new Map(allPlayers.map((p) => [String(p.id), p]));

    allPlayers.forEach((p1) => {
      // --- Buddy Separation Check ---
      const p1BuddyId = getCanonicalBuddyId(p1);
      if (p1BuddyId && !checkedBuddies.has(p1.id)) {
        const p2 = playersById.get(p1BuddyId);
        if (p2 && getCanonicalBuddyId(p2) === String(p1.id)) {
          checkedBuddies.add(p1.id);
          checkedBuddies.add(p2.id);

          // Check if buddy pair shares eligible teams
          const p1Eligible = teams.filter(
            (t) =>
              t &&
              (!t.minAge || p1.age >= t.minAge) &&
              (!t.maxAge || p1.age <= t.maxAge) &&
              (!t.gender || p1.gender === t.gender)
          );

          const p2Eligible = teams.filter(
            (t) =>
              t &&
              (!t.minAge || p2.age >= t.minAge) &&
              (!t.maxAge || p2.age <= t.maxAge) &&
              (!t.gender || p2.gender === t.gender)
          );

          const sharedTeams = p1Eligible.filter((t1) => p2Eligible.some((t2) => t1.id === t2.id));

          if (p1.teamId !== p2.teamId && sharedTeams.length > 0) {
            detected.push({
              type: 'buddy',
              message: `Buddy pair separated: ${p1.name} & ${p2.name}`,
              severity: 'warning',
              p1,
              p2,
            });
          } else if (sharedTeams.length === 0 && (p1.teamId || p2.teamId)) {
            // They cannot be on any shared team (age/gender mismatch)
            detected.push({
              type: 'invalid_buddy',
              message: `Invalid buddy request (Age/Gender mismatch): ${p1.name} & ${p2.name}`,
              severity: 'error',
              p1,
              p2,
            });
          }
        }
      }

      // --- Gender Mismatch Check ---
      if (p1.teamId && p1.gender) {
        const team = teams.find((t) => t && t.id === p1.teamId);
        if (team && team.gender && p1.gender !== team.gender) {
          detected.push({
            type: 'gender',
            message: `Gender mismatch: ${p1.name} (${p1.gender}) assigned to ${team.name} (${team.gender})`,
            severity: 'error',
            p1,
          });
        }
      }

      // --- Age Mismatch Check ---
      // Play-up is allowed only when sanctioned (a coaching parent or a
      // qualifying buddy); play-down is never allowed. A sanctioned play-up is
      // therefore not a conflict.
      if (p1.teamId && p1.age != null) {
        const team = teams.find((t) => t && t.id === p1.teamId);
        if (team) {
          const sanctionedPlayUp =
            p1.playUpSanctioned === true || p1.placement === 'play_up_sanctioned';
          const playingDown = team.maxAge != null && p1.age > team.maxAge;
          const playingUp = team.minAge != null && p1.age < team.minAge;

          if (playingDown) {
            detected.push({
              type: 'age',
              message: `Play-down not allowed: ${p1.name} (Age ${p1.age}) assigned to ${team.name} (U${team.maxAge})`,
              severity: 'error',
              p1,
            });
          } else if (playingUp && !sanctionedPlayUp) {
            detected.push({
              type: 'age',
              message: `Unsanctioned play-up: ${p1.name} (Age ${p1.age}) assigned to ${team.name} (min U${team.minAge}) without a coaching parent or qualifying buddy`,
              severity: 'error',
              p1,
            });
          }
        }
      }
    });

    return detected;
  }, [teams]);

  return {
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}
