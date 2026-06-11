/**
 * Co-ed merge / gender split planning.
 *
 * Stored truth stays per-division rows; these planners compute, per age
 * group, which divisions fold together (merge) or fan out (split), the
 * division rows to upsert, where each player moves, and a team-count plan
 * proportional to headcount (each gender ≥ 1 team on split). The caller
 * applies the plan through the audited RPCs and then re-runs teaming
 * (snapshot-aware generateTeams) or the board's serpentine balance.
 *
 * Pure module — no React, no I/O.
 */

const COMPACT_RE = /^(u\d+)\s*([bg])$/i;
const SUFFIX_RE = /\s*(girls?|boys?|coed|co-ed)\s*$/i;

function baseAge(name) {
  const match = /u\s*(\d+)/i.exec(name || '');
  return match ? Number(match[1]) : null;
}

function genderOf(name) {
  const trimmed = String(name || '').trim();
  const compact = COMPACT_RE.exec(trimmed);
  if (compact) return compact[2].toUpperCase() === 'B' ? 'boys' : 'girls';
  if (/girls?$/i.test(trimmed)) return 'girls';
  if (/boys?$/i.test(trimmed)) return 'boys';
  return 'coed';
}

function baseName(name) {
  const trimmed = String(name || '').trim();
  const compact = COMPACT_RE.exec(trimmed);
  if (compact) return compact[1].toUpperCase();
  const stripped = trimmed.replace(SUFFIX_RE, '');
  return stripped || trimmed;
}

/**
 * Plan a co-ed merge: every age group with gendered divisions folds into
 * one co-ed division (named "U{n}").
 *
 * @param {Object} params
 * @param {Array<{id: string, name: string, gender_policy?: string}>} params.divisions
 * @param {Array<{id: string, division_id?: string, team_id?: string}>} params.players
 * @param {Array<{id: string, division_id?: string}>} [params.teams]
 * @returns {{ merges: Array<{
 *   age: number,
 *   divisionUpsert: { name: string, gender_policy: 'coed' },
 *   sourceDivisionIds: string[],
 *   playerIds: string[],
 *   teamCount: number,
 * }> }}
 */
export function planCoedMerge({ divisions = [], players = [], teams = [] }) {
  const byAge = new Map();
  divisions.forEach((division) => {
    const age = baseAge(division.name);
    if (age == null) return;
    if (!byAge.has(age)) byAge.set(age, []);
    byAge.get(age).push(division);
  });

  const merges = [];
  [...byAge.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([age, group]) => {
      const gendered = group.filter((division) => genderOf(division.name) !== 'coed');
      if (gendered.length === 0) return;
      const sourceDivisionIds = group.map((division) => division.id);
      const sourceSet = new Set(sourceDivisionIds);
      const playerIds = players
        .filter((player) => sourceSet.has(player.division_id))
        .map((player) => player.id);
      const teamCount = teams.filter((team) => sourceSet.has(team.division_id)).length;
      merges.push({
        age,
        divisionUpsert: { name: `U${age}`, gender_policy: 'coed' },
        sourceDivisionIds,
        playerIds,
        teamCount,
      });
    });

  return { merges };
}

/**
 * Plan a gender split: every co-ed division with players of both genders
 * fans out into "U{n}B" / "U{n}G". Team counts are allocated proportionally
 * to headcount with each gender getting at least one team (when the source
 * division had any teams).
 *
 * @param {Object} params
 * @param {Array<{id: string, name: string, gender_policy?: string}>} params.divisions
 * @param {Array<{id: string, division_id?: string, gender?: string}>} params.players
 * @param {Array<{id: string, division_id?: string}>} [params.teams]
 * @returns {{ splits: Array<{
 *   age: number,
 *   sourceDivisionId: string,
 *   targets: Array<{
 *     divisionUpsert: { name: string, gender_policy: 'boys'|'girls' },
 *     playerIds: string[],
 *     teamCount: number,
 *   }>,
 * }> }}
 */
export function planGenderSplit({ divisions = [], players = [], teams = [] }) {
  const splits = [];

  divisions.forEach((division) => {
    if (genderOf(division.name) !== 'coed') return;
    const age = baseAge(division.name);
    if (age == null) return;

    const divisionPlayers = players.filter((player) => player.division_id === division.id);
    const boys = divisionPlayers.filter((player) => player.gender === 'm');
    const girls = divisionPlayers.filter((player) => player.gender === 'f');
    if (boys.length === 0 && girls.length === 0) return;

    const sourceTeamCount = teams.filter((team) => team.division_id === division.id).length;
    const total = boys.length + girls.length;

    // Proportional allocation with each present gender getting ≥ 1 team.
    let boysTeams = 0;
    let girlsTeams = 0;
    if (sourceTeamCount > 0) {
      if (boys.length > 0 && girls.length > 0) {
        boysTeams = Math.max(1, Math.round((sourceTeamCount * boys.length) / total));
        boysTeams = Math.min(boysTeams, sourceTeamCount - 1);
        girlsTeams = sourceTeamCount - boysTeams;
      } else if (boys.length > 0) {
        boysTeams = sourceTeamCount;
      } else {
        girlsTeams = sourceTeamCount;
      }
    }

    const base = baseName(division.name).toUpperCase();
    const targets = [];
    if (boys.length > 0) {
      targets.push({
        divisionUpsert: { name: `${base}B`, gender_policy: 'boys' },
        playerIds: boys.map((player) => player.id),
        teamCount: boysTeams,
      });
    }
    if (girls.length > 0) {
      targets.push({
        divisionUpsert: { name: `${base}G`, gender_policy: 'girls' },
        playerIds: girls.map((player) => player.id),
        teamCount: girlsTeams,
      });
    }

    splits.push({ age, sourceDivisionId: division.id, targets });
  });

  splits.sort((a, b) => a.age - b.age);
  return { splits };
}
