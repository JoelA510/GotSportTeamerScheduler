/**
 * Balance signals for the Team Builder board.
 *
 * The balancing signal of a player depends on the org feature config:
 *   - player_rating on  → the 1–5 rating
 *   - years_played on   → yearsPlayed + 1 (so rookies still weigh something)
 *   - neither           → 1 (balance by roster size only)
 *
 * Pure module — no React, no I/O.
 */

/** @returns {'rating'|'years'|'size'} */
export function balanceSignalKind(features = {}) {
  if (features.player_rating) return 'rating';
  if (features.years_played) return 'years';
  return 'size';
}

/** Numeric balancing weight for one player under the given signal kind. */
export function playerSignal(player, kind) {
  if (kind === 'rating') return Number(player?.rating) || 1;
  if (kind === 'years') return (Number(player?.years_played) || 0) + 1;
  return 1;
}

/** Live per-team metrics for a column of players. */
export function teamBalanceMetrics(players = []) {
  const size = players.length;
  const sum = (selector) => players.reduce((total, p) => total + (Number(selector(p)) || 0), 0);
  return {
    size,
    boys: players.filter((p) => p?.gender === 'm').length,
    girls: players.filter((p) => p?.gender === 'f').length,
    avgRating: size ? sum((p) => p.rating) / size : 0,
    avgYears: size ? sum((p) => p.years_played) / size : 0,
  };
}

function nameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Buddy satisfaction across a division: a request counts when the named
 * buddy exists in the same player set; it is satisfied when both share a
 * team. Returns { requested, satisfied }.
 */
export function buddyStats(players = []) {
  const byName = new Map();
  players.forEach((player) => {
    byName.set(nameKey(`${player.first_name} ${player.last_name}`), player);
    if (player.preferred_name) {
      byName.set(nameKey(`${player.preferred_name} ${player.last_name}`), player);
    }
  });
  let requested = 0;
  let satisfied = 0;
  players.forEach((player) => {
    const buddy = byName.get(nameKey(player.buddy_request));
    if (!buddy || buddy.id === player.id) return;
    requested += 1;
    if (player.team_id && player.team_id === buddy.team_id) satisfied += 1;
  });
  return { requested, satisfied };
}

/**
 * Serpentine auto-balance of `players` across `teams` (existing team rows).
 *
 * Players are grouped into units (mutual/buddy pairs when
 * `respectBuddies`), sorted by descending unit signal, then dealt
 * serpentine-style to the team with the lowest running signal total.
 * With `respectCoach`, units containing a coach-volunteering guardian are
 * spread first, one per team where possible.
 *
 * Returns assignments only — `[{ playerId, teamId }]` — the caller
 * persists them through the audited RPCs.
 */
export function serpentineAssign({
  players = [],
  teams = [],
  signalKind = 'size',
  respectBuddies = true,
  respectCoach = true,
}) {
  if (teams.length === 0) return [];

  // ---- build units (buddy pairs stay together) ----
  // Index the same aliases buddyStats uses, so a request written against a
  // preferred name still forms a unit.
  const byName = new Map();
  players.forEach((player) => {
    byName.set(nameKey(`${player.first_name} ${player.last_name}`), player);
    if (player.preferred_name) {
      byName.set(nameKey(`${player.preferred_name} ${player.last_name}`), player);
    }
  });
  const unitOf = new Map();
  const units = [];
  const addUnit = (members) => {
    const unit = {
      members,
      signal: members.reduce((total, m) => total + playerSignal(m, signalKind), 0),
      hasCoach: members.some((m) => m.willing_to_coach),
    };
    members.forEach((m) => unitOf.set(m.id, unit));
    units.push(unit);
  };

  players.forEach((player) => {
    if (unitOf.has(player.id)) return;
    if (respectBuddies) {
      const buddy = byName.get(nameKey(player.buddy_request));
      if (buddy && buddy.id !== player.id && !unitOf.has(buddy.id)) {
        addUnit([player, buddy]);
        return;
      }
    }
    addUnit([player]);
  });

  // ---- deal units to teams ----
  const buckets = teams.map((team) => ({
    teamId: team.id,
    total: 0,
    count: 0,
    coachUnits: 0,
  }));

  const pick = (unit) => {
    let candidates = buckets;
    if (respectCoach && unit.hasCoach) {
      const minCoach = Math.min(...buckets.map((b) => b.coachUnits));
      candidates = buckets.filter((b) => b.coachUnits === minCoach);
    }
    // lowest signal total, then smallest roster, then stable order
    return candidates.reduce((best, bucket) => {
      if (!best) return bucket;
      if (bucket.total !== best.total) return bucket.total < best.total ? bucket : best;
      if (bucket.count !== best.count) return bucket.count < best.count ? bucket : best;
      return best;
    }, null);
  };

  const sorted = [...units].sort(
    (a, b) => (b.hasCoach ? 1 : 0) - (a.hasCoach ? 1 : 0) || b.signal - a.signal
  );

  const assignments = [];
  sorted.forEach((unit) => {
    const bucket = pick(unit);
    bucket.total += unit.signal;
    bucket.count += unit.members.length;
    if (unit.hasCoach) bucket.coachUnits += 1;
    unit.members.forEach((member) => {
      assignments.push({ playerId: member.id, teamId: bucket.teamId });
    });
  });

  return assignments;
}
