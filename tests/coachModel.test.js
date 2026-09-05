/**
 * One coach model (Phase 8.2).
 *
 * Two questions, and both are answered against the season-2026 corpus rather
 * than against a fixture written to agree with the code:
 *
 * 1. **Does every artifact list every coach?** The subject set is enumerated
 *    from the *roster*, never from the export — a team dropped by the projection
 *    is exactly what is missing from the projection, and a check that took its
 *    universe from there would compare a set against itself. `CLAUDE.md` §3
 *    names that shape; it has been found in this repository three times.
 * 2. **Is a disagreement surfaced rather than settled?** The corpus carries the
 *    case: `coach_roster.csv` and the practice corpus's `select_coaches.csv`
 *    both rank the Select teams' coaches and disagree on eight of them. No team
 *    code is written down here — the disagreeing set is derived, and the test
 *    asserts the *shape* of the disagreement and that it is non-empty.
 *
 * Every coverage assertion below has its failing case constructed beside it. A
 * meta-assertion nobody can make fail is not a meta-assertion.
 */

import { describe, expect, it } from 'vitest';

import { loadCoachRoster, loadSeason2026Practice } from '@squadlogic/core/fixtures/index.js';
import { evaluateGameSchedule } from '@squadlogic/core/gameMetrics.js';
import { generateScheduleExports } from '@squadlogic/core/outputGeneration.js';
import { scheduleGames } from '@squadlogic/core/gameScheduling.js';
import {
  COACH_ORDER_DISAGREEMENT,
  PEOPLE_REASON,
  buildSeason2026CoachRoster,
  coachesOfTeamRow,
  compareCoaches,
  formatCoachEmails,
  formatCoachList,
  legacyTeamCoachSource,
  reconcileTeamCoaches,
  teamCoachSources,
} from '@squadlogic/core/people/index.js';
import { makeUnplacedFixture, publicationRowsFor } from '@squadlogic/core/reserve/index.js';

/** Codes present on a reconciliation result. */
const codesOf = (result) => result.findings.map((finding) => finding.code);

/** Findings of one code. */
const withCode = (findings, code) => findings.filter((finding) => finding.code === code);

/* ========================================================================== */
/* The reconciliation itself, with a failing case beside every check           */
/* ========================================================================== */

describe('coach model :: reconcileTeamCoaches surfaces disagreement instead of picking a side', () => {
  const rosterSource = {
    sourceId: 'roster-sheet',
    coaches: [
      { personId: 'p1', slot: 1, displayName: 'One', email: 'one@example.test' },
      { personId: 'p2', slot: 2, displayName: 'Two' },
    ],
  };

  it('exports the union of both sources, never one of them', () => {
    const result = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [rosterSource, { sourceId: 'select-sheet', coaches: [{ personId: 'p3', slot: 3 }] }],
    });
    expect(result.personIds).toEqual(['p1', 'p2', 'p3']);
    expect(result.meta.coachesExported).toBe(3);
  });

  it('reports one person ranked differently by two sources, and applies neither', () => {
    const result = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [rosterSource, { sourceId: 'select-sheet', coaches: [{ personId: 'p2', slot: 1 }] }],
    });
    const disagreements = withCode(result.findings, PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES);
    const ranked = disagreements.filter(
      (finding) =>
        finding.details.disagreement === COACH_ORDER_DISAGREEMENT.PERSON_RANKED_DIFFERENTLY
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].details.personId).toBe('p2');
    expect(ranked[0].details.slots).toEqual([1, 2]);
    // Both sources are named. Neither is called correct.
    expect(ranked[0].details.sourceIds).toEqual(['roster-sheet', 'select-sheet']);
  });

  it('reports two sources putting different people in slot 1 — "who is primary" itself', () => {
    const result = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [
        { sourceId: 'roster-sheet', coaches: [{ personId: 'p1', slot: 1 }] },
        { sourceId: 'select-sheet', coaches: [{ personId: 'p9', slot: 1 }] },
      ],
    });
    const occupancy = withCode(result.findings, PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES).filter(
      (finding) =>
        finding.details.disagreement === COACH_ORDER_DISAGREEMENT.SLOT_OCCUPIED_DIFFERENTLY
    );
    expect(occupancy).toHaveLength(1);
    expect(occupancy[0].details.slot).toBe(1);
    expect(occupancy[0].details.personIds).toEqual(['p1', 'p9']);
    // Both are exported. Neither is dropped for losing an argument.
    expect(result.personIds).toEqual(['p1', 'p9']);
  });

  it('POSITIVE CONTROL: two sources that agree raise no order disagreement at all', () => {
    const result = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [rosterSource, { ...rosterSource, sourceId: 'select-sheet' }],
    });
    expect(codesOf(result)).not.toContain(PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES);
    expect(codesOf(result)).not.toContain(PEOPLE_REASON.COACH_LIST_SOURCE_INCOMPLETE);
    // …and the same inputs with one slot moved *do* raise it, so the negative
    // above is a fact about the data and not about the check.
    const moved = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [
        rosterSource,
        {
          sourceId: 'select-sheet',
          coaches: [
            { personId: 'p2', slot: 1 },
            { personId: 'p1', slot: 2 },
          ],
        },
      ],
    });
    expect(codesOf(moved)).toContain(PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES);
  });

  it('names the source that omits a coach, and still exports the omitted one', () => {
    const result = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [rosterSource, { sourceId: 'select-sheet', coaches: [{ personId: 'p1', slot: 1 }] }],
    });
    const incomplete = withCode(result.findings, PEOPLE_REASON.COACH_LIST_SOURCE_INCOMPLETE);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].details.sourceId).toBe('select-sheet');
    expect(incomplete[0].details.missingPersonIds).toEqual(['p2']);
    expect(result.personIds).toContain('p2');
  });

  it('says "unchecked" rather than "agreed" when only one source ranks the team', () => {
    const single = reconcileTeamCoaches({ teamId: 'team-a', sources: [rosterSource] });
    expect(codesOf(single)).toContain(PEOPLE_REASON.COACH_LIST_UNCORROBORATED);
    expect(single.orderCrossChecked).toBe(false);

    // POSITIVE CONTROL: a second ranking source removes it, so the code is
    // about corroboration and not a constant.
    const both = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [rosterSource, { ...rosterSource, sourceId: 'select-sheet' }],
    });
    expect(codesOf(both)).not.toContain(PEOPLE_REASON.COACH_LIST_UNCORROBORATED);
    expect(both.orderCrossChecked).toBe(true);
  });

  it('reports an unranked coach rather than folding them into the end of the order', () => {
    const result = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [
        { sourceId: 'roster-sheet', coaches: [{ personId: 'p1', slot: 1 }, { personId: 'p2' }] },
      ],
    });
    const undeclared = withCode(result.findings, PEOPLE_REASON.COACH_SLOT_UNDECLARED);
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0].details.personId).toBe('p2');
    // Exported, last, and with a null slot rather than a very large one.
    expect(result.personIds).toEqual(['p1', 'p2']);
    expect(result.coaches[1].slot).toBeNull();

    // POSITIVE CONTROL: give p2 a slot and the code goes away.
    const ranked = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [
        {
          sourceId: 'roster-sheet',
          coaches: [
            { personId: 'p1', slot: 1 },
            { personId: 'p2', slot: 2 },
          ],
        },
      ],
    });
    expect(codesOf(ranked)).not.toContain(PEOPLE_REASON.COACH_SLOT_UNDECLARED);
  });

  it('calls a reconciliation with no sources vacuous, and a coachless team merely coachless', () => {
    const noSources = reconcileTeamCoaches({ teamId: 'team-a', sources: [] });
    expect(codesOf(noSources)).toContain(PEOPLE_REASON.COACH_LIST_SCAN_VACUOUS);

    // POSITIVE CONTROL for the other half: a source that read the row and found
    // nobody is an **uncoached team**, which `roster.js` reports as
    // `TEAM_UNCOACHED`. Firing the vacuous-scan alarm for every one of those
    // would turn it into noise and stop it meaning anything.
    const coachless = reconcileTeamCoaches({
      teamId: 'team-a',
      sources: [{ sourceId: 'roster-sheet', coaches: [] }],
    });
    expect(codesOf(coachless)).not.toContain(PEOPLE_REASON.COACH_LIST_SCAN_VACUOUS);
    expect(coachless.personIds).toEqual([]);
    expect(coachesOfTeamRow({ id: 'team-a' }).findings).toEqual([]);
  });

  it('orders unranked coaches last, not first, and breaks ties by id', () => {
    expect(
      [
        { personId: 'b', slot: null },
        { personId: 'a', slot: 2 },
      ].sort(compareCoaches)
    ).toEqual([
      { personId: 'a', slot: 2 },
      { personId: 'b', slot: null },
    ]);
    expect(
      [
        { personId: 'b', slot: 1 },
        { personId: 'a', slot: 1 },
      ].sort(compareCoaches)
    ).toEqual([
      { personId: 'a', slot: 1 },
      { personId: 'b', slot: 1 },
    ]);
  });

  it('treats a blank cell as an absent value, not as an empty name', () => {
    // `outputGeneration.js` spelled "nobody on file" as `''` for years, so a
    // schema that rejected it would turn a blank spreadsheet cell into a thrown
    // ZodError inside a click handler.
    expect(() =>
      generateScheduleExports({
        teams: [{ id: 'T1', coachId: 'c1', coachName: '', coachEmail: '' }],
        practiceAssignments: [
          { teamId: 'T1', start: '2026-09-14T22:00:00Z', end: '2026-09-14T23:00:00Z' },
        ],
      })
    ).not.toThrow();
    // A blank id beside a real name keys by the name rather than by `''`.
    expect(
      legacyTeamCoachSource({ id: 't', coachId: '', coachName: 'Only Name' }, 'x').coaches
    ).toEqual([{ personId: 'Only Name', displayName: 'Only Name', email: null, slot: 1 }]);
    // A row that is blank throughout contributes nobody at all.
    expect(legacyTeamCoachSource({ id: 't', coachId: '', coachName: '' }, 'x').coaches).toEqual([]);
  });

  it('carries a co-coach’s own address, so a per-coach artifact can reach them', () => {
    const source = legacyTeamCoachSource(
      {
        id: 't',
        coachId: 'c1',
        coachName: 'One',
        coachEmail: 'one@example.test',
        assistantCoachIds: ['c2'],
        assistantCoaches: ['Two'],
        assistantCoachEmails: ['two@example.test'],
      },
      'team-row'
    );
    expect(source.coaches.map((coach) => coach.email)).toEqual([
      'one@example.test',
      'two@example.test',
    ]);
  });

  it('reads the reconciled `coaches` shape as a source, not only the legacy fields', () => {
    // The frontend helper and the two core projections all go through
    // `teamCoachSources()`; a copy that ignored `team.coaches` made a fully
    // coached team read as vacant in the UI while exporting three names to CSV.
    const sources = teamCoachSources({
      id: 't',
      coaches: [{ personId: 'p1', displayName: 'One', slot: 1 }],
    });
    // Both readings are always present — the empty legacy one says "this row's
    // legacy columns name nobody", which is a fact and not an absence of one.
    expect(sources.map((source) => source.sourceId)).toEqual([
      'team.coaches',
      'team.coachName+assistantCoaches',
    ]);
    expect(sources[1].coaches).toEqual([]);
    expect(coachesOfTeamRow({ id: 't', coaches: [{ personId: 'p1', slot: 1 }] }).personIds).toEqual(
      ['p1']
    );
  });

  it('refuses a non-array coach list by name, and does not die of a raw TypeError', () => {
    // A Postgres `uuid[]` read through a client that does not parse array
    // literals arrives as the string '{c2,c3}'. A bare `.map()` on it threw a
    // raw TypeError from inside the export and took the whole artifact down;
    // spreading it would have produced one coach per character. Both siblings —
    // `listTeamCoachIds()` and the app's `asList()` — throw a named error, and
    // this is the third site taking the same contract.
    for (const malformed of ['{c2,c3}', 42, { a: 1 }]) {
      expect(() =>
        generateScheduleExports({
          teams: [{ id: 'T1', coachId: 'c1', assistant_coach_ids: malformed }],
          practiceAssignments: [
            { teamId: 'T1', start: '2026-09-14T22:00:00Z', end: '2026-09-14T23:00:00Z' },
          ],
        })
      ).toThrow(/team T1 assistantCoachIds must be an array when provided/);
    }
    expect(() => legacyTeamCoachSource({ id: 'T1', assistantCoaches: 'Bo' }, 'x')).toThrow(
      /team T1 assistantCoaches must be an array when provided/
    );
    expect(() => legacyTeamCoachSource({ id: 'T1', assistant_coach_emails: 'bo@x' }, 'x')).toThrow(
      /team T1 assistantCoachEmails must be an array when provided/
    );

    // POSITIVE CONTROL: the well-formed shape still exports both coaches, so
    // the guard rejects the malformed input rather than everything.
    const exports = generateScheduleExports({
      teams: [{ id: 'T1', coachId: 'c1', assistantCoachIds: ['c2'] }],
      practiceAssignments: [
        { teamId: 'T1', start: '2026-09-14T22:00:00Z', end: '2026-09-14T23:00:00Z' },
      ],
    });
    expect(exports.master.rows[0].Coaches).toBe('c1; c2');
    // Absent is still absent, not an error.
    expect(legacyTeamCoachSource({ id: 'T1', coachId: 'c1' }, 'x').coaches).toHaveLength(1);
  });

  it('keeps a hole in the legacy list rather than promoting somebody into it', () => {
    const source = legacyTeamCoachSource(
      { id: 't', coachId: null, assistantCoachIds: ['a1'] },
      'team-row'
    );
    expect(source.coaches).toEqual([{ personId: 'a1', displayName: null, email: null, slot: 2 }]);
  });
});

/* ========================================================================== */
/* Acceptance 1: every artifact lists every coach, zero teams truncated        */
/* ========================================================================== */

describe('coach model :: the schedule export truncates no team against the corpus roster', () => {
  const roster = buildSeason2026CoachRoster(loadCoachRoster());

  /** The subject set: teams, and their coaches, **from the roster**. */
  const rosterTeams = [...roster.teams.values()].filter((team) => team.personIds.length > 0);

  /** Teams in the shape the export accepts, carrying every coach. */
  const exportTeams = rosterTeams.map((team) => ({
    id: team.teamId,
    name: team.teamId,
    division: 'derived-at-test-time',
    coaches: team.slots.map((assignment) => ({
      personId: assignment.personId,
      displayName: assignment.personId,
      slot: assignment.slot,
    })),
  }));

  /** The same teams under the old head-coach-only shape, for the control. */
  const truncatedTeams = rosterTeams.map((team) => ({
    id: team.teamId,
    name: team.teamId,
    division: 'derived-at-test-time',
    coachName: team.slots[0].personId,
  }));

  const practiceAssignments = rosterTeams.map((team) => ({
    teamId: team.teamId,
    start: '2026-09-14T22:00:00Z',
    end: '2026-09-14T23:00:00Z',
  }));

  /**
   * Coach-team pairs the roster carries that a given export does not print.
   *
   * The pairs come from the roster; the rows are looked up by team id. A team
   * with no row at all therefore counts every one of its coaches as missing,
   * rather than disappearing from the comparison.
   *
   * @param {{ master: { rows: Array<Object> } }} exports
   * @returns {string[]}
   */
  function missingCoachPairs(exports) {
    const cellByTeam = new Map(
      exports.master.rows.map((row) => [row['Team ID'], String(row.Coaches ?? '')])
    );
    /** @type {string[]} */
    const missing = [];
    for (const team of rosterTeams) {
      const cell = cellByTeam.get(team.teamId);
      for (const personId of team.personIds) {
        if (cell === undefined || !cell.split('; ').includes(personId)) {
          missing.push(`${team.teamId}|${personId}`);
        }
      }
    }
    return missing;
  }

  it('exercises a corpus with co-coached teams in it, or says so loudly', () => {
    // Meta-assertion: without multi-coach teams the acceptance below is
    // vacuously true, so the shape of the corpus is asserted first.
    const multiCoach = rosterTeams.filter((team) => team.personIds.length > 1);
    expect(rosterTeams.length).toBe(roster.teams.size);
    expect(rosterTeams.length).toBeGreaterThan(100);
    expect(multiCoach.length).toBeGreaterThan(50);
    const pairs = rosterTeams.reduce((total, team) => total + team.personIds.length, 0);
    expect(pairs).toBe(roster.meta.assignmentsActive);
    expect(pairs - rosterTeams.length).toBeGreaterThan(50);
  });

  it('prints every roster coach of every roster team', () => {
    const exports = generateScheduleExports({ teams: exportTeams, practiceAssignments });
    expect(missingCoachPairs(exports)).toEqual([]);
    expect(exports.master.headers).not.toContain('Assistant Coaches');
    expect(exports.master.headers).not.toContain('Coach Name');
  });

  it('POSITIVE CONTROL: the head-coach-only shape drops every co-coach, and this check sees it', () => {
    const exports = generateScheduleExports({ teams: truncatedTeams, practiceAssignments });
    const missing = missingCoachPairs(exports);
    // One per co-coach: the pairs the roster carries beyond one per team.
    const coCoaches =
      rosterTeams.reduce((total, team) => total + team.personIds.length, 0) - rosterTeams.length;
    expect(missing).toHaveLength(coCoaches);
    expect(coCoaches).toBeGreaterThan(50);
  });

  it('POSITIVE CONTROL: a team whose row is dropped entirely is reported, not skipped', () => {
    const exports = generateScheduleExports({
      teams: exportTeams,
      practiceAssignments: practiceAssignments.slice(1),
    });
    const missing = missingCoachPairs(exports);
    expect(missing.length).toBe(rosterTeams[0].personIds.length);
    expect(missing.every((pair) => pair.startsWith(`${rosterTeams[0].teamId}|`))).toBe(true);
  });

  it('reconciles each team once, however many rows it produces', () => {
    const team = rosterTeams[0];
    const one = publicationRowsFor({
      slots: [],
      unplaced: [
        makeUnplacedFixture({
          fixtureId: 'f1',
          label: 'one',
          homeTeamId: team.teamId,
          reason: 'a fixture constructed by this test',
        }),
      ],
      teams: exportTeams,
    });
    const five = publicationRowsFor({
      slots: [],
      unplaced: [1, 2, 3, 4, 5].map((n) =>
        makeUnplacedFixture({
          fixtureId: `f${n}`,
          label: `fixture ${n}`,
          homeTeamId: team.teamId,
          reason: 'a fixture constructed by this test',
        })
      ),
      teams: exportTeams,
    });
    // Five times the rows, the same facts. Reconciling inside the row builder
    // multiplied one team's findings by its row count.
    expect(five.rows.length).toBe(one.rows.length * 5);
    expect(five.coachFindings.length).toBe(one.coachFindings.length);
    // Meta-assertion: a run with no findings at all would satisfy the equality.
    expect(one.coachFindings.length).toBeGreaterThan(0);
  });

  it('the reserved-slot projection prints the same coaches as the schedule export', () => {
    const team = rosterTeams.find((entry) => entry.personIds.length > 1);
    expect(team).toBeDefined();
    const projected = publicationRowsFor({
      slots: [],
      unplaced: [
        makeUnplacedFixture({
          fixtureId: 'fixture-1',
          label: 'a constructed fixture',
          divisionLabel: 'derived-at-test-time',
          homeTeamId: /** @type {any} */ (team).teamId,
          reason: 'a fixture constructed by this test, with no slot',
        }),
      ],
      teams: exportTeams,
    });
    const row = projected.rows.find((entry) => entry.teamId === /** @type {any} */ (team).teamId);
    expect(row).toBeDefined();
    expect(/** @type {any} */ (row).row.Coaches.split('; ')).toEqual(
      /** @type {any} */ (team).personIds
    );
  });
});

/* ========================================================================== */
/* Acceptance 2: a team whose sources disagree on coach order is surfaced      */
/* ========================================================================== */

describe('coach model :: the corpus disagreement is surfaced, not resolved', () => {
  const roster = buildSeason2026CoachRoster(loadCoachRoster());
  const practice = loadSeason2026Practice();

  /** `select_coaches.csv` grouped by team — the second ranking source. */
  const selectByTeam = new Map();
  for (const row of practice.selectCoaches) {
    if (!selectByTeam.has(row.teamCode)) selectByTeam.set(row.teamCode, []);
    selectByTeam.get(row.teamCode).push(row);
  }

  /** Reconciliations, keyed by team, over the two sources the corpus carries. */
  const reconciled = new Map(
    [...selectByTeam.entries()].map(([teamCode, rows]) => [
      teamCode,
      reconcileTeamCoaches({
        teamId: teamCode,
        sources: [
          {
            sourceId: 'coach_roster.csv',
            coaches: (roster.teams.get(teamCode)?.slots ?? []).map((assignment) => ({
              personId: assignment.personId,
              slot: assignment.slot,
            })),
          },
          {
            sourceId: 'select_coaches.csv',
            coaches: rows.map((row) => ({
              personId: row.personKey,
              slot: row.coachSlot,
              displayName: row.coachName,
            })),
          },
        ],
      }),
    ])
  );

  it('compared a non-empty set of teams against two ranking sources', () => {
    // Meta-assertion: the subject set comes from `select_coaches.csv`, which a
    // break in the *roster* would leave intact. A run that compared nothing
    // would report no disagreement and mean nothing by it.
    expect(reconciled.size).toBeGreaterThan(0);
    expect(reconciled.size).toBe(new Set(practice.selectCoaches.map((r) => r.teamCode)).size);
    for (const result of reconciled.values()) {
      // Cross-checked: both sheets ranked every one of these teams. That is not
      // the same as agreement, and eight of them do not agree.
      expect(result.orderCrossChecked).toBe(true);
    }
  });

  it('names the teams whose two sources disagree about who holds a slot', () => {
    const disagreeing = [...reconciled.entries()].filter(([, result]) =>
      codesOf(result).includes(PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES)
    );
    expect(disagreeing.length).toBeGreaterThan(0);
    // Both shapes occur in this corpus: somebody ranked differently by the two
    // sheets, and slots the two sheets fill with different people.
    const kinds = new Set(
      disagreeing.flatMap(([, result]) =>
        withCode(result.findings, PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES).map(
          (finding) => finding.details.disagreement
        )
      )
    );
    expect([...kinds].sort()).toEqual([
      COACH_ORDER_DISAGREEMENT.PERSON_RANKED_DIFFERENTLY,
      COACH_ORDER_DISAGREEMENT.SLOT_OCCUPIED_DIFFERENTLY,
    ]);

    // Nothing was resolved: every person either source names is still exported.
    for (const [teamCode, result] of disagreeing) {
      const fromRoster = (roster.teams.get(teamCode)?.slots ?? []).map((a) => a.personId);
      const fromSelect = selectByTeam.get(teamCode).map((row) => row.personKey);
      for (const personId of [...fromRoster, ...fromSelect]) {
        expect(result.personIds).toContain(personId);
      }
    }
  });

  it('POSITIVE CONTROL: the roster reconciled against itself disagrees about nothing', () => {
    for (const teamCode of reconciled.keys()) {
      const slots = (roster.teams.get(teamCode)?.slots ?? []).map((assignment) => ({
        personId: assignment.personId,
        slot: assignment.slot,
      }));
      const selfCheck = reconcileTeamCoaches({
        teamId: teamCode,
        sources: [
          { sourceId: 'coach_roster.csv', coaches: slots },
          { sourceId: 'coach_roster.csv (again)', coaches: slots },
        ],
      });
      expect(codesOf(selfCheck)).not.toContain(PEOPLE_REASON.COACH_ORDER_SOURCE_DISAGREES);
      expect(codesOf(selfCheck)).not.toContain(PEOPLE_REASON.COACH_LIST_SOURCE_INCOMPLETE);
    }
  });
});

/* ========================================================================== */
/* The game conflict check now sees co-coaches                                 */
/* ========================================================================== */

describe('coach model :: game coach conflicts are no longer head-coach-only', () => {
  const game = (id, homeTeamId, awayTeamId, start, end) => ({
    id,
    homeTeamId,
    awayTeamId,
    division: 'U10',
    weekIndex: 1,
    slotId: id,
    fieldId: `field-${id}`,
    start,
    end,
  });

  it('reports a person who is one team’s co-coach and another team’s first coach', () => {
    const report = evaluateGameSchedule({
      assignments: [
        game('g1', 'A', 'B', '2026-09-12T14:00:00Z', '2026-09-12T15:00:00Z'),
        game('g2', 'C', 'D', '2026-09-12T14:30:00Z', '2026-09-12T15:30:00Z'),
      ],
      teams: [
        // The shared person is slot 2 on A and slot 1 on C: invisible to a
        // check that read `coachId` alone, which is what this one used to do.
        { id: 'A', name: 'A', division: 'U10', coachId: 'first', assistantCoachIds: ['shared'] },
        { id: 'B', name: 'B', division: 'U10', coachId: 'b-coach' },
        { id: 'C', name: 'C', division: 'U10', coachId: 'shared' },
        { id: 'D', name: 'D', division: 'U10', coachId: 'd-coach' },
      ],
    });
    const conflicts = report.warnings.filter((warning) => warning.type === 'coach-conflict');
    expect(conflicts.map((warning) => warning.details.coachId)).toEqual(['shared']);
  });

  it('does not report a person who coaches both sides of ONE fixture', () => {
    // Widening the check to every coach makes this newly reachable, and it is
    // not a clash: an intra-club fixture is one place at one time. The corpus
    // already contains intra-club rows, so this is a real arrangement.
    const report = evaluateGameSchedule({
      assignments: [game('g1', 'A', 'B', '2026-09-12T14:00:00Z', '2026-09-12T15:00:00Z')],
      teams: [
        { id: 'A', name: 'A', division: 'U10', coachId: 'first', assistantCoachIds: ['shared'] },
        { id: 'B', name: 'B', division: 'U10', coachId: 'shared' },
      ],
    });
    expect(report.warnings.filter((warning) => warning.type === 'coach-conflict')).toEqual([]);
  });

  it('the solver refuses a matchup whose sides share ANY coach, not just the first', () => {
    // The solver and the metric are widened together. Leaving the solver on
    // `coachId` would have it book a clash the report then raises and no rerun
    // could clear — the half-migrated state 8.1 avoided on the practice side.
    const result = scheduleGames({
      teams: [
        { id: 'A', name: 'A', division: 'U10', coachId: 'first', assistantCoachIds: ['shared'] },
        { id: 'B', name: 'B', division: 'U10', coachId: 'shared' },
      ],
      roundRobinByDivision: {
        U10: [{ weekIndex: 1, matchups: [{ homeTeamId: 'A', awayTeamId: 'B' }], byes: [] }],
      },
      slots: [
        {
          id: 'slot-1',
          division: 'U10',
          weekIndex: 1,
          capacity: 1,
          start: '2026-09-12T14:00:00Z',
          end: '2026-09-12T15:00:00Z',
        },
      ],
    });
    expect(result.unscheduled.map((entry) => entry.reason)).toEqual(['coach-coaches-both-teams']);
  });

  it('POSITIVE CONTROL: the same two games with no shared coach report nothing', () => {
    const report = evaluateGameSchedule({
      assignments: [
        game('g1', 'A', 'B', '2026-09-12T14:00:00Z', '2026-09-12T15:00:00Z'),
        game('g2', 'C', 'D', '2026-09-12T14:30:00Z', '2026-09-12T15:30:00Z'),
      ],
      teams: [
        { id: 'A', name: 'A', division: 'U10', coachId: 'first', assistantCoachIds: ['second'] },
        { id: 'B', name: 'B', division: 'U10', coachId: 'b-coach' },
        { id: 'C', name: 'C', division: 'U10', coachId: 'c-coach' },
        { id: 'D', name: 'D', division: 'U10', coachId: 'd-coach' },
      ],
    });
    expect(report.warnings.filter((warning) => warning.type === 'coach-conflict')).toEqual([]);
  });
});

/* ========================================================================== */
/* Rendering: one column, no roles                                             */
/* ========================================================================== */

describe('coach model :: the artifacts render an order, never a role', () => {
  it('joins every coach into one cell and never labels one of them', () => {
    const coaches = [
      { personId: 'p1', displayName: 'One', email: 'one@example.test' },
      { personId: 'p2', displayName: null, email: null },
    ];
    expect(formatCoachList(coaches)).toBe('One; p2');
    expect(formatCoachEmails(coaches)).toBe('one@example.test');
  });

  it('carries no head/assistant vocabulary in the export column set', () => {
    const exports = generateScheduleExports({
      teams: [{ id: 'T1', coaches: [{ personId: 'p1', displayName: 'One', slot: 1 }] }],
      practiceAssignments: [
        { teamId: 'T1', start: '2026-09-14T22:00:00Z', end: '2026-09-14T23:00:00Z' },
      ],
    });
    const vocabulary = exports.master.headers.join(' ').toLowerCase();
    expect(vocabulary).not.toContain('assistant');
    expect(vocabulary).not.toContain('head');
    expect(exports.master.headers).toContain('Coaches');
  });
});
