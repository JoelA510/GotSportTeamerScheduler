/**
 * Reusable fixtures for the incremental / snapshot-aware teaming hardening effort
 * (project-hardening PRs 01–09). PR 01 introduces these so later PRs can share one
 * stable set of scenario builders and a single deterministic PRNG.
 *
 * Everything here is plain data / pure helpers — no imports from the core engine — so
 * the module stays decoupled from the very code the hardening PRs will change.
 *
 * Field names mirror the engine's expectations as consumed by `generateTeams`
 * (`packages/core/src/teamGeneration.js`): a generator player needs `id` + `division`,
 * with optional `buddyId`, `coachId`, and `skillRating`.
 */

/**
 * Deterministic PRNG mirroring `createDeterministicRandom` in
 * `tests/teamGeneration.test.js` (state seed 42, LCG multiplier 48271) so fixtures and
 * characterization tests share one reproducible random sequence.
 * @param {number} [seedState=42]
 * @returns {() => number}
 */
export function createDeterministicRandom(seedState = 42) {
  const modulus = 2147483647;
  let state = seedState;
  return () => {
    state = (state * 48271) % modulus;
    return state / modulus;
  };
}

/**
 * Build a minimal engine-shaped player. Only `id` and `division` are required; optional
 * fields are included only when provided, matching how the engine treats absent fields
 * as "no request".
 * @param {{ id: string, division?: string, buddyId?: string, coachId?: string, skillRating?: number }} options
 */
export function makeGenerationPlayer(options) {
  const { id, division = 'U10', buddyId, coachId, skillRating } = options;
  if (!id) {
    throw new Error('makeGenerationPlayer requires an id');
  }
  return {
    id,
    division,
    ...(buddyId !== undefined ? { buddyId } : {}),
    ...(coachId !== undefined ? { coachId } : {}),
    ...(skillRating !== undefined ? { skillRating } : {}),
  };
}

/**
 * Build a division config matching the shape used throughout `teamGeneration.test.js`.
 *
 * NOTE: `generateTeams` derives the actual team count from `ceil(players / targetTeamSize)`
 * (`targetTeamSize` defaults to `maxRosterSize`), bounded by any min/max team constraints —
 * it does **not** read `teamsCount`. `teamsCount` is kept only to match the conventional config
 * shape; scenarios that need multiple teams must set `maxRosterSize` (or `targetTeamSize`)
 * so that `ceil(players / size) >= 2`.
 * @param {Record<string, any>} [overrides]
 */
export function makeDivisionConfig(overrides = {}) {
  return { id: 'U10', teamsCount: 3, slotsPerWeek: 4, maxRosterSize: 4, ...overrides };
}

/**
 * A plain, capacity-comfortable division with no buddies or coaches.
 * @param {{ count?: number, division?: string, maxRosterSize?: number }} [options]
 */
export function balancedDivisionScenario({ count = 9, division = 'U10', maxRosterSize = 4 } = {}) {
  const players = Array.from({ length: count }, (_, index) =>
    makeGenerationPlayer({ id: `player-${index + 1}`, division })
  );
  return {
    players,
    divisionConfigs: { [division]: makeDivisionConfig({ id: division, maxRosterSize }) },
  };
}

/**
 * One reciprocal buddy pair plus four solo players, sized to **two** teams
 * (6 players / `maxRosterSize` 3) so "buddies share a team" is a real placement decision the
 * engine could get wrong — not a single-team tautology.
 * @param {{ division?: string }} [options]
 */
export function mutualBuddyScenario({ division = 'U10' } = {}) {
  const players = [
    makeGenerationPlayer({ id: 'buddy-a', division, buddyId: 'buddy-b' }),
    makeGenerationPlayer({ id: 'buddy-b', division, buddyId: 'buddy-a' }),
    makeGenerationPlayer({ id: 'solo-c', division }),
    makeGenerationPlayer({ id: 'solo-d', division }),
    makeGenerationPlayer({ id: 'solo-e', division }),
    makeGenerationPlayer({ id: 'solo-f', division }),
  ];
  return {
    players,
    divisionConfigs: { [division]: makeDivisionConfig({ id: division, maxRosterSize: 3 }) },
  };
}

/**
 * Two players anchored to a single volunteer coach plus four open players, sized to **two**
 * teams (6 players / `maxRosterSize` 3) so "the coached players land on the coach's team" is a
 * real decision — there is a coachless team they could otherwise be distributed onto.
 * @param {{ division?: string }} [options]
 */
export function coachAnchorScenario({ division = 'U10' } = {}) {
  const players = [
    makeGenerationPlayer({ id: 'coached-a', division, coachId: 'coach-1' }),
    makeGenerationPlayer({ id: 'coached-b', division, coachId: 'coach-1' }),
    makeGenerationPlayer({ id: 'open-c', division }),
    makeGenerationPlayer({ id: 'open-d', division }),
    makeGenerationPlayer({ id: 'open-e', division }),
    makeGenerationPlayer({ id: 'open-f', division }),
  ];
  return {
    players,
    divisionConfigs: { [division]: makeDivisionConfig({ id: division, maxRosterSize: 3 }) },
  };
}

/**
 * Five players all anchored to one coach whose team caps at `maxRosterSize` (4),
 * forcing exactly one `coach-capacity` overflow under current behavior.
 * @param {{ division?: string }} [options]
 */
export function coachOverflowScenario({ division = 'U10' } = {}) {
  const players = Array.from({ length: 5 }, (_, index) =>
    makeGenerationPlayer({ id: `coach-overflow-${index + 1}`, division, coachId: 'coach-1' })
  );
  return { players, divisionConfigs: { [division]: makeDivisionConfig({ id: division }) } };
}

/**
 * PROPOSED snapshot shape (target for PR 02 `normalizeExistingSnapshot`). Provided now
 * as a data-only fixture so PRs 02/04/08 share a canonical example. The engine does NOT
 * consume this yet — `generateTeams` ignores unknown params in PR 01.
 * @param {{ status?: string, runId?: string|null }} [options]
 */
export function makeExistingSnapshotFixture({ status = 'published', runId = 'run-1' } = {}) {
  return {
    status,
    runId,
    teamsByDivision: {
      U10: [
        {
          id: 'team-uuid-1',
          generatorId: 'U10-T01',
          name: 'Raptors',
          division: 'U10',
          coachId: 'coach-1',
          assistantCoachIds: [],
          locked: false,
          players: [
            { id: 'coached-a', assignment_source: 'auto', locked: false },
            { id: 'coached-b', assignment_source: 'manual', locked: true },
          ],
        },
      ],
    },
  };
}
