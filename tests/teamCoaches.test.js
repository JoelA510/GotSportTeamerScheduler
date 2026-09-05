/**
 * The app's coach helper, and the conflict check it brings back to life.
 *
 * `PracticeOverridePanel` opened with `if (!team.headCoach) return null`. Search
 * the repo for a producer of `headCoach`: outside `mockSupabaseClient.js`'s seed
 * rows there is none — no query selects it, no mapper writes it, no migration
 * declares it, and `PracticeSchedulingPage.normalizeTeam()` (the panel's actual
 * source of teams) emits `coachId` and `assistantCoachIds` and never that field.
 * So on real data the panel's conflict check returned "no conflict" for every
 * override it was ever asked about: a check that matches zero records, which
 * `CLAUDE.md` §3 calls a loud failure rather than a silent pass.
 *
 * The first test below is the proof of that claim, taken from the production
 * shape rather than asserted in prose.
 */

import { describe, expect, it } from 'vitest';

import { normalizeTeam } from '../frontend/src/pages/PracticeSchedulingPage.jsx';
import {
  coachKeysByTeamId,
  formatTeamCoaches,
  sharedCoachKeys,
  sharedCoachNames,
  teamCoachKeys,
  teamCoachNames,
  teamCoaches,
  unnamedTeamCoachCount,
} from '../frontend/src/utils/teamCoaches.js';

describe('teamCoaches :: the shape the app actually holds', () => {
  it('the panel’s own team source carries no headCoach — the dead check, demonstrated', () => {
    const normalized = normalizeTeam({
      id: 't1',
      name: 'Team One',
      division: 'U10',
      coach_id: 'coach-a',
      assistant_coach_ids: ['coach-b'],
    });
    expect(normalized.headCoach).toBeUndefined();
    // The old guard: `if (!team.headCoach) return null`. It short-circuits.
    expect(Boolean(normalized.headCoach)).toBe(false);
    // The new one does not, because the row does carry coaches.
    expect(teamCoachKeys(normalized)).toEqual(['coach-a', 'coach-b']);
  });

  it('lists every coach from either spelling of the columns', () => {
    expect(teamCoachKeys({ id: 't', coachId: 'a', assistantCoachIds: ['b', 'c'] })).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(teamCoachKeys({ id: 't', coach_id: 'a', assistant_coach_ids: ['b'] })).toEqual([
      'a',
      'b',
    ]);
  });

  it('reads the reconciled `coaches` shape too, so the app and the export agree', () => {
    const team = {
      id: 't',
      coaches: [
        { personId: 'a', displayName: 'Ada', slot: 1 },
        { personId: 'b', displayName: 'Bo', slot: 2 },
      ],
    };
    expect(teamCoachNames(team)).toEqual(['Ada', 'Bo']);
    expect(formatTeamCoaches(team)).toBe('Ada, Bo');
  });

  it('prefers a name where there is one', () => {
    const team = { id: 't', coach_id: 'coach-a', coach: { first_name: 'Ada', last_name: 'Stone' } };
    expect(teamCoachNames(team)).toEqual(['Ada Stone']);
    expect(formatTeamCoaches({ id: 't' }, 'Vacant')).toBe('Vacant');
  });

  it('keeps an unresolved coach absent instead of naming them "null"', () => {
    // The roster export deliberately passes a null where a coach row could not
    // be resolved. `String(null)` is the string 'null', which printed a coach
    // literally called null in the CSV that goes to the club.
    const coaches = teamCoaches({
      id: 't',
      coach_id: 'a',
      coachName: 'Ada',
      assistant_coach_ids: ['b'],
      assistant_coaches: [null],
      assistant_coach_emails: [null],
    });
    expect(coaches.map((coach) => coach.displayName)).toEqual(['Ada', null]);
    expect(coaches.map((coach) => coach.email)).toEqual([null, null]);
    // The coach is still there — counted, not dropped.
    expect(coaches).toHaveLength(2);
  });

  it('counts a coach it cannot name rather than printing an id at them', () => {
    // The panel's own team rows carry ids and no names; the core export falls
    // back to the id so a CSV never shortens a list, but on screen that put raw
    // UUIDs where the old code printed nothing.
    expect(formatTeamCoaches({ id: 't', coach_id: 'coach-a' })).toBe(
      '1 on file, 1 name not loaded'
    );
    expect(
      formatTeamCoaches({ id: 't', coach_id: 'a', coachName: 'Ada', assistant_coach_ids: ['b'] })
    ).toBe('Ada + 1 more (1 name not loaded)');
    expect(unnamedTeamCoachCount({ id: 't', coach_id: 'a', coachName: 'Ada' })).toBe(0);
    expect(teamCoachNames({ id: 't', coach_id: 'coach-a' })).toEqual([]);
    // …and the key is still there for the conflict check that needs it.
    expect(teamCoachKeys({ id: 't', coach_id: 'coach-a' })).toEqual(['coach-a']);
  });

  it('refuses a non-array coach list by name, as its core sibling does', () => {
    // A bare spread takes a JSON string apart into one bogus coach per
    // character; `listTeamCoachIds()` throws for exactly this reason.
    expect(() => teamCoaches({ id: 't', assistant_coach_ids: 'not-an-array' })).toThrow(
      /assistantCoachIds must be an array/
    );
    expect(() => teamCoaches({ id: 't', assistant_coaches: 42 })).toThrow(
      /assistantCoaches must be an array/
    );
    // Absent is still absent, not an error.
    expect(teamCoaches({ id: 't', coach_id: 'a' })).toHaveLength(1);
  });

  it('pads names and emails to the id list so nobody is attached to the wrong id', () => {
    // A producer that filtered rather than padded would give the second
    // assistant's name to the first assistant's id.
    const coaches = teamCoaches({
      id: 't',
      coach_id: 'a',
      coachName: 'Ada',
      assistant_coach_ids: ['b', 'c'],
      assistant_coaches: ['Bo'],
    });
    expect(coaches.map((coach) => [coach.personId, coach.displayName])).toEqual([
      ['a', 'Ada'],
      ['b', 'Bo'],
      ['c', null],
    ]);
  });

  it('builds every team’s coach keys in one pass, for callers comparing many', () => {
    const map = coachKeysByTeamId([
      { id: 'A', coachId: 'x', assistantCoachIds: ['y'] },
      { id: 'B', coachId: 'y' },
    ]);
    expect([...map.get('A')]).toEqual(['x', 'y']);
    expect([...map.get('B')]).toEqual(['y']);
  });

  it('carries the coach’s own email through, per coach', () => {
    const coaches = teamCoaches({
      id: 't',
      coach_id: 'a',
      coachName: 'Ada',
      coachEmail: 'ada@example.test',
      assistant_coach_ids: ['b'],
      assistant_coaches: ['Bo'],
      assistant_coach_emails: ['bo@example.test'],
    });
    expect(coaches.map((coach) => coach.email)).toEqual(['ada@example.test', 'bo@example.test']);
  });
});

describe('teamCoaches :: a shared co-coach is a shared coach', () => {
  const teamA = { id: 'A', coachId: 'first', assistantCoachIds: ['shared'] };
  const teamB = { id: 'B', coachId: 'shared' };
  const teamC = { id: 'C', coachId: 'other' };

  it('finds a person who is one team’s co-coach and another team’s first coach', () => {
    expect(sharedCoachKeys(teamA, teamB)).toEqual(['shared']);
    // Keys, not names: these rows carry no names, and the message must not put
    // a UUID in front of an admin. The panel counts them instead.
    expect(sharedCoachNames(teamA, teamB)).toEqual([]);
    expect(
      sharedCoachNames(
        {
          id: 'A',
          coachId: 'first',
          coachName: 'One',
          assistantCoachIds: ['shared'],
          assistantCoaches: ['Shared Name'],
        },
        teamB
      )
    ).toEqual(['Shared Name']);
  });

  it('POSITIVE CONTROL: two teams with no coach in common share nobody', () => {
    expect(sharedCoachKeys(teamA, teamC)).toEqual([]);
    // …and the comparison was not vacuous: both teams do have coaches.
    expect(teamCoachKeys(teamA).length).toBeGreaterThan(0);
    expect(teamCoachKeys(teamC).length).toBeGreaterThan(0);
  });

  it('reports every shared coach, not the first one it happens to find', () => {
    expect(
      sharedCoachKeys(
        { id: 'A', coachId: 'x', assistantCoachIds: ['y', 'z'] },
        { id: 'B', coachId: 'y', assistantCoachIds: ['z'] }
      )
    ).toEqual(['y', 'z']);
  });

  it('treats a missing team as sharing nobody rather than throwing', () => {
    expect(sharedCoachKeys(teamA, undefined)).toEqual([]);
    expect(teamCoaches(null)).toEqual([]);
  });
});

describe('teamCoaches :: identity, on the app side of the one rule', () => {
  it('reads the id off an array-embedded `coach` row, so the same person shares a key', () => {
    // The defect: the embed was unwrapped for the name and the address and
    // `id` was read off the array itself — `undefined` — so this coach keyed
    // by name while the same person on another team keyed by id.
    const embedded = [{ id: 'c1', full_name: 'Ada' }];
    expect(/** @type {any} */ (embedded).id).toBeUndefined();
    const viaEmbed = { id: 'A', coach: embedded };
    const viaIds = { id: 'B', assistant_coach_ids: ['c1'] };
    expect(teamCoachKeys(viaEmbed)).toEqual(['c1']);
    expect(sharedCoachKeys(viaEmbed, viaIds)).toEqual(['c1']);
    expect(teamCoachNames(viaEmbed)).toEqual(['Ada']);
  });

  it('keeps a name-only coach on the card and out of the clash keys', () => {
    // Two rows reading "Coach Mike" with no id may be one person or two. The
    // panel must not warn that they clash; the roster card must still show them.
    const A = { id: 'A', coachName: 'Coach Mike' };
    const B = { id: 'B', coachName: 'Coach Mike' };
    expect(teamCoaches(A).map((c) => [c.personId, c.keyKind])).toEqual([['Coach Mike', 'name']]);
    expect(teamCoachKeys(A)).toEqual([]);
    expect(sharedCoachKeys(A, B)).toEqual([]);
    expect(formatTeamCoaches(A)).toBe('Coach Mike');
    // POSITIVE CONTROL: the same two rows with the same id share a key.
    expect(sharedCoachKeys({ ...A, coach_id: 'mike' }, { ...B, coach_id: 'mike' })).toEqual([
      'mike',
    ]);
  });
});
