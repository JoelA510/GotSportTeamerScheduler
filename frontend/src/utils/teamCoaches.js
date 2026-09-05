/**
 * A team's coaches, all of them, in the club's declared order.
 *
 * ## Why this exists (8.2)
 *
 * A team row reaches the app under half a dozen spellings — `coach_id`,
 * `coachId`, a joined `coach` profile, `assistant_coach_ids`,
 * `assistantCoachIds`, `headCoach`, `assistantCoaches` — and every component
 * that wanted "the coach" picked one of them with `??` and stopped. Two things
 * went wrong as a result:
 *
 * 1. **Everyone after the first was invisible.** `RosterManager` printed one
 *    name; the roster export wrote one column; the practice override panel
 *    compared one id.
 * 2. **`headCoach` is produced by nothing.** Search the repo: outside
 *    `mockSupabaseClient.js`'s seed rows, no query selects it, no mapper writes
 *    it and no migration declares it. `PracticeOverridePanel` opened its
 *    conflict check with `if (!team.headCoach) return null`, so on real data the
 *    check returned "no conflict" for every override it was ever asked about —
 *    a check that matches zero records, which `CLAUDE.md` §3 calls a loud
 *    failure rather than a silent pass.
 *
 * This module is the app's single entry to the core reconciliation in
 * `people/coachList.js`. It normalises the spellings, hands them over as one
 * source, and returns every coach in order. The order is the clash-breaker the
 * roster model defends; it is **not** a role, and nothing here labels an entry
 * head or assistant.
 *
 * @module utils/teamCoaches
 */

import { coachDisplayText, coachesOfTeamRow } from '@squadlogic/core/people/coachList.js';

/**
 * A value as text, keeping `null` as `null`.
 *
 * `String(null)` is the string `'null'`, and the assistant lists deliberately
 * carry a null where a coach's row could not be resolved — so a bare
 * `.map(String)` printed a coach literally named `null` in the roster CSV. An
 * absent value stays absent all the way to the artifact.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function text(value) {
  if (value === null || value === undefined) return null;
  const asText = String(value).trim();
  return asText === '' ? null : asText;
}

/**
 * A field that must be an array of coach values, refused by name when it is not.
 *
 * `listTeamCoachIds()` in the core throws a named `TypeError` for a non-array
 * `assistantCoachIds` "so a malformed team never passes as conflict-free". A
 * bare spread here would take a JSON string apart into one bogus coach per
 * character, which is the silent corruption that contract exists to prevent —
 * so the sibling's contract is adopted rather than a third one invented.
 *
 * @param {unknown} value
 * @param {string} field - for the message only
 * @returns {unknown[]}
 */
function asList(value, field) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`team ${field} must be an array when provided`);
  }
  return value;
}

/**
 * A joined profile row as a display name, or null.
 *
 * @param {any} profile
 * @returns {string|null}
 */
function profileName(profile) {
  const row = Array.isArray(profile) ? profile[0] : profile;
  if (!row) return null;
  if (row.name) return String(row.name);
  if (row.full_name) return String(row.full_name);
  const parts = [row.first_name, row.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * The team row's coach ids and names, in declared order, under one spelling.
 *
 * @param {any} team
 * @returns {Object}
 */
function normalizeTeamCoachFields(team) {
  const profile = team?.coach;
  const assistantCoachIds = asList(
    team?.assistantCoachIds ?? team?.assistant_coach_ids,
    'assistantCoachIds'
  ).map(text);
  // Padded to the id list. `legacyTeamCoachSource()` zips the three lists
  // positionally, so a producer that *filtered* its names rather than padding
  // them would attach the second assistant's name to the first assistant's id
  // and print the wrong person as that coach.
  const pad = (values, field) => {
    const list = asList(values, field).map(text);
    while (list.length < assistantCoachIds.length) list.push(null);
    return list;
  };
  return {
    coachId: text(team?.coachId ?? team?.coach_id ?? profile?.id),
    assistantCoachIds,
    coachName:
      team?.headCoach ?? team?.coachName ?? team?.coach_name ?? profileName(profile) ?? null,
    coachEmail: text(
      team?.coachEmail ??
        team?.coach_email ??
        team?.headCoachEmail ??
        (Array.isArray(profile) ? profile[0]?.email : profile?.email)
    ),
    assistantCoaches: pad(team?.assistantCoaches ?? team?.assistant_coaches, 'assistantCoaches'),
    assistantCoachEmails: pad(
      team?.assistantCoachEmails ?? team?.assistant_coach_emails,
      'assistantCoachEmails'
    ),
    // Carried through verbatim: a row already in the reconciled shape is the
    // contract the core artifacts accept, and dropping it here is how the app
    // came to read a fully-coached team as vacant.
    coaches: team?.coaches,
  };
}

/**
 * Every coach on a team, ordered, through the core reconciliation.
 *
 * @param {any} team
 * @returns {Array<{ personId: string, displayName: string|null, email: string|null, slot: number|null }>}
 */
export function teamCoaches(team) {
  if (!team) return [];
  return [...coachesOfTeamRow(normalizeTeamCoachFields(team), team.id ?? 'team').coaches];
}

/**
 * Every coach's identity key on a team, ordered.
 *
 * These are what a conflict check compares. A coach known only by name keys by
 * that name — which is weaker than an id and is exactly what the old model hid,
 * so it is included rather than dropped.
 *
 * @param {any} team
 * @returns {string[]}
 */
export function teamCoachKeys(team) {
  return teamCoaches(team).map((coach) => coach.personId);
}

/**
 * Every coach's display text on a team, ordered.
 *
 * **Names only.** The core `coachDisplayText()` falls back to the person id so
 * an export never silently shortens a list, and that is right for a CSV an
 * operator can join on. It is wrong on screen: the app's own team rows carry
 * ids and no names, so the same fallback would put raw UUIDs in a team picker
 * where the old code printed nothing at all. {@link formatTeamCoaches} counts
 * the nameless ones instead of naming them.
 *
 * @param {any} team
 * @returns {string[]}
 */
export function teamCoachNames(team) {
  return teamCoaches(team)
    .filter((coach) => coach.displayName)
    .map(coachDisplayText);
}

/**
 * How many of a team's coaches this row carries no name for.
 *
 * @param {any} team
 * @returns {number}
 */
export function unnamedTeamCoachCount(team) {
  return teamCoaches(team).filter((coach) => !coach.displayName).length;
}

/**
 * A team's coaches as one human-readable string.
 *
 * A coach the row cannot name is **counted, never printed as an id and never
 * dropped**: "Ada Stone + 1 more (name not loaded)" says the team has two
 * coaches, which neither a UUID nor a silently shorter list does.
 *
 * @param {any} team
 * @param {string} [fallback] - what to print when the team has no coach at all
 * @returns {string}
 */
export function formatTeamCoaches(team, fallback = '') {
  const names = teamCoachNames(team);
  const unnamed = unnamedTeamCoachCount(team);
  const unnamedText = `${unnamed} ${unnamed === 1 ? 'name' : 'names'} not loaded`;
  if (names.length === 0) return unnamed === 0 ? fallback : `${unnamed} on file, ${unnamedText}`;
  if (unnamed === 0) return names.join(', ');
  return `${names.join(', ')} + ${unnamed} more (${unnamedText})`;
}

/**
 * The coaches two teams share, ordered.
 *
 * The whole point of the change: a shared *assistant* is a shared coach, and a
 * check that compared only the first entry could not see one.
 *
 * @param {any} teamA
 * @param {any} teamB
 * @returns {string[]}
 */
export function sharedCoachKeys(teamA, teamB) {
  const other = new Set(teamCoachKeys(teamB));
  return teamCoachKeys(teamA).filter((key) => other.has(key));
}

/**
 * The shared coaches of two teams, as display text.
 *
 * @param {any} teamA
 * @param {any} teamB
 * @returns {string[]}
 */
export function sharedCoachNames(teamA, teamB) {
  const shared = new Set(sharedCoachKeys(teamA, teamB));
  return teamCoaches(teamA)
    .filter((coach) => shared.has(coach.personId) && coach.displayName)
    .map(coachDisplayText);
}

/**
 * A team's coach keys as a set, for a caller comparing many teams.
 *
 * Every `teamCoaches()` call runs a `.strict()` Zod parse, so a conflict check
 * that re-derived both teams' coaches inside a loop over every staged
 * assignment did that parse thousands of times per render. Callers build this
 * once per team and compare sets.
 *
 * @param {ReadonlyArray<any>} teams
 * @returns {Map<string, Set<string>>} keyed by `String(team.id)`
 */
export function coachKeysByTeamId(teams) {
  return new Map((teams ?? []).map((team) => [String(team?.id), new Set(teamCoachKeys(team))]));
}
