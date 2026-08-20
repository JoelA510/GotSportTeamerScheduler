/**
 * **Requirements 3 and 4.** Who is must-attend — derived, never named — and
 * what happens to the team a person has to leave.
 *
 * ## Derived, and the test that proves it
 *
 * There are exactly two bases, and neither of them is a name:
 *
 * - {@link MUST_ATTEND_BASIS.SOLE_COACH_OF_MULTIPLE_TEAMS} falls out of the
 *   roster: a person who is the **only** active coach of two or more teams has
 *   nobody to fall back to at either end. Change the roster and the set
 *   changes; no edit here.
 * - {@link MUST_ATTEND_BASIS.DECLARED_PERSONAL_CONSTRAINT} comes from a record
 *   an operator entered — the single-car family, who could not split.
 *
 * The declared-constraint policy **ships empty**, exactly as
 * `facility/venueComplex.js` ships `EMPTY_VENUE_COMPLEX_MAP`: the corpus
 * carries no such record, and seeding one would put a real family's domestic
 * arrangement into a repository `CLAUDE.md` forbids from holding PII. The shape
 * exists so the operator has somewhere to put it, and
 * {@link PEOPLE_REASON.PERSONAL_CONSTRAINT_POLICY_EMPTY} says out loud that one
 * of the two bases had nothing to contribute rather than letting an empty
 * policy look like a considered answer.
 *
 * `tests/people.test.js` greps this package's own source for every person key
 * and team code in the corpus and asserts none of them appears. A derivation
 * that is only *described* as derived is the sort of claim that reaches
 * "verified" while being false.
 *
 * ## Fallback priority: lower slot keeps the person
 *
 * Slot 1 is the team's primary coach, so the lower slot is the club's own
 * statement of where this person is the more load-bearing. The person stays
 * there; the other team is released to a co-coach and **that release is
 * recorded as a conflict for that team**, which is what makes the corpus's
 * "3 rec games are single-coach (a co-coach covered)" a countable fact rather
 * than a footnote.
 *
 * A commitment with no team — a declared non-club obligation — ranks as slot
 * **0**. It is not that such an obligation is more important; it is that no
 * co-coach can stand in for it, so releasing it is not a move that exists.
 * `CoachAssignmentSchema` forbids a slot below 1, so 0 cannot collide with a
 * real one.
 *
 * @module people/mustAttend
 */

import {
  ATTENDANCE_OUTCOME,
  MUST_ATTEND_BASIS,
  PEOPLE_REASON,
  PERSONAL_CONSTRAINT_KIND,
  createPeopleMeta,
  derivePeopleStatus,
  makePeopleFinding,
} from './reasonCodes.js';
import { coCoachesOf, coachSlotOf, teamsCoachedBy } from './roster.js';
import { PersonalConstraintPolicyInputSchema } from './schemas.js';

/** The rank a commitment nobody else could cover is given. See the docstring. */
const UNDELEGABLE_SLOT = 0;

/** The rank of a team commitment the roster cannot link the person to. */
const UNKNOWN_SLOT = Number.MAX_SAFE_INTEGER;

/**
 * Build an immutable policy of declared personal constraints.
 *
 * @param {{ constraints?: ReadonlyArray<Object> }} input
 * @returns {import('./types.js').PersonalConstraintPolicy}
 */
export function buildPersonalConstraintPolicy(input) {
  const parsed = PersonalConstraintPolicyInputSchema.parse(input);
  /** @type {Map<string, import('./types.js').PersonalConstraint[]>} */
  const byPerson = new Map();
  for (const constraint of parsed.constraints) {
    if (!byPerson.has(constraint.personId)) byPerson.set(constraint.personId, []);
    /** @type {import('./types.js').PersonalConstraint[]} */ (
      byPerson.get(constraint.personId)
    ).push(Object.freeze(/** @type {import('./types.js').PersonalConstraint} */ (constraint)));
  }
  /** @type {Map<string, ReadonlyArray<import('./types.js').PersonalConstraint>>} */
  const frozen = new Map();
  for (const [personId, entries] of byPerson) {
    frozen.set(personId, Object.freeze([...entries].sort((a, b) => a.id.localeCompare(b.id))));
  }
  return Object.freeze({
    constraints: Object.freeze([...parsed.constraints].sort((a, b) => a.id.localeCompare(b.id))),
    byPerson: frozen,
  });
}

/**
 * The policy as this repository ships it: **empty**, on purpose.
 *
 * @type {import('./types.js').PersonalConstraintPolicy}
 */
export const EMPTY_PERSONAL_CONSTRAINT_POLICY = buildPersonalConstraintPolicy({ constraints: [] });

/**
 * Derive who is must-attend, and on what basis.
 *
 * @param {{ roster: import('./types.js').CoachRoster, policy?: import('./types.js').PersonalConstraintPolicy }} options
 * @returns {{ byPerson: Map<string, import('./types.js').MustAttendVerdict>, findings: import('./types.js').PeopleFinding[], meta: import('./types.js').PeopleMeta, status: string }}
 */
export function deriveMustAttend(options) {
  const { roster, policy = EMPTY_PERSONAL_CONSTRAINT_POLICY } = options;
  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const findings = [];
  /** @type {Map<string, { bases: Set<string>, teamIds: Set<string> }>} */
  const accumulated = new Map();

  /**
   * @param {string} personId
   * @param {string} basis
   * @param {ReadonlyArray<string>} teamIds
   */
  const record = (personId, basis, teamIds) => {
    if (!accumulated.has(personId)) {
      accumulated.set(personId, { bases: new Set(), teamIds: new Set() });
    }
    const entry = /** @type {{ bases: Set<string>, teamIds: Set<string> }} */ (
      accumulated.get(personId)
    );
    entry.bases.add(basis);
    for (const teamId of teamIds) entry.teamIds.add(teamId);
  };

  /* -- basis 1: sole coach of two or more teams ---------------------------- */
  for (const [personId] of [...roster.assignmentsByPerson.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    meta.peopleExamined += 1;
    const teamIds = teamsCoachedBy(roster, personId);
    if (teamIds.length < 2) continue;
    meta.multiTeamPeople += 1;
    const soleOf = teamIds.filter((teamId) => {
      const team = roster.teams.get(teamId);
      return team !== undefined && team.personIds.length === 1;
    });
    if (soleOf.length < 2) continue;
    record(personId, MUST_ATTEND_BASIS.SOLE_COACH_OF_MULTIPLE_TEAMS, soleOf);
  }

  /* -- basis 2: a declared personal constraint ----------------------------- */
  if (policy.constraints.length === 0) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.PERSONAL_CONSTRAINT_POLICY_EMPTY,
        'the declared-personal-constraint policy is empty, so must-attend was derived from the roster alone; a person who cannot split for a reason no schedule can see is invisible to this derivation until somebody records it',
        { constraintsDeclared: 0 }
      )
    );
  }
  for (const constraint of policy.constraints) {
    meta.personalConstraintsExamined += 1;
    if (!roster.peopleById.has(constraint.personId)) {
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.PERSONAL_CONSTRAINT_PERSON_UNKNOWN,
          `declared personal constraint "${constraint.id}" names person "${constraint.personId}", who is not on the roster; the constraint governs nobody`,
          { constraintId: constraint.id, personId: constraint.personId }
        )
      );
      continue;
    }
    if (constraint.kind !== PERSONAL_CONSTRAINT_KIND.CANNOT_SPLIT) continue;
    record(
      constraint.personId,
      MUST_ATTEND_BASIS.DECLARED_PERSONAL_CONSTRAINT,
      constraint.teamIds ?? teamsCoachedBy(roster, constraint.personId)
    );
  }

  /** @type {Map<string, import('./types.js').MustAttendVerdict>} */
  const byPerson = new Map();
  for (const [personId, entry] of [...accumulated.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    meta.mustAttendPeople += 1;
    byPerson.set(
      personId,
      Object.freeze({
        personId,
        mustAttend: true,
        bases: Object.freeze([...entry.bases].sort()),
        teamIds: Object.freeze([...entry.teamIds].sort()),
      })
    );
  }

  return { byPerson, findings, meta, status: derivePeopleStatus(findings) };
}

/**
 * Is this person must-attend?
 *
 * @param {ReadonlyMap<string, import('./types.js').MustAttendVerdict>} verdicts
 * @param {string} personId
 * @returns {boolean}
 */
export function isMustAttend(verdicts, personId) {
  const verdict = verdicts.get(personId);
  return verdict !== undefined && verdict.mustAttend;
}

/**
 * The rank a commitment carries in a clash. Lower keeps the person.
 *
 * @param {import('./types.js').CoachRoster} roster
 * @param {string} personId
 * @param {import('./types.js').PersonCommitment} commitment
 * @returns {number}
 */
function slotRankOf(roster, personId, commitment) {
  if (commitment.teamId === null) return UNDELEGABLE_SLOT;
  const slot = coachSlotOf(roster, personId, commitment.teamId);
  return slot === null ? UNKNOWN_SLOT : slot;
}

/**
 * Is this person free across a commitment's footprint?
 *
 * A candidate with no known end to one of their own commitments is treated as
 * **not** free: "we cannot tell" and "they are available" are different
 * answers, and reporting a fallback that may not exist is worse than reporting
 * a contested one.
 *
 * @param {import('./types.js').TimelineSet} set
 * @param {string} personId
 * @param {import('./types.js').PersonCommitment} commitment
 * @returns {boolean}
 */
function isFreeAcross(set, personId, commitment) {
  const end = commitment.endMinutes === null ? commitment.startMinutes : commitment.endMinutes;
  for (const other of set.byPerson.get(personId) ?? []) {
    if (other.date !== commitment.date) continue;
    if (other.id === commitment.id) continue;
    // A co-coach of the *same* fixture is not busy elsewhere; they are the
    // person being asked to cover it. Comparing commitment ids is not enough,
    // because one game produces one commitment per coach, and each coach's own
    // row would otherwise read as a clash with itself.
    if (other.gameId !== null && other.gameId === commitment.gameId) continue;
    if (other.endMinutes === null) {
      if (other.startMinutes < end) return false;
      continue;
    }
    if (other.startMinutes < end && other.endMinutes > commitment.startMinutes) return false;
  }
  return true;
}

/**
 * Resolve every clash by coach slot, and say what became of the released team.
 *
 * @param {{ roster: import('./types.js').CoachRoster, timelines: import('./types.js').TimelineSet, clashes: ReadonlyArray<import('./types.js').AttendanceClash>, mustAttend?: ReadonlyMap<string, import('./types.js').MustAttendVerdict> }} options
 * @returns {{ resolutions: Array<import('./types.js').AttendanceResolution>, findings: import('./types.js').PeopleFinding[], meta: import('./types.js').PeopleMeta, status: string }}
 */
export function resolveAttendance(options) {
  const { roster, timelines, clashes, mustAttend = new Map() } = options;
  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const scanFindings = [];
  /** @type {Array<import('./types.js').AttendanceResolution>} */
  const resolutions = [];

  meta.timelinesBuilt = timelines.byPerson.size;
  meta.mustAttendPeople = mustAttend.size;

  for (const clash of [...clashes].sort((a, b) => a.id.localeCompare(b.id))) {
    meta.clashesExamined += 1;
    /** @type {import('./types.js').PeopleFinding[]} */
    const findings = [];

    const fromRank = slotRankOf(roster, clash.personId, clash.from);
    const toRank = slotRankOf(roster, clash.personId, clash.to);

    let retained = clash.from;
    let released = clash.to;
    let retainedRank = fromRank;
    let releasedRank = toRank;

    if (toRank < fromRank) {
      retained = clash.to;
      released = clash.from;
      retainedRank = toRank;
      releasedRank = fromRank;
    } else if (toRank === fromRank) {
      // Reported, never silent — the same contract as
      // `CONSTRAINT_PRECEDENCE_AMBIGUOUS`. The tie-break is the commitment id,
      // which is stable and has no opinion, so a reader can see that the
      // decision was arbitrary rather than reasoned.
      const ordered = [clash.from, clash.to].sort((a, b) => a.id.localeCompare(b.id));
      retained = ordered[0];
      released = ordered[1];
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.ATTENDANCE_SLOT_TIE,
          `"${clash.personId}" holds the same coach rank (${fromRank}) on both "${clash.from.id}" and "${clash.to.id}" on ${clash.date}, so slot order cannot decide; the clash was broken by commitment id and needs a human`,
          {
            clashId: clash.id,
            personId: clash.personId,
            date: clash.date,
            rank: fromRank,
            commitmentIds: [clash.from.id, clash.to.id].sort(),
          }
        )
      );
    }

    if (findings.length === 0) {
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.ATTENDANCE_RESOLVED_BY_SLOT,
          `"${clash.personId}" stays with "${retained.teamId ?? retained.id}" (rank ${retainedRank}) and is released from "${released.teamId ?? released.id}" (rank ${releasedRank}) on ${clash.date}`,
          {
            clashId: clash.id,
            personId: clash.personId,
            date: clash.date,
            retainedTeamId: retained.teamId,
            retainedSlot: retainedRank,
            releasedTeamId: released.teamId,
            releasedSlot: releasedRank,
          }
        )
      );
    }

    const releasedTeamId = released.teamId;
    /** @type {string[]} */
    let fallbackPersonIds = [];
    /** @type {string} */
    let outcome = ATTENDANCE_OUTCOME.UNCOVERED;

    if (releasedTeamId === null) {
      // Both sides were undelegable; there is no team to release and nothing a
      // co-coach could do. The tie finding above already says a human is needed.
      outcome = ATTENDANCE_OUTCOME.UNCOVERED;
    } else {
      const coCoaches = coCoachesOf(roster, releasedTeamId, clash.personId);
      const available = coCoaches.filter((candidate) =>
        isFreeAcross(timelines, candidate, released)
      );
      if (coCoaches.length === 0) {
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.TEAM_NO_FALLBACK_AVAILABLE,
            `team "${releasedTeamId}" loses "${clash.personId}" on ${clash.date} and has no other active coach, so nobody is on that touchline`,
            {
              clashId: clash.id,
              teamId: releasedTeamId,
              personId: clash.personId,
              date: clash.date,
              commitmentId: released.id,
            }
          )
        );
      } else if (available.length === 0) {
        outcome = ATTENDANCE_OUTCOME.FALLBACK_CONTESTED;
        fallbackPersonIds = coCoaches;
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.TEAM_FALLBACK_CONTESTED,
            `team "${releasedTeamId}" loses "${clash.personId}" on ${clash.date}; its ${coCoaches.length} co-coach(es) are all committed elsewhere at the same time, so the pair has to split one game each`,
            {
              clashId: clash.id,
              teamId: releasedTeamId,
              personId: clash.personId,
              date: clash.date,
              commitmentId: released.id,
              coCoachIds: coCoaches,
            }
          )
        );
      } else {
        outcome = ATTENDANCE_OUTCOME.FALLBACK;
        fallbackPersonIds = available;
        meta.fallbacksFound += 1;
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.TEAM_FALLBACK_TO_CO_COACH,
            `team "${releasedTeamId}" falls back to co-coach "${available[0]}" on ${clash.date} because "${clash.personId}" is committed to "${retained.teamId ?? retained.id}"; this is recorded as a conflict for "${releasedTeamId}"`,
            {
              clashId: clash.id,
              teamId: releasedTeamId,
              personId: clash.personId,
              date: clash.date,
              commitmentId: released.id,
              fallbackPersonId: available[0],
              fallbackPersonIds: available,
            }
          )
        );
      }
    }

    const personMustAttend = isMustAttend(mustAttend, clash.personId);
    if (personMustAttend) {
      const verdict = /** @type {import('./types.js').MustAttendVerdict} */ (
        mustAttend.get(clash.personId)
      );
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.ATTENDANCE_MUST_ATTEND_UNRESOLVABLE,
          `"${clash.personId}" is must-attend (${verdict.bases.join(', ')}) and is wanted at two commitments on ${clash.date}; releasing either one breaks a requirement that no fallback can satisfy`,
          {
            clashId: clash.id,
            personId: clash.personId,
            date: clash.date,
            bases: [...verdict.bases],
            commitmentIds: [clash.from.id, clash.to.id].sort(),
          }
        )
      );
    }

    meta.clashesResolved += 1;
    resolutions.push({
      id: clash.id,
      personId: clash.personId,
      date: clash.date,
      retainedTeamId: retained.teamId,
      retainedSlot: retained.teamId === null ? null : retainedRank,
      releasedTeamId,
      releasedSlot: releasedTeamId === null ? null : releasedRank,
      outcome,
      fallbackPersonIds: Object.freeze(fallbackPersonIds),
      mustAttend: personMustAttend,
      findings,
      status: derivePeopleStatus(findings),
    });
  }

  // The meta-assertion is on the **input**, not the output. Zero clashes is a
  // legitimate answer for a clean schedule; zero timelines is the incident-4
  // failure — a roster join that matched nothing, reporting a perfect score.
  if (meta.timelinesBuilt === 0) {
    scanFindings.push(
      makePeopleFinding(
        PEOPLE_REASON.ATTENDANCE_SCAN_VACUOUS,
        'the attendance scan was handed zero personal timelines, so its verdict describes nobody',
        { timelines: 0, clashesExamined: meta.clashesExamined }
      )
    );
  }

  const findings = [...scanFindings, ...resolutions.flatMap((resolution) => resolution.findings)];
  return { resolutions, findings, meta, status: derivePeopleStatus(findings) };
}
