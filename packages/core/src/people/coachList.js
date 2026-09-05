/**
 * **One coach model.** Every coach a team has, in the club's declared order,
 * with the disagreements between the sources that declared it left visible.
 *
 * ## The two models this reconciles
 *
 * `roster.js` orders coaches by an integer **slot** and uses it for exactly one
 * thing: breaking a clash. `ATTENDANCE_RESOLVED_BY_SLOT` keeps a person on the
 * team where they hold the lower slot, and `coCoachesOf()` returns co-coaches in
 * slot order so the club's own statement of responsibility decides who covers.
 * That is an *order*, and `roster.js` defends it as one — a boolean
 * `isAssistant` cannot answer "who stays" when somebody is slot 2 on both teams.
 *
 * The legacy path spells the same fact as `teams.coach_id` plus
 * `assistant_coach_ids[]`, and the frontend as `headCoach` plus
 * `assistantCoaches`. Those spellings render the order **as a role**: they name
 * a head coach, and everything downstream then treats position 1 as a different
 * kind of person rather than as the first entry in a list. The costs were real
 * and shipped:
 *
 * - practice conflict checks saw only the head coach until 8.1, hiding 83
 *   co-coach assignments in the season-2026 corpus;
 * - `PracticeOverridePanel` gates its whole conflict check on `team.headCoach`,
 *   a field **nothing in this repo produces** outside the mock client's seed
 *   rows, so on real data it returned "no conflict" for every override;
 * - the schedule export carries one `Coach Name` column and drops everyone else
 *   into an `Assistant Coaches` column, so the artifact a parent receives
 *   states a hierarchy the league does not run.
 *
 * This module keeps the slot and drops the role. It is the single producer for
 * "who coaches this team", and every artifact goes through it.
 *
 * ## Disagreement is surfaced, never resolved
 *
 * `availability/kickoff.js` already has the shape: when a permit's `Lit` column
 * contradicts the facility graph it applies the field record **and** emits
 * `LIGHTING_SOURCE_DISAGREES` naming both readings. Here the same:
 * {@link reconcileTeamCoaches} exports the union of every source's coaches, in
 * the lowest slot each was given, and emits
 * {@link import('./reasonCodes.js').PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES}
 * when the sources rank them differently. It never picks a winner.
 *
 * The season-2026 corpus contains the case, and `tests/coachModel.test.js`
 * derives it rather than naming it: one select team's `coach_roster.csv` rows
 * give slot 1 to one person and slot 2 to a second, while the practice corpus's
 * `select_coaches.csv` gives that second person slot 1. Both sources agree the
 * two coach the team; they disagree about which is first. Under the old model
 * one of them was "the head coach" and the answer depended on which file you
 * opened.
 *
 * **Unknown is never folded into agreement.** A team only one source carries is
 * reported as {@link
 * import('./reasonCodes.js').PEOPLE_REASON.COACH_LIST_UNCORROBORATED}, because
 * "nothing contradicted it" and "two sources agreed" are different facts.
 *
 * @module people/coachList
 */

import {
  PEOPLE_REASON,
  createPeopleMeta,
  derivePeopleStatus,
  makePeopleFinding,
} from './reasonCodes.js';
import { CoachListSourcesSchema } from './schemas.js';

/**
 * The two ways two sources can disagree about a team's coach order.
 *
 * Kept as a frozen table on the finding's `disagreement` field rather than as
 * two reason codes, because they are the same fact — the order is not agreed —
 * and a consumer that wants to act on either acts on the code.
 *
 * @readonly
 * @enum {string}
 */
export const COACH_ORDER_DISAGREEMENT = Object.freeze({
  /** One person, two sources, two different slots. */
  PERSON_RANKED_DIFFERENTLY: 'person-ranked-differently',
  /** One slot, two sources, different people in it. */
  SLOT_OCCUPIED_DIFFERENTLY: 'slot-occupied-differently',
});

/**
 * Order two coaches: lower slot first, unslotted last, ties by person id.
 *
 * Unslotted last rather than first, and by a `null` test rather than by
 * `Infinity`: a coach with no declared slot is not "worse than slot 9999", they
 * are unranked, and the finding says so.
 *
 * @param {{ slot: number|null, personId: string }} a
 * @param {{ slot: number|null, personId: string }} b
 * @returns {number}
 */
export function compareCoaches(a, b) {
  if (a.slot === null && b.slot === null) return a.personId.localeCompare(b.personId);
  if (a.slot === null) return 1;
  if (b.slot === null) return -1;
  if (a.slot !== b.slot) return a.slot - b.slot;
  return a.personId.localeCompare(b.personId);
}

/**
 * Reconcile one team's coaches across every source that names them.
 *
 * Returns **every** coach — the union, never one source's list — ordered by
 * slot, with a finding for every way the sources fail to corroborate each
 * other. The order is a tie-break for clashes and nothing else; no entry is
 * marked head, primary or assistant, because this model does not carry that
 * fact and inventing it is the defect.
 *
 * @param {{ teamId: string, sources: ReadonlyArray<{ sourceId: string, coaches: ReadonlyArray<{ personId: string, displayName?: string|null, email?: string|null, slot?: number|null }> }> }} input
 * @returns {import('./types.js').TeamCoachList}
 */
export function reconcileTeamCoaches(input) {
  const parsed = CoachListSourcesSchema.parse(input);
  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const findings = [];
  meta.coachListsExamined += 1;

  /** @type {Map<string, { personId: string, displayName: string|null, email: string|null, slot: number|null, sourceIds: string[], slotBySource: Map<string, number> }>} */
  const byPerson = new Map();
  /** Sources that gave at least one coach a slot — the ones that ranked anything. */
  /** @type {string[]} */
  const rankingSources = [];

  for (const source of parsed.sources) {
    meta.coachListSourcesRead += 1;
    let ranked = false;
    for (const coach of source.coaches) {
      const existing = byPerson.get(coach.personId);
      const entry = existing ?? {
        personId: coach.personId,
        displayName: null,
        email: null,
        slot: null,
        sourceIds: [],
        slotBySource: new Map(),
      };
      // First non-null spelling wins for display, and later sources do not
      // overwrite it: the artifacts print a name, and a name that changes with
      // the order the sources happen to be passed in is not a name.
      if (entry.displayName === null && coach.displayName != null) {
        entry.displayName = coach.displayName;
      }
      if (entry.email === null && coach.email != null) entry.email = coach.email;
      if (coach.slot != null) {
        ranked = true;
        entry.slotBySource.set(source.sourceId, coach.slot);
        entry.slot = entry.slot === null ? coach.slot : Math.min(entry.slot, coach.slot);
      }
      if (!entry.sourceIds.includes(source.sourceId)) entry.sourceIds.push(source.sourceId);
      byPerson.set(coach.personId, entry);
    }
    if (ranked) rankingSources.push(source.sourceId);
  }

  const coaches = [...byPerson.values()].sort(compareCoaches).map((entry) =>
    Object.freeze({
      personId: entry.personId,
      displayName: entry.displayName,
      email: entry.email,
      slot: entry.slot,
      sourceIds: Object.freeze([...entry.sourceIds].sort()),
    })
  );
  meta.coachesExported += coaches.length;

  // **A team with no coaches is not a vacuous scan.** 50 of the season-2026
  // corpus's 132 teams have one coach and some have none; `roster.js` already
  // reports an uncoached team as `TEAM_UNCOACHED`, and firing a `compromise`
  // here for every coachless team would turn the "this check examined nothing"
  // alarm into routine noise and stop it distinguishing the two cases. What is
  // vacuous is being handed **no source at all**: then "the sources agree" is
  // true because nothing was read.
  if (parsed.sources.length === 0) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.COACH_LIST_SCAN_VACUOUS,
        `team "${parsed.teamId}" was reconciled across zero sources, so every "the sources agree" answer below would be true for the wrong reason`,
        { teamId: parsed.teamId, sourcesRead: 0 }
      )
    );
  }

  for (const coach of coaches) {
    if (coach.slot === null) {
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.COACH_SLOT_UNDECLARED,
          `no source gives "${coach.personId}" a coach slot on team "${parsed.teamId}", so slot order cannot break a clash for them; they are exported after the slotted coaches`,
          { teamId: parsed.teamId, personId: coach.personId }
        )
      );
    }
  }

  // Order disagreement, first shape: **one person, two slots.** Two sources
  // both rank somebody and put them in different positions.
  for (const entry of [...byPerson.values()].sort((a, b) => a.personId.localeCompare(b.personId))) {
    const slots = [...new Set(entry.slotBySource.values())].sort((a, b) => a - b);
    if (slots.length < 2) continue;
    const sourceIds = [...entry.slotBySource.keys()].sort();
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES,
        `sources ${sourceIds.map((id) => `"${id}"`).join(' and ')} rank "${entry.personId}" differently on team "${parsed.teamId}" (slots ${slots.join(' and ')}); the lowest is used to order the export and neither source is treated as correct`,
        {
          teamId: parsed.teamId,
          disagreement: COACH_ORDER_DISAGREEMENT.PERSON_RANKED_DIFFERENTLY,
          personId: entry.personId,
          slots,
          sourceIds,
          appliedSlot: slots[0],
        }
      )
    );
  }

  // Order disagreement, second shape: **one slot, two people.** This is the one
  // that matters most and the one a person-keyed check cannot see — two sources
  // that name entirely different coaches, each at slot 1, disagree about who is
  // first without ranking anybody differently. It is exactly "the sources
  // disagree about who is primary", and under the old model whichever file you
  // opened decided.
  /** @type {Map<number, Map<string, string[]>>} */
  const occupantsBySlot = new Map();
  for (const source of parsed.sources) {
    for (const coach of source.coaches) {
      if (coach.slot == null) continue;
      if (!occupantsBySlot.has(coach.slot)) occupantsBySlot.set(coach.slot, new Map());
      const bySource = /** @type {Map<string, string[]>} */ (occupantsBySlot.get(coach.slot));
      bySource.set(source.sourceId, [...(bySource.get(source.sourceId) ?? []), coach.personId]);
    }
  }
  for (const [slot, bySource] of [...occupantsBySlot.entries()].sort((a, b) => a[0] - b[0])) {
    if (bySource.size < 2) continue;
    const readings = [...bySource.values()].map((ids) => [...ids].sort().join('+'));
    if (new Set(readings).size < 2) continue;
    const sourceIds = [...bySource.keys()].sort();
    const personIds = [...new Set([...bySource.values()].flat())].sort();
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES,
        `sources ${sourceIds.map((id) => `"${id}"`).join(' and ')} put different people in coach slot ${slot} on team "${parsed.teamId}" (${personIds.join(', ')}); every one of them is exported and none is treated as the team's primary`,
        {
          teamId: parsed.teamId,
          disagreement: COACH_ORDER_DISAGREEMENT.SLOT_OCCUPIED_DIFFERENTLY,
          slot,
          personIds,
          sourceIds,
        }
      )
    );
  }

  // Membership disagreement: a source that named anybody for this team, and
  // omitted somebody another source named.
  const namingSources = parsed.sources.filter((source) => source.coaches.length > 0);
  if (namingSources.length > 1) {
    for (const source of namingSources) {
      const named = new Set(source.coaches.map((coach) => coach.personId));
      const missing = coaches
        .filter((coach) => !named.has(coach.personId))
        .map((coach) => coach.personId);
      if (missing.length === 0) continue;
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.COACH_LIST_SOURCE_INCOMPLETE,
          `source "${source.sourceId}" names ${named.size} of the ${coaches.length} coach(es) team "${parsed.teamId}" has; the union is exported, so a check keyed off this source alone would miss ${missing.join(', ')}`,
          {
            teamId: parsed.teamId,
            sourceId: source.sourceId,
            namedCount: named.size,
            totalCount: coaches.length,
            missingPersonIds: [...missing].sort(),
          }
        )
      );
    }
  }

  // **Cross-checked, not agreed.** Two sources that flatly contradict each
  // other still cross-checked the order; what they did not do is agree, and the
  // `COACH_ORDER_SOURCE_DISAGREES` findings are where that lives. Naming this
  // "corroborated" would let a consumer read contradiction as agreement, which
  // is the folding-unknown-into-agreement failure this module exists to stop.
  const orderCrossChecked = rankingSources.length > 1;
  if (coaches.length > 0 && !orderCrossChecked) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.COACH_LIST_UNCORROBORATED,
        `team "${parsed.teamId}" has its coach order from ${rankingSources.length} source(s), so nothing cross-checked it; this is "unchecked", not "agreed"`,
        {
          teamId: parsed.teamId,
          rankingSourceIds: [...rankingSources].sort(),
          sourcesRead: parsed.sources.length,
        }
      )
    );
  }

  return {
    teamId: parsed.teamId,
    coaches: Object.freeze(coaches),
    personIds: Object.freeze(coaches.map((coach) => coach.personId)),
    orderCrossChecked,
    findings,
    meta,
    status: derivePeopleStatus(findings),
  };
}

/**
 * How a reconciled coach prints in an artifact: the display name if there is
 * one, else the person id.
 *
 * The id fallback is deliberate. A team whose coach has no name on file still
 * appears on the export with something an operator can look up, which is the
 * whole difference between "this team has three coaches, one of whom we cannot
 * name" and a silently shorter list.
 *
 * @param {{ personId: string, displayName: string|null }} coach
 * @returns {string}
 */
export function coachDisplayText(coach) {
  return coach.displayName ?? coach.personId;
}

/** The separator between coaches in an export cell. */
export const COACH_CELL_SEPARATOR = '; ';

/**
 * One value, safe to put in a `; `-separated cell.
 *
 * A value containing the separator would split into two entries and shift
 * every coach after it against the parallel email cell — the misalignment this
 * pair of functions exists to prevent, arriving through the data instead of
 * through the code. Replaced rather than escaped, because the cell's contract
 * is "split on `; `" and a reader that has to know an escaping scheme is a
 * reader who will get it wrong.
 *
 * @param {string} value
 * @returns {string}
 */
function cellSafe(value) {
  return value.includes(';') ? value.replace(/;/g, ',') : value;
}

/**
 * A team's coaches as one export cell: every coach, in order, `; `-separated.
 *
 * One column, no roles. The order is the clash-breaking order and the column
 * header says so; it does not say head and assistant, because this model does
 * not know which — and, for the rec league this corpus comes from, neither does
 * the league.
 *
 * @param {ReadonlyArray<{ personId: string, displayName: string|null }>} coaches
 * @returns {string}
 */
export function formatCoachList(coaches) {
  return coaches.map((coach) => cellSafe(coachDisplayText(coach))).join(COACH_CELL_SEPARATOR);
}

/**
 * A team's coach emails as one export cell, **positionally beside the names**.
 *
 * A coach with no address on file contributes an **empty slot**, not nothing.
 * Dropping them shortened this cell against its sibling, so the two no longer
 * lined up: `Coaches: "Ada; Bo; Cy"` beside `Coach Emails: "ada@x; cy@x"` sends
 * the second coach's mail to the third coach's address. That is a
 * wrong-recipient defect in a family-facing artifact, produced by two functions
 * with two different rules about what to skip.
 *
 * There is now one rule — every coach occupies one position in both cells — and
 * {@link coachExportCells} refuses to emit a pair that does not.
 *
 * @param {ReadonlyArray<{ email: string|null }>} coaches
 * @returns {string}
 */
export function formatCoachEmails(coaches) {
  return coaches
    .map((coach) => (coach.email == null ? '' : cellSafe(coach.email)))
    .join(COACH_CELL_SEPARATOR);
}

/**
 * **The pair, produced together and checked against each other.**
 *
 * Every export builds both cells here rather than calling the two formatters
 * itself, so no projection can acquire its own opinion about which coaches to
 * skip. The check is on the cells a consumer will actually split, not on the
 * list they came from: a list-length comparison would be trivially true and
 * would have said nothing about the defect it exists to catch.
 *
 * @param {ReadonlyArray<{ personId: string, displayName: string|null, email: string|null }>} coaches
 * @returns {Readonly<{ coaches: string, emails: string }>}
 */
export function coachExportCells(coaches) {
  const names = formatCoachList(coaches);
  const emails = formatCoachEmails(coaches);
  const nameCount = names.split(COACH_CELL_SEPARATOR).length;
  const emailCount = emails.split(COACH_CELL_SEPARATOR).length;
  if (nameCount !== emailCount) {
    throw new Error(
      `people: a team's coach cells do not line up — ${nameCount} name slot(s) against ${emailCount} address slot(s) (${JSON.stringify(names)} / ${JSON.stringify(emails)}); a consumer splitting both on "${COACH_CELL_SEPARATOR}" would pair a coach with somebody else's address`
    );
  }
  return Object.freeze({ coaches: names, emails });
}

/**
 * An empty string is an *absent* value, not a name.
 *
 * The legacy export literally wrote `coachName: team.coachName ?? ''`, so `''`
 * is this codepath's established spelling for "nobody on file" and a schema
 * that rejected it would turn a blank cell into a thrown `ZodError` inside a
 * click handler. Normalised here, at the boundary, rather than relaxed in the
 * schema — the schema's job stays "a name is a non-empty string".
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function blankToNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * A field that must be a list of coach values, refused **by name** when it is
 * not one.
 *
 * `practiceScheduling.listTeamCoachIds()` throws
 * `team <id> assistantCoachIds must be an array when provided` for exactly this,
 * "so a malformed team never passes as conflict-free", and the app-side
 * `utils/teamCoaches.js` adopted the same contract. This function is the third
 * site and takes the same one rather than inventing another.
 *
 * The shape that made it necessary is not hypothetical: a Postgres `uuid[]`
 * read through a client that does not parse array literals arrives as the
 * **string** `'{c2,c3}'`. A bare `.map()` on it threw a raw `TypeError` from
 * inside the export and took the whole artifact down; spreading it instead
 * would have been worse, producing one coach per character.
 *
 * @param {unknown} value
 * @param {string} field - for the message only
 * @param {Object} team - for the message only
 * @returns {unknown[]}
 */
function coachFieldList(value, field, team) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(
      `team ${team?.id ?? '(unidentified)'} ${field} must be an array when provided; received ${typeof value === 'string' ? JSON.stringify(value) : typeof value}`
    );
  }
  return value;
}

/**
 * The legacy `{ coachId, assistantCoachIds }` / `{ coachName, assistantCoaches }`
 * team shape as one {@link reconcileTeamCoaches} source.
 *
 * The order the legacy shape carries **is** kept — it is the club's declared
 * order and slot is exactly that — so `coachId` becomes slot 1 and each
 * assistant the next slot. What is dropped is the claim that slot 1 is a
 * different *kind* of coach.
 *
 * Ids, names and emails are zipped positionally, which is the only
 * correspondence the legacy shape offers. When one list is longer the extra
 * entries are still exported, keyed by whichever half exists, because a coach
 * with a name and no id is still a coach on that team. Blank cells are absent
 * values, not empty names: see {@link blankToNull}.
 *
 * @param {Object} team
 * @param {string} sourceId
 * @returns {{ sourceId: string, coaches: Array<{ personId: string, displayName: string|null, email: string|null, slot: number }> }}
 */
export function legacyTeamCoachSource(team, sourceId) {
  const ids = [
    blankToNull(team.coachId ?? team.coach_id),
    ...coachFieldList(
      team.assistantCoachIds ?? team.assistant_coach_ids,
      'assistantCoachIds',
      team
    ).map(blankToNull),
  ];
  const names = [
    blankToNull(team.coachName),
    ...coachFieldList(
      team.assistantCoaches ?? team.assistant_coaches,
      'assistantCoaches',
      team
    ).map(blankToNull),
  ];
  // Co-coach addresses, positionally beside the assistant ids. Without this the
  // per-coach email drafts could only ever reach the first coach, which is the
  // same truncation in the artifact that actually reaches a person.
  const emails = [
    blankToNull(team.coachEmail),
    ...coachFieldList(
      team.assistantCoachEmails ?? team.assistant_coach_emails,
      'assistantCoachEmails',
      team
    ).map(blankToNull),
  ];

  // `emails` counts toward the length: a row carrying an address for somebody it
  // does not otherwise name still names a person, and dropping them is the
  // truncation this whole change is about. Such an entry keys off the address,
  // which is the only identity the row offers for them.
  const length = Math.max(ids.length, names.length, emails.length);
  /** @type {Array<{ personId: string, displayName: string|null, email: string|null, slot: number }>} */
  const coaches = [];
  for (let index = 0; index < length; index += 1) {
    const id = ids[index] ?? null;
    const name = names[index] ?? null;
    const email = emails[index] ?? null;
    if (id === null && name === null && email === null) continue;
    coaches.push({
      personId: String(id ?? name ?? email),
      displayName: name,
      email,
      // The position in the legacy list, holes kept. A team whose `coachId` is
      // null but whose assistants are present has a vacant first position, and
      // renumbering would silently promote somebody into it.
      slot: index + 1,
    });
  }
  return { sourceId, coaches };
}

/**
 * Every source a team row states its coaches through — **the one contract**.
 *
 * Three call sites needed this (`outputGeneration.js`, `reserve/publication.js`
 * and the app's `utils/teamCoaches.js`) and three copies would be three
 * contracts: the first draft of this change had the frontend copy silently
 * ignoring `team.coaches`, so a team already in the reconciled shape read as
 * uncoached in the UI while exporting three coaches to CSV. `CLAUDE.md` §3 —
 * adopt the sibling's contract rather than inventing a third one — with the
 * sibling extracted so there is only one.
 *
 * A row carrying both spellings contributes both, so the two are *compared*
 * rather than one silently winning.
 *
 * @param {Object} team
 * @returns {Array<{ sourceId: string, coaches: Array<Object> }>}
 */
export function teamCoachSources(team) {
  /** @type {Array<{ sourceId: string, coaches: Array<Object> }>} */
  const sources = [];
  if (Array.isArray(team?.coaches) && team.coaches.length > 0) {
    sources.push({
      sourceId: 'team.coaches',
      coaches: team.coaches.map((/** @type {any} */ coach, /** @type {number} */ index) => ({
        personId: String(
          blankToNull(coach.personId) ??
            blankToNull(coach.id) ??
            blankToNull(coach.name) ??
            index + 1
        ),
        displayName: blankToNull(coach.displayName ?? coach.name),
        email: blankToNull(coach.email),
        slot: coach.slot ?? null,
      })),
    });
  }
  // Pushed **even when empty**: "this row names nobody" is a reading, and
  // dropping it would leave the reconciliation with zero sources, which is the
  // caller-bug case `COACH_LIST_SCAN_VACUOUS` is reserved for.
  sources.push(legacyTeamCoachSource(team ?? {}, 'team.coachName+assistantCoaches'));
  return sources;
}

/**
 * A team row's coaches, reconciled, with the findings.
 *
 * The single entry every artifact uses, so "who coaches this team" has one
 * answer whichever projection asked.
 *
 * @param {Object} team
 * @param {string} [teamId] - defaults to `team.id`
 * @returns {import('./types.js').TeamCoachList}
 */
export function coachesOfTeamRow(team, teamId = undefined) {
  return reconcileTeamCoaches({
    teamId: String(teamId ?? team?.id ?? 'team'),
    sources: teamCoachSources(team),
  });
}
