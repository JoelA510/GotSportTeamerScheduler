/**
 * Importing `fixtures/season-2026/practice/` — the acceptance criteria.
 *
 * `PHASE_8_PLAN.md` §8.4 states five acceptance criteria. Three of them belong
 * to this PR; the other two need persistence and the app, which land above this
 * seam. This file asserts the three, and says plainly which two it does not
 * reach.
 *
 * **Met here**
 * 1. Importing the corpus names all 12 decoder-ring disagreements as
 *    `differing` and applies none of them.
 * 2. The Excel-corrupted availability rows import with their raw value intact
 *    and are flagged for review, not silently accepted.
 * 3. Export then import is the identity on the committed fixtures - asserted in
 *    `tests/fieldAdminRoundTrip.test.js`, which owns that seam.
 *
 * **Not reached by this PR** — retiring a surface that hosts a booked practice,
 * and a blackout added through the UI showing as a conflict. Both need the
 * tables, the RPCs and the pages.
 */

import { describe, it, expect } from 'vitest';

import {
  loadFacilityGeometry,
  loadSeason2026,
  loadSeason2026Practice,
} from '@squadlogic/core/fixtures/index.js';
import {
  ALIAS_LABEL_AGREEMENT,
  buildSeason2026PracticeFacilityGraph,
  buildSeason2026VenueComplexMap,
} from '@squadlogic/core/facility/index.js';
import {
  DISPOSITION,
  FIELD_ADMIN_REASON,
  INTERPRETATION,
  PERMIT_FACILITY_LABELS,
  SEASON_2026_SUBJECTS,
  everySubject,
  WEEKLY_INTERPRETATIONS_ABSENT_FROM_CORPUS,
  WEEKLY_INTERPRETATION_VALUES,
  importSeason2026Fields,
  isInventorySentinel,
  permitFacilityKey,
  projectFieldConstraints,
  projectFieldsRing,
  projectPracticeRing,
} from '@squadlogic/core/fieldAdmin/index.js';

const season = loadSeason2026();
const practice = loadSeason2026Practice({ season });
const graph = buildSeason2026PracticeFacilityGraph(loadFacilityGeometry());
const complexMap = buildSeason2026VenueComplexMap();
const imported = importSeason2026Fields({ practice, graph, complexMap });
/** The ring change set, referenced by more than one block. */
const rings = imported.aliases;

/** Count by a derived key, as a plain object. */
const tally = (items, keyOf) => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const findingsOf = (changeSet, code) =>
  changeSet.findings.filter((finding) => finding.code === code);

/* ========================================================================== */
/* Criterion 1: the 12 decoder-ring disagreements                             */
/* ========================================================================== */

describe('season-2026 field import :: the two decoder rings', () => {
  it('names exactly 12 disagreements as differing', () => {
    expect(rings.buckets.differing).toHaveLength(12);
  });

  it('applies none of them', () => {
    // The other half of the criterion, and the one that matters: a
    // disagreement that is reported and then applied has not been surfaced at
    // all.
    expect(rings.buckets.differing.filter((subject) => subject.applicable)).toEqual([]);
    expect(findingsOf(rings, FIELD_ADMIN_REASON.CHANGE_SET_NOT_APPLIED)).toHaveLength(1);
  });

  it('names the 12 codes the corpus loader names', () => {
    // Enumerated independently of the change set: this list is the one
    // `tests/season2026PracticeCorpus.test.js` asserts against the loader's own
    // `compareDecoderRings()`. Two producers agreeing on a written-down list is
    // the check; deriving this list *from* the change set would compare it
    // against itself.
    expect(rings.buckets.differing.map((subject) => subject.key).sort()).toEqual(
      [
        '11v11 Field 2',
        '7v7 Field 1',
        '7v7 Field 2',
        '9v9 Field 1',
        '9v9 Field 2',
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => `Junior Field ${n}`),
      ].sort()
    );
  });

  it('keeps the composition of the 12 visible: 11 label conflicts and 1 blank', () => {
    // **The count must never hide the composition.** The supervisor proposed
    // reporting the blank one as `added` instead; the evidence refused it,
    // because both rings carry a *row* for `11v11 Field 2` and only the label
    // cell is blank, so `added` would be a false statement about presence. The
    // distinction is preserved here as a `kind` rather than by moving the
    // subject to a bucket that means something else.
    expect(tally(rings.buckets.differing, (subject) => subject.sourceDisagreement.kind)).toEqual({
      [ALIAS_LABEL_AGREEMENT.LABEL_CONFLICT]: 11,
      [ALIAS_LABEL_AGREEMENT.BLANK_VS_LABEL]: 1,
    });
  });

  it('names the blank-vs-label code, and carries both sides of it', () => {
    const blank = rings.buckets.differing.find(
      (subject) => subject.sourceDisagreement.kind === ALIAS_LABEL_AGREEMENT.BLANK_VS_LABEL
    );
    expect(blank.key).toBe('11v11 Field 2');
    expect(blank.sourceDisagreement.values).toEqual([null, 'Hawthorn MS Field 1']);
    expect(blank.sourceDisagreement.sources).toEqual([
      'practice_field_aliases.csv',
      'field_code_names.csv',
    ]);
  });

  it('reuses the alias layer vocabulary rather than minting a third enum', () => {
    // Three producers of one derived status is the defect Phase 8.0's first
    // review round found. Every kind here must be a value `facility/aliases.js`
    // already declares.
    const declared = /** @type {Set<string>} */ (new Set(Object.values(ALIAS_LABEL_AGREEMENT)));
    for (const subject of rings.buckets.differing) {
      expect(declared.has(subject.sourceDisagreement.kind)).toBe(true);
    }
  });

  it('keeps the seven fields-ring-only codes as additions, not disagreements', () => {
    // This is why the blank cannot go to `added`: that bucket already carries a
    // different fact, and the club would act on the two differently.
    const addedFromOneRing = rings.buckets.added.filter((subject) => subject.rows.length === 1);
    expect(addedFromOneRing.map((subject) => subject.key).sort()).toEqual([
      '11v11 Field 3',
      '7v7 Field 4',
      '7v7 Field 5',
      '9v9 Field 3',
      '9v9 Field 4',
      '9v9 Field 5',
      '9v9 Field 6',
    ]);
  });

  it('states the comparisons it actually made', () => {
    // Pinned so a count in prose cannot drift from the code again: a comment in
    // `changeSet.js` claimed 54 and the measured figure was 40.
    expect(rings.meta.sourceComparisons).toBe(40);
    // 40 is 2 records compared over 20 shared codes: the ring subject compares
    // one field, and every shared code contributes one comparison per ring.
    expect(rings.meta.sourceComparisons).toBe(
      2 * everySubject(rings).filter((subject) => subject.rows.length === 2).length
    );
    // ... and no comparison against held state happened, because a first import
    // holds nothing. That is what makes `sourceComparisons` load-bearing.
    expect(rings.meta.fieldComparisons).toBe(0);
  });

  it('reads 20 shared codes and 27 rows in all', () => {
    // The universe, enumerated from the rings rather than from the
    // disagreements: a code dropped by a projector shows up here as a smaller
    // universe rather than as a silently smaller disagreement count.
    const shared = everySubject(rings)
      .filter((subject) => subject.rows.length === 2)
      .map((subject) => subject.key);
    expect(shared).toHaveLength(20);
    expect(rings.meta.projectedSubjects).toBe(27);
    expect(rings.meta.sourceRowsRead).toBe(47);
  });

  it('reads an empty label as an absence on both rings, not as a crash', () => {
    // **A crash path, not a wrong answer.** The practice accessor read
    // `actualLabel` raw while its fields-ring sibling wrote `|| null`, so an
    // empty cell reached `z.string().min(1).nullable()` and threw - taking all
    // five change sets down, not just the row. The sibling-contract divergence
    // `CLAUDE.md` names, sitting on the one nullable column that was not routed
    // through `nullableText`.
    /** @type {Array<{ ringName: string, rows: Object[], key: string, project: Function }>} */
    const bothRings = [
      {
        ringName: 'practice',
        rows: practice.fieldAliases,
        key: 'displayName',
        project: projectPracticeRing,
      },
      {
        ringName: 'fields',
        rows: practice.fieldCodeNames,
        key: 'codeName',
        project: projectFieldsRing,
      },
    ];
    for (const { ringName, rows, key, project } of bothRings) {
      const withEmpty = rows.map((row, index) => (index === 0 ? { ...row, actualLabel: '' } : row));
      const projected = project(withEmpty, graph, complexMap);
      expect({ ringName, rows: projected.length }).toEqual({ ringName, rows: rows.length });
      const first = projected.find((row) => row.subjectKey === rows[0][key]);
      expect({ ringName, label: first.record.label }).toEqual({ ringName, label: null });
    }
  });

  it('survives an empty label without losing the other four change sets', () => {
    // The blast radius is what makes this worth its own assertion: one bad cell
    // in one ring must not cost the blackouts, the windows, the permits and the
    // venue attributes.
    const withEmpty = practice.fieldAliases.map((row, index) =>
      index === 0 ? { ...row, actualLabel: '' } : row
    );
    const rebuilt = importSeason2026Fields({
      practice: { ...practice, fieldAliases: withEmpty },
      graph,
      complexMap,
    });
    expect(rebuilt.blackouts.buckets.added).toHaveLength(11);
    expect(rebuilt.recurringWindows.meta.sourceRowsRead).toBe(42);
    expect(rebuilt.permitWindows.buckets.added).toHaveLength(544);
    expect(rebuilt.venueAttributes.meta.sourceRowsRead).toBe(14);
  });

  it('never drops a ring row: every one reaches a subject', () => {
    // The row that would go missing first is `11v11 Field 2`'s practice-ring
    // row, whose every cell after the code is blank, and losing it would take
    // the twelfth disagreement with it.
    expect(rings.buckets.unresolvable).toEqual([]);
    expect(rings.meta.rowsUnresolvable).toBe(0);
    const rowsOnSubjects = everySubject(rings).reduce(
      (sum, subject) => sum + subject.rows.length,
      0
    );
    expect(rowsOnSubjects).toBe(rings.meta.sourceRowsRead);
  });

  it('compares labels and nothing else, so 12 keeps one meaning', () => {
    // Measured, not reasoned about: adding ground to the compared set reports
    // 13, because `11v11 Field 1` has both rings writing the same label while
    // the practice ring leaves the venue cell blank. That is a real fact, and
    // it belongs on the interpretation axis rather than inside a count called
    // "decoder-ring disagreements".
    expect(SEASON_2026_SUBJECTS.aliases.comparedFields).toEqual(['label']);
    const willowmead = rings.buckets.added.find((subject) => subject.key === '11v11 Field 1');
    expect(willowmead.applicable).toBe(false);
    expect(willowmead.rows.some((row) => row.interpretation === INTERPRETATION.DOUBTFUL)).toBe(
      true
    );
    expect(
      willowmead.rows.find((row) => row.interpretation === INTERPRETATION.DOUBTFUL)
        .interpretationReason
    ).toMatch(/names no venue/);
  });
});

/* ========================================================================== */
/* Criterion 2: the Excel-corrupted rows                                      */
/* ========================================================================== */

describe('season-2026 field import :: the Excel corruption, in both files', () => {
  it('imports all 15 weekly rows with their raw value intact', () => {
    // **15 rows across three venues, not the one the README quotes.**
    const windows = imported.recurringWindows;
    const corrupted = everySubject(windows)
      .flatMap((subject) => subject.rows)
      .filter((row) => row.interpretationReason?.includes('Excel'));
    expect(corrupted).toHaveLength(15);
    for (const row of corrupted) {
      expect(row.interpretation).toBe(INTERPRETATION.DOUBTFUL);
      // The raw cell, beside the reading. This is the property §8.4 calls "the
      // single most important property for troubleshooting a bad import later".
      expect(String(row.raw.raw_value)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(row.raw.interpreted_window)).toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
    }
  });

  it('spreads them across the three venues the sheet corrupts', () => {
    const windows = imported.recurringWindows;
    const corrupted = everySubject(windows)
      .flatMap((subject) => subject.rows)
      .filter((row) => row.interpretationReason?.includes('Excel'));
    expect(tally(corrupted, (row) => String(row.raw.venue))).toEqual({
      'Orchard Park': 5,
      Maplewood: 5,
      'Larkfield Green': 5,
    });
  });

  it('flags them for review rather than silently accepting them', () => {
    const windows = imported.recurringWindows;
    const flagged = findingsOf(windows, FIELD_ADMIN_REASON.ROW_DOUBTFUL);
    // 15 Excel rows plus the 7 competitive-programme rows.
    expect(flagged).toHaveLength(22);
    const excel = flagged.filter((finding) => String(finding.details.reason).includes('Excel'));
    expect(excel).toHaveLength(15);
    for (const finding of excel) expect(String(finding.details.raw)).toContain('raw_value');
    // Not one of them is applicable without a person deciding.
    const applicable = windows.buckets.added.filter((subject) => subject.applicable);
    expect(applicable).toHaveLength(20);
    expect(windows.meta.rowsDoubtful).toBe(22);
  });

  it('carries the sixteenth corruption, which is in the constraint sheet', () => {
    // `PHASE_8_PLAN.md` §8.4 mentions Excel corruption only in the availability
    // sheet. The Gardening Day row of `field_constraints.csv` has the same
    // damage - the author typed `1-7` and Excel wrote `2026-01-07` - and it
    // matters more, because that file becomes blackouts and a blackout on the
    // wrong ground closes it for real.
    const blackouts = imported.blackouts;
    const rows = everySubject(blackouts).flatMap((subject) => subject.rows);
    const gardening = rows.filter((row) => String(row.raw.fields).startsWith('2026-'));
    expect(gardening).toHaveLength(1);
    expect(gardening[0].raw.fields).toBe('2026-01-07');
    expect(gardening[0].interpretation).toBe(INTERPRETATION.DOUBTFUL);
    expect(gardening[0].interpretationReason).toMatch(/Excel made of a field range/);
    // Read as the whole venue as a compromise - never as nothing, which is what
    // `availability/closures.js` already decides, and never guessed back into a
    // field range.
    const record = /** @type {{ scope: string, venueIds: string[] }} */ (
      /** @type {unknown} */ (gardening[0].record)
    );
    expect(record.scope).toBe('venue');
    expect(record.venueIds.length).toBeGreaterThan(0);
  });

  it('declares every interpretation the weekly sheet writes, in both directions', () => {
    // A class with no members that nothing announces is indistinguishable from
    // a class nobody checked - which is exactly what the 8.0 prompt's
    // `interpretation = "unparsed"` turned out to be. Every declared value must
    // match a row, and every row's value must be declared.
    // So the declaration is held to the data both ways: every value the corpus
    // writes must be declared, and every declared value must either match a row
    // or be named as absent.
    const written = new Set(practice.weeklyAvailability.map((row) => row.interpretation ?? ''));
    const declared = new Set(WEEKLY_INTERPRETATION_VALUES);
    const absent = new Set(WEEKLY_INTERPRETATIONS_ABSENT_FROM_CORPUS);

    for (const value of written) {
      expect({ value, declared: declared.has(value) }).toEqual({ value, declared: true });
    }
    for (const value of declared) {
      // Declared and unwritten is allowed only when it is named as absent.
      expect({ value, accounted: written.has(value) || absent.has(value) }).toEqual({
        value,
        accounted: true,
      });
    }
    // ... and a value named absent that starts appearing fails here rather than
    // ageing the declaration.
    for (const value of absent) {
      expect({ value, present: written.has(value) }).toEqual({ value, present: false });
    }
    expect([...absent]).toEqual(['unparsed']);
  });

  it('carries an unparsed row as unresolvable instead of aborting the whole import', () => {
    // The arm was missing, and its absence was not "unparsed is impossible" but
    // "unparsed is fatal": the lookup threw, which took all five change sets
    // down rather than reporting one row. Constructed, because the corpus
    // writes none.
    const withUnparsed = {
      ...practice,
      weeklyAvailability: [
        ...practice.weeklyAvailability,
        {
          rowIndex: 999,
          venue: 'Alder Park',
          day: 'Mon',
          weekday: 'MON',
          rawValue: 'something nobody could read',
          startMinutes: null,
          endMinutes: null,
          interpretation: 'unparsed',
          raw: { venue: 'Alder Park', day: 'Mon', raw_value: 'something nobody could read' },
        },
      ],
    };
    const rebuilt = importSeason2026Fields({ practice: withUnparsed, graph, complexMap });
    // Every other subject survived.
    expect(rebuilt.aliases.buckets.differing).toHaveLength(12);
    // ... and the row is reported with its raw value, not dropped.
    const unresolvable = rebuilt.recurringWindows.buckets.unresolvable;
    expect(unresolvable).toHaveLength(1);
    expect(unresolvable[0].interpretationReason).toMatch(/could not read the cell/);
    expect(unresolvable[0].raw.raw_value).toBe('something nobody could read');
  });
});

/* ========================================================================== */
/* Nothing is dropped, anywhere                                               */
/* ========================================================================== */

describe('season-2026 field import :: nothing is silently dropped', () => {
  const subjects = ['aliases', 'blackouts', 'recurringWindows', 'permitWindows', 'venueAttributes'];

  it('accounts for every source row on one axis or the other', () => {
    for (const name of subjects) {
      const set = imported[name];
      const onSubjects = everySubject(set).reduce((sum, subject) => sum + subject.rows.length, 0);
      expect({ name, accounted: onSubjects + set.buckets.unresolvable.length }).toEqual({
        name,
        accounted: set.meta.sourceRowsRead,
      });
    }
  });

  it('raises no partition finding on any subject', () => {
    // The reconciliation is exported and separately controlled in
    // `tests/fieldAdminChangeSet.test.js`; here it must simply be silent, which
    // is only meaningful because that file proves it can speak.
    for (const name of subjects) {
      expect({
        name,
        findings: findingsOf(imported[name], FIELD_ADMIN_REASON.CHANGE_SET_PARTITION_INCOMPLETE),
      }).toEqual({ name, findings: [] });
    }
  });

  it('reports every unresolvable row with a reason and its raw cell', () => {
    for (const name of subjects) {
      const set = imported[name];
      const findings = findingsOf(set, FIELD_ADMIN_REASON.ROW_UNRESOLVABLE);
      expect({ name, count: findings.length }).toEqual({
        name,
        count: set.buckets.unresolvable.length,
      });
      for (const finding of findings) {
        expect(finding.details.reason).toBeTruthy();
        expect(finding.details.raw).toBeTruthy();
      }
    }
  });

  it('reads every source file the plan names', () => {
    // The meta-assertion: a projector that silently stopped running would leave
    // its file unnamed here rather than merely producing fewer findings.
    const files = new Set();
    for (const name of subjects) {
      const set = imported[name];
      for (const subject of everySubject(set)) {
        for (const row of subject.rows) files.add(row.sourceFile);
      }
      for (const row of set.buckets.unresolvable) files.add(row.sourceFile);
    }
    expect([...files].sort()).toEqual([
      'field_code_names.csv',
      'field_constraints.csv',
      'field_inventory.csv',
      'field_weekly_availability.csv',
      'permit_reservations.csv',
      'practice_field_aliases.csv',
    ]);
  });
});

/* ========================================================================== */
/* The constraint log                                                         */
/* ========================================================================== */

describe('season-2026 field import :: the constraint log becomes blackouts', () => {
  const blackouts = imported.blackouts;

  it('reads all 13 rows and turns 11 into blackouts', () => {
    expect(blackouts.meta.sourceRowsRead).toBe(13);
    expect(blackouts.buckets.added).toHaveLength(11);
    expect(blackouts.buckets.unresolvable).toHaveLength(2);
  });

  it('joins each constraint row to its own closure, not to the one beside it', () => {
    // **A positional join guarded by a length check cannot see a reordering** -
    // the counts still match when two rows swap, so the guard was derived from
    // the property the break would leave intact. Both sides carry a distinct
    // `id`, so the join uses it.
    //
    // **The control has to construct the break.** Reversing the constraint list
    // alone proves nothing: the closure set is derived from that same list, so
    // both sides move together and a positional join still lines up. The
    // reordering has to be on *one* side, which is why `projectFieldConstraints`
    // takes an injectable closure set.
    const built = projectFieldConstraints(practice.fieldConstraints, graph, complexMap).closureSet;
    const shuffled = {
      ...built,
      closures: [...built.closures].reverse(),
    };
    const { rows: joined } = projectFieldConstraints(practice.fieldConstraints, graph, complexMap, {
      closureSet: shuffled,
    });
    for (const [index, constraint] of practice.fieldConstraints.entries()) {
      // Each row is built from its own constraint's closure, whatever position
      // that closure now occupies. Under a positional join every row but the
      // middle one would carry someone else's venue.
      expect({ index, rowIndex: joined[index].rowIndex }).toEqual({
        index,
        rowIndex: constraint.rowIndex,
      });
      expect({ index, venue: joined[index].raw.venue }).toEqual({
        index,
        venue: constraint.raw.venue,
      });
    }
    // The interpretation each row reaches is unchanged by the shuffle.
    const forwardRows = projectFieldConstraints(practice.fieldConstraints, graph, complexMap).rows;
    expect(joined.map((row) => row.interpretation)).toEqual(
      forwardRows.map((row) => row.interpretation)
    );

    // ... and the input order of the constraints themselves is carried through.
    const reversed = [...practice.fieldConstraints].reverse();
    const { rows } = projectFieldConstraints(reversed, graph, complexMap);
    expect(rows).toHaveLength(reversed.length);
    for (const [index, constraint] of reversed.entries()) {
      // Each projected row carries the raw cells of the constraint it was
      // built from - not of whatever sat at that position in the closure list.
      expect({ index, venue: rows[index].raw.venue }).toEqual({
        index,
        venue: constraint.raw.venue,
      });
      expect({ index, rowIndex: rows[index].rowIndex }).toEqual({
        index,
        rowIndex: constraint.rowIndex,
      });
    }
    // ... and the same rows resolve the same way regardless of input order.
    const forward = projectFieldConstraints(practice.fieldConstraints, graph, complexMap).rows;
    const byRowIndex = (list) =>
      Object.fromEntries(list.map((entry) => [entry.rowIndex, entry.interpretation]));
    expect(byRowIndex(rows)).toEqual(byRowIndex(forward));
  });

  it('refuses to make a blackout of the car park or the adjacency rule', () => {
    // Encoding the adjacency here would evaluate one rule twice - the graph
    // already carries it as overlap pairs - and closing a car park would close
    // no ground. Both are reported rather than filtered out of the count.
    const reasons = blackouts.buckets.unresolvable.map((row) => row.interpretationReason);
    // Asserted by membership, not by position: a sort order is not a
    // guarantee, and keying an assertion on one makes it fail for the wrong
    // reason the first time a message is reworded.
    expect(reasons.filter((reason) => /adjacency rule/.test(reason))).toHaveLength(1);
    expect(reasons.filter((reason) => /not a playing surface/.test(reason))).toHaveLength(1);
    expect(blackouts.buckets.unresolvable.map((row) => String(row.raw.fields)).sort()).toEqual([
      'Adjacent Fields',
      'Parking',
    ]);
  });

  it('carries the three season-long closures as all-day windows', () => {
    const seasonLong = blackouts.buckets.added.filter(
      (subject) => subject.after.fromDate === '2026-08-01' && subject.after.startMinutes === null
    );
    expect(seasonLong).toHaveLength(3);
    for (const subject of seasonLong) {
      expect(subject.after.endMinutes).toBeNull();
      expect(subject.after.toDate >= '2026-10-31').toBe(true);
    }
  });

  it('maps the sheet’s prose reason to an enum and keeps the prose in the raw', () => {
    // The privacy position: the structured half is an enum, the sheet's own
    // words survive in `raw`, and nothing copies free text into a stored note.
    for (const subject of blackouts.buckets.added) {
      expect(subject.after.note).toBeNull();
      expect(subject.rows[0].raw.reason).toBeTruthy();
    }
    const reasons = new Set(blackouts.buckets.added.map((subject) => subject.after.reason));
    expect(reasons.has('closure')).toBe(true);
    expect(reasons.has('third-party-booking')).toBe(true);
  });
});

/* ========================================================================== */
/* The permits                                                                */
/* ========================================================================== */

describe('season-2026 field import :: the permits, and their third vocabulary', () => {
  const permits = imported.permitWindows;

  it('reads all 767 reservations and places 544 of them', () => {
    expect(permits.meta.sourceRowsRead).toBe(767);
    expect(permits.buckets.added).toHaveLength(544);
    expect(permits.buckets.unresolvable).toHaveLength(223);
  });

  it('resolves a cell naming two surfaces to both of them', () => {
    // `Field - Soccer 1A/1B` names two surfaces in one cell. Resolving it to
    // one would halve the reserved ground; resolving it to the parent pitch
    // would reserve ground the permit does not grant.
    const both = permits.buckets.added.find((subject) =>
      String(subject.after?.facilityLabel).includes('1A/1B')
    );
    expect(/** @type {string[]} */ (both.after.surfaceIds)).toHaveLength(2);
  });

  it('keeps the permit’s own spelling of the ground on every record', () => {
    // A permit is a legal document and the label on it is the club's evidence.
    for (const subject of permits.buckets.added) {
      expect(subject.after.facilityLabel).toMatch(/Field/);
    }
  });

  it('declares a reading for every venue-and-facility pair the sheet writes', () => {
    // Enumerated from the reservations, not from the reading table: a pair the
    // table does not cover must fail loudly rather than resolve through a
    // neighbouring venue's reading.
    const pairs = new Set(
      practice.permitReservations.map((row) => permitFacilityKey(row.venue, row.facility))
    );
    expect(pairs.size).toBe(8);
    for (const pair of pairs) expect(PERMIT_FACILITY_LABELS).toContain(pair);
  });

  it('refuses to guess the three labels that reach no ground', () => {
    const unplaced = tally(permits.buckets.unresolvable, (row) => String(row.raw.facility));
    expect(unplaced).toEqual({
      'Field - Football (B) (Field)': 72,
      'Field - Practice 2 (A) (Field)': 80,
      'Lower Field - Practice 3 (Field)': 71,
    });
  });

  it('keeps the lighting evidence as services rather than a boolean', () => {
    // GAP-05: the corpus carries `lit` only at venue level, and the Summit HS
    // permit attaches `Field Lights` per reservation.
    const lit = permits.buckets.added.filter((subject) =>
      /** @type {string[]} */ (subject.after?.services ?? []).includes('Field Lights')
    );
    expect(lit.length).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/* The inventory                                                              */
/* ========================================================================== */

describe('season-2026 field import :: the inventory is venue-keyed prose', () => {
  const attributes = imported.venueAttributes;

  it('reads 14 rows into 13 venue subjects', () => {
    // `Willowmead Park` appears twice, with different notes.
    expect(attributes.meta.sourceRowsRead).toBe(14);
    expect(attributes.meta.projectedSubjects).toBe(13);
  });

  it('reports the duplicated venue as a disagreement rather than letting one win', () => {
    // A last-wins index is what Phase 8.0's third review round found on the
    // fields-ring side. Both rows are carried and neither is preferred.
    expect(attributes.buckets.differing).toHaveLength(1);
    const duplicated = attributes.buckets.differing[0];
    expect(duplicated.key).toBe('Willowmead Park');
    expect(duplicated.rows).toHaveLength(2);
    expect(duplicated.applicable).toBe(false);
    expect(duplicated.sourceDisagreement.sources).toEqual([
      'field_inventory.csv',
      'field_inventory.csv',
    ]);
  });

  it('carries the size prose verbatim rather than parsing it into numbers', () => {
    // There is no grammar in `11v11 (4) 9v9 (8)`, only shorthand, and inventing
    // capacity from it would put a guess into a scheduler.
    const alder = everySubject(attributes).find((subject) => subject.key === 'Alder Park');
    expect(alder.after.fieldSizesText).toBe('11v11 (4) 9v9 (8)');
  });

  it('marks the sentinel cells doubtful rather than reading a shrug as data', () => {
    const doubtful = everySubject(attributes).filter((subject) =>
      subject.rows.some((row) => row.interpretation === INTERPRETATION.DOUBTFUL)
    );
    expect(doubtful.map((subject) => subject.key).sort()).toEqual(['Alder Park', 'Foxglove Park']);
    for (const subject of doubtful) expect(subject.applicable).toBe(false);
  });

  it('recognises every sentinel spelling the sheet writes, and no ordinary cell', () => {
    expect(isInventorySentinel('XX')).toBe(true);
    expect(isInventorySentinel('??')).toBe(true);
    expect(isInventorySentinel('????Availability UNKNOWN as of 3/26')).toBe(true);
    expect(isInventorySentinel('11v11 (4) 9v9 (8)')).toBe(false);
    expect(isInventorySentinel('')).toBe(false);
    expect(isInventorySentinel(null)).toBe(false);
  });

  it('joins the equipment sheet onto the venue it names', () => {
    const orchard = attributes.buckets.added.find((subject) => subject.key === 'Orchard Park');
    const equipment = /** @type {Array<{ item: string }>} */ (orchard.after?.equipment ?? []);
    expect(equipment.map((entry) => entry.item).sort()).toEqual([
      'PUGG Goals (blue)',
      'Storage Container',
    ]);
  });
});

/* ========================================================================== */
/* What this PR does not reach                                                */
/* ========================================================================== */

describe('season-2026 field import :: the criteria this PR does not reach', () => {
  it('applies nothing, and says so on every subject', () => {
    // The plan's remaining two criteria - retiring a surface with a booked
    // practice, and a blackout added through the UI showing as a conflict -
    // need persistence and the app. Until then every change set must be
    // explicit that it is a proposal, so no report can imply an import
    // happened.
    for (const name of [
      'aliases',
      'blackouts',
      'recurringWindows',
      'permitWindows',
      'venueAttributes',
    ]) {
      const declared = findingsOf(imported[name], FIELD_ADMIN_REASON.CHANGE_SET_NOT_APPLIED);
      expect({ name, declared: declared.length }).toEqual({ name, declared: 1 });
    }
  });

  it('never reports a subject as removed, because nothing is held yet', () => {
    // Stated rather than left silent: `removed` is implemented and controlled
    // in `tests/fieldAdminChangeSet.test.js`, and it is empty here only because
    // a first import holds nothing. A reader must not take this emptiness as
    // evidence the bucket works.
    for (const name of [
      'aliases',
      'blackouts',
      'recurringWindows',
      'permitWindows',
      'venueAttributes',
    ]) {
      expect({ name, removed: imported[name].buckets.removed.length }).toEqual({
        name,
        removed: 0,
      });
    }
  });

  it('reports a first load as uncompared where there is only one source', () => {
    // The three single-source subjects compared nothing against held state and
    // have no second source; the two multi-source subjects did compare. The
    // distinction is asserted so "clean" never means "nothing was checked".
    const uncompared = ['blackouts', 'recurringWindows', 'permitWindows'];
    const compared = ['aliases', 'venueAttributes'];
    for (const name of uncompared) {
      expect({
        name,
        uncompared: findingsOf(imported[name], FIELD_ADMIN_REASON.CHANGE_SET_UNCOMPARED).length,
      }).toEqual({ name, uncompared: 1 });
    }
    for (const name of compared) {
      expect({
        name,
        uncompared: findingsOf(imported[name], FIELD_ADMIN_REASON.CHANGE_SET_UNCOMPARED).length,
        sourceComparisons: imported[name].meta.sourceComparisons > 0,
      }).toEqual({ name, uncompared: 0, sourceComparisons: true });
    }
  });

  it('carries the closure set out, declaration and all', () => {
    // So the caller sees `CLOSURE_SET_UNWIRED` rather than having it swallowed
    // here, and can reconcile the adjacency row against the graph's overlap
    // pairs without rebuilding the set.
    expect(imported.closureSet.closures).toHaveLength(13);
    expect(imported.closureSet.findings.map((finding) => finding.code)).toContain(
      'CLOSURE_SET_UNWIRED'
    );
  });
});

/* ========================================================================== */
/* The prose sweep, made behavioural                                          */
/* ========================================================================== */

describe('season-2026 field import :: the figures the module docstrings state', () => {
  // 8.3's sweep found 16 wrong statements in 550, and every one of them was
  // prose nobody could fail. Where a statement is a count, it is asserted here
  // and read out of the data rather than out of a comment - so the next edit
  // that changes the data fails a test instead of ageing a docstring.
  it('states the permit figures the permits projector claims', () => {
    expect(practice.permitReservations).toHaveLength(767);
    expect(practice.permits).toHaveLength(4);
    expect(new Set(practice.permitReservations.map((row) => row.facility)).size).toBe(8);
    expect(imported.permitWindows.buckets.added).toHaveLength(544);
    expect(imported.permitWindows.buckets.unresolvable).toHaveLength(223);
    const dates = practice.permitReservations.map((row) => row.date).sort();
    expect([dates[0], dates[dates.length - 1]]).toEqual(['2026-08-10', '2026-12-20']);
  });

  it('states the weekly-sheet figures its projector claims', () => {
    expect(practice.weeklyAvailability).toHaveLength(42);
    expect(new Set(practice.weeklyAvailability.map((row) => row.venue)).size).toBe(7);
    expect(tally(practice.weeklyAvailability, (row) => row.interpretation ?? '')).toEqual({
      '': 13,
      'excel-date-corruption': 15,
      unavailable: 7,
      'competitive-programme': 7,
    });
  });

  it('states the inventory figures its projector claims', () => {
    expect(practice.fieldInventory).toHaveLength(14);
    // The duplicate row differs in `field_sizes` as well as `notes`, and
    // `field_sizes` is the one reported - the docstring used to name only
    // `notes`.
    const willowmead = practice.fieldInventory.filter((row) => row.venue === 'Willowmead Park');
    expect(willowmead).toHaveLength(2);
    expect(willowmead.map((row) => row.fieldSizes)).toEqual(['11v11 (2)', '11v11']);
    expect(imported.venueAttributes.buckets.differing[0].sourceDisagreement.field).toBe(
      'fieldSizesText'
    );
  });

  it('states the ring figures its projector claims', () => {
    expect(rings.meta.sourceRowsRead).toBe(47);
    expect(rings.meta.projectedSubjects).toBe(27);
    expect(rings.buckets.differing).toHaveLength(12);
    expect(rings.buckets.added.filter((subject) => subject.rows.length === 1)).toHaveLength(7);
  });

  it('states the constraint figures its projector claims', () => {
    expect(practice.fieldConstraints).toHaveLength(13);
    expect(imported.blackouts.buckets.added).toHaveLength(11);
    expect(imported.blackouts.buckets.unresolvable).toHaveLength(2);
  });
});

/* ========================================================================== */
/* Subject definitions                                                        */
/* ========================================================================== */

describe('season-2026 field import :: one definition of every subject', () => {
  it('keys and compares disjoint fields on every subject', () => {
    for (const [name, definition] of Object.entries(SEASON_2026_SUBJECTS)) {
      const overlap = definition.comparedFields.filter((field) =>
        definition.keyFields.includes(field)
      );
      expect({ name, overlap }).toEqual({ name, overlap: [] });
      expect(definition.keyFields.length).toBeGreaterThan(0);
      expect(definition.comparedFields.length).toBeGreaterThan(0);
    }
  });

  it('produces a change set for every declared subject', () => {
    for (const name of Object.keys(SEASON_2026_SUBJECTS)) {
      expect({ name, built: Boolean(imported[name]) }).toEqual({ name, built: true });
      expect(imported[name].subject).toBe(SEASON_2026_SUBJECTS[name].subject);
    }
  });

  it('puts every subject in exactly one bucket, on every change set', () => {
    for (const name of Object.keys(SEASON_2026_SUBJECTS)) {
      const set = imported[name];
      const keys = everySubject(set).map((subject) => subject.key);
      expect({ name, unique: keys.length === new Set(keys).size }).toEqual({ name, unique: true });
      const dispositions = new Set(everySubject(set).map((subject) => subject.disposition));
      for (const disposition of dispositions) {
        expect(Object.values(DISPOSITION)).toContain(disposition);
      }
    }
  });
});
