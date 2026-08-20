/**
 * The coach roster: who coaches what, in which slot, with which status — and
 * the sole-coach risk register that falls out of it.
 *
 * ## Why this is not `Team.coachId` + `assistantCoachIds[]`
 *
 * GAP-20: that pair loses the slot number and, worse, it loses the *question*.
 * `checkCoachConflict()` in `gameValidation.js` inspects `homeTeam.coachId` and
 * `awayTeam.coachId` and nothing else, so an assistant's clashes are invisible
 * to it — and this corpus's three single-coach games cannot be found at all
 * with that model. Requirement 4 needs the slot as an *order*, because "the
 * person stays with the team where they hold the lower coach slot" is a
 * comparison, and a boolean `isAssistant` cannot answer it when somebody is
 * slot 2 on both teams.
 *
 * ## The register, and what it is for
 *
 * A team with exactly one active coach has **no fallback capacity**: when that
 * coach is wanted elsewhere there is nobody to release the team to. That is not
 * a violation — 50 of this corpus's 132 teams are in that position and the
 * season ran — so {@link PEOPLE_REASON.TEAM_SOLE_COACH} is `info` and the
 * register is a report. What *is* a `compromise` is a person who is the sole
 * coach of **two or more** teams, because that is a must-attend with no
 * fallback at either end, and it is exactly the state incident 6 hid behind two
 * spellings of one name.
 *
 * @module people/roster
 */

import {
  ACTIVE_ASSIGNMENT_STATUSES,
  PEOPLE_REASON,
  createPeopleMeta,
  derivePeopleStatus,
  makePeopleFinding,
} from './reasonCodes.js';
import { CoachRosterInputSchema } from './schemas.js';

/**
 * Does an inclusive `[fromDate, toDate]` window cover a date?
 *
 * A null bound is open. ISO `YYYY-MM-DD` strings order correctly under `<` and
 * `>`, which is why every date in this package is one and no `Date` is ever
 * constructed.
 *
 * Shared with the declared-personal-constraint policy in `mustAttend.js`: an
 * effective window means the same thing on an assignment and on a constraint,
 * and two implementations of it would be two things to keep in step.
 *
 * @param {string} date - `YYYY-MM-DD`
 * @param {string|null} fromDate
 * @param {string|null} toDate
 * @returns {boolean}
 */
export function windowCoversDate(date, fromDate, toDate) {
  if (fromDate !== null && date < fromDate) return false;
  if (toDate !== null && date > toDate) return false;
  return true;
}

/**
 * Build the roster from people and assignments.
 *
 * Structural defects are **reported, not thrown**: a duplicate slot or an
 * assignment pointing at an unknown person is a producer bug, but a roster is
 * data an operator uploaded, and refusing the whole file would leave them with
 * no way to see which row is wrong. The findings carry a `blocking` severity,
 * which `derivePeopleStatus()` turns into `rejected` — a consumer that acts on
 * a rejected roster has ignored an answer it was given.
 *
 * Inactive assignments (`declined`, `withdrawn`, `pending`) are parsed, counted
 * and then excluded from every index. A coach who has not accepted is not
 * fallback capacity, and counting them would make a sole-coach team look
 * covered.
 *
 * **Every team the roster names is indexed, coached or not.** Indexing teams
 * from the active assignments alone made a team whose coaches had all declined
 * *vanish*: no {@link PEOPLE_REASON.TEAM_UNCOACHED} finding, because the
 * register never saw the team, and — since the season adapter skips a side the
 * roster does not know — every one of that team's fixtures dropped out of the
 * timelines with nothing said about it. An uncoached team is present and
 * uncoached, which is a fact somebody can act on.
 *
 * `asOf` is the date the roster is being read *as of*, and it is what makes
 * `effectiveFrom`/`effectiveTo` load-bearing: an assignment whose window does
 * not cover it is inactive, exactly as a declined one is, so the sole-coach
 * register, the must-attend derivation and the co-coach fallback search all
 * honour the window without knowing it exists. With no `asOf` the window cannot
 * be applied at all; the assignment stays active and
 * {@link PEOPLE_REASON.ASSIGNMENT_WINDOW_UNJUDGED} says so, because a departed
 * coach silently counted as fallback capacity is the failure this field exists
 * to prevent.
 *
 * @param {{ people?: ReadonlyArray<Object>, assignments?: ReadonlyArray<Object> }} input
 * @param {{ asOf?: string|null }} [options] - the date the roster is read as of
 * @returns {import('./types.js').CoachRoster}
 */
export function buildCoachRoster(input, options = {}) {
  const asOf = options.asOf ?? null;
  const parsed = CoachRosterInputSchema.parse(input);
  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const findings = [];

  /** @type {Map<string, import('./types.js').Person>} */
  const peopleById = new Map();
  for (const person of parsed.people) {
    peopleById.set(person.id, Object.freeze({ ...person, aliases: [...person.aliases].sort() }));
    meta.peopleExamined += 1;
  }

  /** @type {Map<string, import('./types.js').CoachAssignment[]>} */
  const byTeam = new Map();

  /** @type {import('./types.js').CoachAssignment[]} */
  const active = [];
  for (const assignment of parsed.assignments) {
    meta.assignmentsExamined += 1;
    // Before any other question: the roster names this team, so the team
    // exists. See the docstring — a team indexed only from active assignments
    // disappears the moment its coaches all decline, and takes its fixtures
    // with it.
    if (!byTeam.has(assignment.teamId)) byTeam.set(assignment.teamId, []);
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)) {
      meta.assignmentsInactive += 1;
      continue;
    }
    if (assignment.effectiveFrom !== null || assignment.effectiveTo !== null) {
      if (asOf === null) {
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.ASSIGNMENT_WINDOW_UNJUDGED,
            `assignment "${assignment.id}" is effective ${assignment.effectiveFrom ?? 'always'} to ${assignment.effectiveTo ?? 'always'} and this roster was built with no as-of date, so the window was not applied and this person counts as active throughout`,
            {
              assignmentId: assignment.id,
              personId: assignment.personId,
              teamId: assignment.teamId,
              effectiveFrom: assignment.effectiveFrom,
              effectiveTo: assignment.effectiveTo,
            }
          )
        );
      } else if (!windowCoversDate(asOf, assignment.effectiveFrom, assignment.effectiveTo)) {
        meta.assignmentsInactive += 1;
        continue;
      }
    }
    if (!peopleById.has(assignment.personId)) {
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.ASSIGNMENT_PERSON_UNKNOWN,
          `assignment "${assignment.id}" names person "${assignment.personId}", who is not on the roster`,
          {
            assignmentId: assignment.id,
            personId: assignment.personId,
            teamId: assignment.teamId,
          }
        )
      );
      continue;
    }
    meta.assignmentsActive += 1;
    active.push(Object.freeze(/** @type {import('./types.js').CoachAssignment} */ (assignment)));
  }

  /** @type {Map<string, import('./types.js').CoachAssignment[]>} */
  const byPerson = new Map();
  for (const assignment of active) {
    /** @type {import('./types.js').CoachAssignment[]} */ (byTeam.get(assignment.teamId)).push(
      assignment
    );
    if (!byPerson.has(assignment.personId)) byPerson.set(assignment.personId, []);
    /** @type {import('./types.js').CoachAssignment[]} */ (byPerson.get(assignment.personId)).push(
      assignment
    );
  }

  /** @type {Map<string, import('./types.js').TeamCoaching>} */
  const teams = new Map();
  for (const [teamId, entries] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    meta.teamsExamined += 1;
    const slots = [...entries].sort((a, b) =>
      a.slot === b.slot ? a.personId.localeCompare(b.personId) : a.slot - b.slot
    );

    /** @type {Map<number, string>} */
    const seenSlots = new Map();
    /** @type {Set<string>} */
    const seenPeople = new Set();
    for (const assignment of slots) {
      const holder = seenSlots.get(assignment.slot);
      if (holder !== undefined) {
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.ASSIGNMENT_SLOT_DUPLICATE,
            `team "${teamId}" gives coach slot ${assignment.slot} to both "${holder}" and "${assignment.personId}"; slot order cannot decide a clash while two people hold one slot`,
            { teamId, slot: assignment.slot, personIds: [holder, assignment.personId].sort() }
          )
        );
      } else {
        seenSlots.set(assignment.slot, assignment.personId);
      }
      if (seenPeople.has(assignment.personId)) {
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.ASSIGNMENT_PERSON_DUPLICATE,
            `person "${assignment.personId}" holds two active assignments on team "${teamId}"`,
            { teamId, personId: assignment.personId }
          )
        );
      }
      seenPeople.add(assignment.personId);
    }

    teams.set(
      teamId,
      Object.freeze({
        teamId,
        slots: Object.freeze(slots),
        personIds: Object.freeze([...new Set(slots.map((entry) => entry.personId))]),
      })
    );
  }

  /** @type {Map<string, ReadonlyArray<import('./types.js').CoachAssignment>>} */
  const assignmentsByPerson = new Map();
  for (const [personId, entries] of [...byPerson.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const sorted = [...entries].sort((a, b) =>
      a.teamId === b.teamId ? a.slot - b.slot : a.teamId.localeCompare(b.teamId)
    );
    assignmentsByPerson.set(personId, Object.freeze(sorted));
    if (new Set(sorted.map((entry) => entry.teamId)).size > 1) meta.multiTeamPeople += 1;
  }

  if (meta.assignmentsActive === 0) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.ROSTER_EMPTY,
        `the roster carries ${meta.assignmentsExamined} assignment(s) and not one of them is active, so every "this team is covered" answer below would be true for the wrong reason`,
        {
          assignmentsExamined: meta.assignmentsExamined,
          assignmentsInactive: meta.assignmentsInactive,
        }
      )
    );
  }

  return {
    peopleById,
    teams,
    assignmentsByPerson,
    assignments: Object.freeze(active),
    findings,
    meta,
    status: derivePeopleStatus(findings),
  };
}

/**
 * The coach slot a person holds on a team, or null when they do not coach it.
 *
 * @param {import('./types.js').CoachRoster} roster
 * @param {string} personId
 * @param {string} teamId
 * @returns {number|null}
 */
export function coachSlotOf(roster, personId, teamId) {
  const team = roster.teams.get(teamId);
  if (!team) return null;
  const found = team.slots.find((assignment) => assignment.personId === personId);
  return found ? found.slot : null;
}

/**
 * Every team a person actively coaches, sorted by team id.
 *
 * @param {import('./types.js').CoachRoster} roster
 * @param {string} personId
 * @returns {string[]}
 */
export function teamsCoachedBy(roster, personId) {
  const entries = roster.assignmentsByPerson.get(personId) ?? [];
  return [...new Set(entries.map((assignment) => assignment.teamId))].sort();
}

/**
 * The other active coaches of a team, excluding one person.
 *
 * Returned in slot order, because when two co-coaches could cover, the lower
 * slot is the club's own statement of who is the more responsible for the team.
 *
 * @param {import('./types.js').CoachRoster} roster
 * @param {string} teamId
 * @param {string} exceptPersonId
 * @returns {string[]}
 */
export function coCoachesOf(roster, teamId, exceptPersonId) {
  const team = roster.teams.get(teamId);
  if (!team) return [];
  return team.slots
    .filter((assignment) => assignment.personId !== exceptPersonId)
    .map((assignment) => assignment.personId);
}

/**
 * **Requirement 6.** Every team with exactly one active coach, plus every
 * person who is the sole coach of more than one team.
 *
 * The register is *derived from the roster it is handed*. It names nobody, and
 * a roster with different people in it produces a different register with no
 * edit here — which is the property requirement 3 turns on.
 *
 * @param {import('./types.js').CoachRoster} roster
 * @returns {{ teams: Array<Object>, people: Array<Object>, findings: import('./types.js').PeopleFinding[], meta: import('./types.js').PeopleMeta, status: string }}
 */
export function soleCoachRiskRegister(roster) {
  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const findings = [];
  /** @type {Array<Object>} */
  const teams = [];
  /** @type {Map<string, string[]>} */
  const soleTeamsByPerson = new Map();

  for (const [teamId, team] of [...roster.teams.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    meta.teamsExamined += 1;
    if (team.personIds.length === 0) {
      meta.uncoachedTeams += 1;
      findings.push(
        makePeopleFinding(PEOPLE_REASON.TEAM_UNCOACHED, `team "${teamId}" has no active coach`, {
          teamId,
        })
      );
      continue;
    }
    if (team.personIds.length > 1) continue;

    meta.soleCoachTeams += 1;
    const personId = team.personIds[0];
    if (!soleTeamsByPerson.has(personId)) soleTeamsByPerson.set(personId, []);
    /** @type {string[]} */ (soleTeamsByPerson.get(personId)).push(teamId);
    const entry = {
      teamId,
      personId,
      slot: team.slots[0].slot,
      alsoCoaches: teamsCoachedBy(roster, personId).filter((id) => id !== teamId),
    };
    teams.push(entry);
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.TEAM_SOLE_COACH,
        `team "${teamId}" has one active coach ("${personId}"), so it has no fallback capacity if that person is wanted elsewhere`,
        entry
      )
    );
  }

  /** @type {Array<Object>} */
  const people = [];
  for (const [personId, teamIds] of [...soleTeamsByPerson.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (teamIds.length < 2) continue;
    const entry = { personId, teamIds: [...teamIds].sort() };
    people.push(entry);
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.PERSON_SOLE_COACH_OF_MULTIPLE_TEAMS,
        `"${personId}" is the only active coach of ${teamIds.length} teams (${[...teamIds].sort().join(', ')}); neither team has anybody to fall back to`,
        entry
      )
    );
  }

  if (meta.teamsExamined === 0) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.SOLE_COACH_SCAN_VACUOUS,
        'the sole-coach register examined zero teams, so its empty result says nothing about coverage',
        { teamsExamined: 0 }
      )
    );
  }

  return { teams, people, findings, meta, status: derivePeopleStatus(findings) };
}
