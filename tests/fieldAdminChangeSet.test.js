/**
 * The change-set comparator, on constructed inputs.
 *
 * `tests/fieldAdminSeason2026Import.test.js` asserts what the corpus produces;
 * this file asserts the machinery, on inputs small enough to reason about.
 *
 * **Every guarantee here carries a positive control.** For each assertion that
 * could pass vacuously, the wrong implementation is constructed and the
 * assertion is shown to reject it. An assertion nobody can make fail is not an
 * assertion, and `docs/BUILD_PLAN_STATUS.md` §4 records that shape reaching
 * `main` more than once.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  BLACKOUT_REASON,
  BLACKOUT_SCOPE,
  BlackoutWindowSchema,
  DISPOSITION,
  FIELD_ADMIN_REASON,
  FIELD_ADMIN_SEVERITY,
  FIELD_ADMIN_STATUS,
  FIELD_ADMIN_REASON_SEVERITY,
  INTERPRETATION,
  NOTE_MAX_LENGTH,
  NoteSchema,
  RECORD_SOURCE,
  assertFieldAdminFindings,
  buildChangeSet,
  changeSetPartitionFindings,
  deriveFieldAdminStatus,
  renderValue,
  splitByInterpretation,
  subjectIdentity,
} from '@squadlogic/core/fieldAdmin/index.js';
import {
  COMMON_ABBREVIATIONS,
  IDENTITY_SHAPES,
  findIdentityShapes,
  withoutCommonAbbreviations,
} from '@squadlogic/core/privacy/index.js';

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

/** A blackout record, valid by construction. */
const blackout = (id, overrides = {}) =>
  BlackoutWindowSchema.parse({
    id,
    scope: BLACKOUT_SCOPE.VENUE,
    venueIds: ['venue-a'],
    surfaceIds: [],
    fromDate: '2026-09-01',
    toDate: '2026-09-01',
    startMinutes: null,
    endMinutes: null,
    reason: BLACKOUT_REASON.CLOSURE,
    note: null,
    source: RECORD_SOURCE.CONSTRAINT_SHEET,
    ...overrides,
  });

/** A projected row wrapping a record. */
const row = (subjectKey, record, overrides = {}) => ({
  sourceFile: 'test.csv',
  rowIndex: 0,
  subjectKey,
  interpretation: INTERPRETATION.INTERPRETED,
  interpretationReason: null,
  raw: { key: subjectKey },
  record,
  ...overrides,
});

/** The standard subject definition used across this file. */
const SUBJECT = {
  subject: 'test blackouts',
  keyFields: ['id'],
  comparedFields: ['fromDate', 'toDate', 'reason'],
};

const build = (currentRecords, proposedRows, extra = {}) =>
  buildChangeSet({
    ...SUBJECT,
    current: { label: 'held', records: currentRecords },
    proposed: { label: 'proposed', rows: proposedRows },
    ...extra,
  });

const codesOf = (changeSet) => changeSet.findings.map((finding) => finding.code);

/* -------------------------------------------------------------------------- */

describe('fieldAdmin :: the four dispositions', () => {
  it('reports a subject held and proposed identically as matched', () => {
    const held = blackout('b1');
    const set = build([held], [row('b1', blackout('b1'))]);
    expect(set.buckets.matched.map((subject) => subject.key)).toEqual(['b1']);
    expect(set.buckets.differing).toHaveLength(0);
    expect(set.meta.fieldComparisons).toBe(SUBJECT.comparedFields.length);
    expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.SUBJECTS_MATCHED);
  });

  it('reports a changed field as differing, and names the field', () => {
    const set = build([blackout('b1')], [row('b1', blackout('b1', { toDate: '2026-09-05' }))]);
    expect(set.buckets.differing.map((subject) => subject.key)).toEqual(['b1']);
    expect(set.buckets.differing[0].changedFields).toEqual(['toDate']);
    expect(set.buckets.differing[0].applicable).toBe(false);
    expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.SUBJECT_DIFFERS);
  });

  it('reports a subject nothing holds as added', () => {
    const set = build([], [row('b1', blackout('b1'))]);
    expect(set.buckets.added.map((subject) => subject.key)).toEqual(['b1']);
    expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.SUBJECTS_ADDED);
  });

  it('reports a held subject no source names as removed, and refuses to apply it', () => {
    // The disposition `PHASE_8_PLAN.md` §8.4's four words omit. An import that
    // cannot say this silently means everything unmentioned is fine.
    const set = build([blackout('b1')], []);
    expect(set.buckets.removed.map((subject) => subject.key)).toEqual(['b1']);
    expect(set.buckets.removed[0].applicable).toBe(false);
    expect(set.buckets.removed[0].before).not.toBeNull();
    expect(set.buckets.removed[0].after).toBeNull();
    expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.SUBJECT_REMOVED);
  });

  it('puts every subject in exactly one bucket', () => {
    const set = build(
      [blackout('same'), blackout('changed'), blackout('gone')],
      [
        row('same', blackout('same')),
        row('changed', blackout('changed', { reason: BLACKOUT_REASON.WEATHER })),
        row('new', blackout('new')),
      ]
    );
    const buckets = {
      matched: set.buckets.matched.map((subject) => subject.key),
      differing: set.buckets.differing.map((subject) => subject.key),
      added: set.buckets.added.map((subject) => subject.key),
      removed: set.buckets.removed.map((subject) => subject.key),
    };
    expect(buckets).toEqual({
      matched: ['same'],
      differing: ['changed'],
      added: ['new'],
      removed: ['gone'],
    });
    const everyKey = Object.values(buckets).flat();
    expect(everyKey).toHaveLength(new Set(everyKey).size);
  });
});

describe('fieldAdmin :: an absent cell is neither agreement nor difference', () => {
  it('does not count an absent cell as a match', () => {
    // Folding "we do not know" into "the same" is how a missing value reads as
    // agreement. `compareParityRows()` makes the same distinction.
    const held = blackout('b1', { startMinutes: null, endMinutes: null });
    const proposed = blackout('b1', { startMinutes: 960, endMinutes: 1140 });
    const set = buildChangeSet({
      subject: 'times',
      keyFields: ['id'],
      comparedFields: ['startMinutes', 'endMinutes'],
      current: { label: 'held', records: [held] },
      proposed: { label: 'proposed', rows: [row('b1', proposed)] },
    });
    expect(set.buckets.matched).toHaveLength(1);
    expect(set.buckets.matched[0].absentFields).toEqual(['startMinutes', 'endMinutes']);
    // ... and the absence is visible rather than silently counted as agreement.
    expect(set.meta.fieldComparisons).toBe(0);
  });
});

describe('fieldAdmin :: two sources describing one subject', () => {
  const twoSources = (a, b) => [
    row('b1', a, { sourceFile: 'first.csv' }),
    row('b1', b, { sourceFile: 'second.csv', rowIndex: 1 }),
  ];

  it('is differing, not added, when nothing is held and the sources disagree', () => {
    // The property the decoder rings depend on. Treating a two-source conflict
    // as a plain addition on a first import would make all 12 ring
    // disagreements applicable, which is the silent reconciliation the corpus
    // exists to prevent.
    const set = build([], twoSources(blackout('b1'), blackout('b1', { toDate: '2026-09-09' })));
    expect(set.buckets.differing.map((subject) => subject.key)).toEqual(['b1']);
    expect(set.buckets.added).toHaveLength(0);
    expect(set.buckets.differing[0].applicable).toBe(false);
    expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.SOURCES_DISAGREE);
  });

  it('is added when nothing is held and the sources agree', () => {
    const set = build([], twoSources(blackout('b1'), blackout('b1')));
    expect(set.buckets.added.map((subject) => subject.key)).toEqual(['b1']);
    expect(set.buckets.differing).toHaveLength(0);
    expect(set.buckets.added[0].applicable).toBe(true);
  });

  it('carries both values and prefers neither', () => {
    const set = build([], twoSources(blackout('b1'), blackout('b1', { toDate: '2026-09-09' })));
    const { sourceDisagreement } = set.buckets.differing[0];
    expect(sourceDisagreement.sources).toEqual(['first.csv', 'second.csv']);
    expect(sourceDisagreement.values).toEqual(['2026-09-01', '2026-09-09']);
    expect(sourceDisagreement.field).toBe('toDate');
  });

  it('takes its kind from the caller, so a kind has one producer', () => {
    const set = build([], twoSources(blackout('b1'), blackout('b1', { toDate: '2026-09-09' })), {
      disagreementKind: () => 'a-named-kind',
    });
    expect(set.buckets.differing[0].sourceDisagreement.kind).toBe('a-named-kind');
  });
});

describe('fieldAdmin :: the interpretation axis', () => {
  it('carries an unresolvable row with its raw cell rather than dropping it', () => {
    const set = build(
      [],
      [
        row('b1', null, {
          interpretation: INTERPRETATION.UNRESOLVABLE,
          interpretationReason: 'the venue is not in the graph',
          raw: { venue: 'Nowhere Park', fields: 'All' },
        }),
      ]
    );
    expect(set.buckets.unresolvable).toHaveLength(1);
    expect(set.buckets.added).toHaveLength(0);
    const finding = set.findings.find(
      (entry) => entry.code === FIELD_ADMIN_REASON.ROW_UNRESOLVABLE
    );
    expect(finding.details.raw).toContain('Nowhere Park');
    expect(finding.details.reason).toBe('the venue is not in the graph');
  });

  it('carries a doubtful row into the comparison and refuses to apply it', () => {
    const set = build(
      [],
      [
        row('b1', blackout('b1'), {
          interpretation: INTERPRETATION.DOUBTFUL,
          interpretationReason: 'Excel ate the cell',
          raw: { fields: '2026-01-07' },
        }),
      ]
    );
    expect(set.buckets.added).toHaveLength(1);
    expect(set.buckets.added[0].applicable).toBe(false);
    const finding = set.findings.find((entry) => entry.code === FIELD_ADMIN_REASON.ROW_DOUBTFUL);
    expect(finding.details.raw).toContain('2026-01-07');
  });

  it('throws on an interpretation with no arm, naming the union', () => {
    // The silent `default:` class. Phase 8.3 found three in two rounds, each
    // dropping a case while a meta-counter testified it had been examined.
    expect(() =>
      splitByInterpretation([row('b1', blackout('b1'), { interpretation: 'invented' })])
    ).toThrow(/interpretation "invented" has no arm/);
  });
});

describe('fieldAdmin :: the partition reconciliation can fail', () => {
  /** A minimal subject shell for a hand-built partition. */
  const subjectShell = (key, before, after) => ({
    key,
    label: key,
    disposition: DISPOSITION.MATCHED,
    changedFields: [],
    absentFields: [],
    before,
    after,
    rows: [row(key, after)],
    sourceDisagreement: null,
    applicable: true,
    notApplicableReason: null,
  });

  const soundPartition = () => ({
    matched: [subjectShell('a', blackout('a'), blackout('a'))],
    differing: [],
    added: [],
    removed: [],
    unresolvable: [],
    fieldComparisons: 3,
  });

  it('passes a partition that accounts for everything', () => {
    expect(
      changeSetPartitionFindings(soundPartition(), {
        sourceRowsRead: 1,
        currentSubjectsRead: 1,
        projectedSubjects: 1,
      })
    ).toEqual([]);
  });

  it('fires when a subject is dropped', () => {
    // The positive control `parityPartitionFindings()` carries, applied here.
    const findings = changeSetPartitionFindings(soundPartition(), {
      sourceRowsRead: 1,
      currentSubjectsRead: 2,
      projectedSubjects: 1,
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      FIELD_ADMIN_REASON.CHANGE_SET_PARTITION_INCOMPLETE,
    ]);
    expect(findings[0].details).toMatchObject({ side: 'current', accounted: 1, expected: 2 });
  });

  it('fires when a subject is counted twice', () => {
    const partition = soundPartition();
    partition.matched.push(subjectShell('a', blackout('a'), blackout('a')));
    const findings = changeSetPartitionFindings(partition, {
      sourceRowsRead: 2,
      currentSubjectsRead: 1,
      projectedSubjects: 1,
    });
    expect(findings.map((finding) => finding.details.side)).toEqual(['current', 'proposed']);
  });

  it('fires on the interpretation axis when a source row goes missing', () => {
    // Both axes are reconciled, because a partition can be sound on one and
    // broken on the other: rows can vanish between projection and comparison
    // while the four buckets still add up among themselves.
    const findings = changeSetPartitionFindings(soundPartition(), {
      sourceRowsRead: 5,
      currentSubjectsRead: 1,
      projectedSubjects: 1,
    });
    expect(findings.map((finding) => finding.details.axis)).toEqual(['interpretation']);
  });
});

describe('fieldAdmin :: a comparison that compares nothing says so', () => {
  it('reports a change set over zero subjects as vacuous', () => {
    const set = build([], []);
    expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.CHANGE_SET_VACUOUS);
    expect(set.status).toBe(FIELD_ADMIN_STATUS.BLOCKED);
  });

  it('reports a first load as uncompared rather than vacuous', () => {
    // The two say different things and only one is a defect: a single-source
    // first import really did compare nothing, and really is not broken.
    const set = build([], [row('b1', blackout('b1'))]);
    expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.CHANGE_SET_UNCOMPARED);
    expect(codesOf(set)).not.toContain(FIELD_ADMIN_REASON.CHANGE_SET_VACUOUS);
    expect(set.status).toBe(FIELD_ADMIN_STATUS.COMPROMISED);
  });

  it('reports neither when a comparison actually happened', () => {
    const set = build([blackout('b1')], [row('b1', blackout('b1'))]);
    expect(codesOf(set)).not.toContain(FIELD_ADMIN_REASON.CHANGE_SET_UNCOMPARED);
    expect(codesOf(set)).not.toContain(FIELD_ADMIN_REASON.CHANGE_SET_VACUOUS);
  });

  it('counts source comparisons even when the sources agree', () => {
    // Counting only differences would make a set that agreed everywhere look
    // like a set that had compared nothing.
    const set = build(
      [],
      [
        row('b1', blackout('b1'), { sourceFile: 'a.csv' }),
        row('b1', blackout('b1'), { sourceFile: 'b.csv', rowIndex: 1 }),
      ]
    );
    expect(set.meta.sourceComparisons).toBeGreaterThan(0);
    expect(codesOf(set)).not.toContain(FIELD_ADMIN_REASON.CHANGE_SET_UNCOMPARED);
  });
});

describe('fieldAdmin :: a change set is a proposal', () => {
  it('says so on every change set it builds', () => {
    for (const set of [build([], []), build([blackout('b1')], [row('b1', blackout('b1'))])]) {
      expect(codesOf(set)).toContain(FIELD_ADMIN_REASON.CHANGE_SET_NOT_APPLIED);
    }
  });

  it('counts applicable subjects, and a differing subject is never one', () => {
    const set = build(
      [blackout('same'), blackout('changed')],
      [row('same', blackout('same')), row('changed', blackout('changed', { toDate: '2026-09-09' }))]
    );
    expect(set.meta.subjectsApplicable).toBe(1);
    expect(set.buckets.differing.every((subject) => !subject.applicable)).toBe(true);
  });
});

describe('fieldAdmin :: a subject that is not a subject is refused', () => {
  it('refuses a change set with no key', () => {
    expect(() =>
      buildChangeSet({
        ...SUBJECT,
        keyFields: [],
        current: { label: 'a', records: [] },
        proposed: { label: 'b', rows: [] },
      })
    ).toThrow(/must key on at least one field/);
  });

  it('refuses a change set that compares no field', () => {
    expect(() =>
      buildChangeSet({
        ...SUBJECT,
        comparedFields: [],
        current: { label: 'a', records: [] },
        proposed: { label: 'b', rows: [] },
      })
    ).toThrow(/compares no field compares nothing/);
  });

  it('refuses a field that is both the identity and the comparison', () => {
    // It could only ever compare equal - the shape the Phase 2 review found in
    // the flagship "examined every division" check.
    expect(() =>
      buildChangeSet({
        ...SUBJECT,
        comparedFields: ['id'],
        current: { label: 'a', records: [] },
        proposed: { label: 'b', rows: [] },
      })
    ).toThrow(/both an identity field and a compared field/);
  });

  it('refuses a change set that does not say what it is of', () => {
    expect(() =>
      buildChangeSet({
        ...SUBJECT,
        subject: '',
        current: { label: 'a', records: [] },
        proposed: { label: 'b', rows: [] },
      })
    ).toThrow(/must say what it is a change set of/);
  });
});

describe('fieldAdmin :: renderValue is the one comparison rule', () => {
  it('distinguishes a joined list from a list of joined parts', () => {
    // A space separator would make these equal, and for ground that is a
    // different answer.
    expect(renderValue(['a b'])).not.toBe(renderValue(['a', 'b']));
  });

  it('renders absent as empty, and a boolean as a word', () => {
    expect(renderValue(null)).toBe('');
    expect(renderValue(undefined)).toBe('');
    expect(renderValue(true)).toBe('true');
    expect(renderValue(false)).toBe('false');
  });
});

describe('fieldAdmin :: one key space, on both sides', () => {
  it('keys the proposed side on the record, not on the projector’s label', () => {
    // The defect this replaces: the held side was keyed on `keyFields` and the
    // proposed side on each projector's `subjectKey` string, so for three of
    // the five season subjects the two key spaces could never collide and a
    // re-import reported everything as removed *and* added.
    const held = blackout('b1');
    const set = build([held], [row('a label that is nothing like the id', blackout('b1'))]);
    expect(set.buckets.matched.map((subject) => subject.key)).toEqual(['b1']);
    expect(set.buckets.removed).toHaveLength(0);
    expect(set.buckets.added).toHaveLength(0);
  });

  it('keeps subjectKey as the human label it always should have been', () => {
    const set = build([], [row('Alder Park 2026-09-19', blackout('b1'))]);
    expect(set.buckets.added[0].key).toBe('b1');
    expect(set.buckets.added[0].label).toBe('Alder Park 2026-09-19');
  });

  it('derives the same identity from a held record and a proposed one', () => {
    const record = blackout('b1');
    expect(subjectIdentity(record, ['id'])).toBe(subjectIdentity({ ...record }, ['id']));
    expect(subjectIdentity(record, ['id'])).not.toBe(
      subjectIdentity({ ...record, id: 'b2' }, ['id'])
    );
  });
});

describe('fieldAdmin :: renderValue sees inside a record', () => {
  it('compares two objects by their contents, not by their type', () => {
    // `String({})` is `"[object Object]"`, which made every object equal to
    // every other one: an equipment quantity could change under a comparison
    // that reported the subject unchanged and applicable.
    expect(renderValue({ item: 'Goals', value: '4' })).not.toBe(
      renderValue({ item: 'Goals', value: '99' })
    );
    expect(renderValue({ item: 'Goals', value: '4' })).not.toContain('[object Object]');
  });

  it('reads two records written in different key orders as the same record', () => {
    expect(renderValue({ a: 1, b: 2 })).toBe(renderValue({ b: 2, a: 1 }));
  });

  it('reports a changed quantity inside a list of records', () => {
    // The end-to-end shape of the same defect, through the comparator.
    const withEquipment = (quantity) => ({
      id: 'venue-a',
      equipment: [{ item: 'Goals', value: quantity }],
    });
    const set = buildChangeSet({
      subject: 'equipment',
      keyFields: ['id'],
      comparedFields: ['equipment'],
      current: { label: 'held', records: [withEquipment('4')] },
      proposed: { label: 'proposed', rows: [row('venue-a', withEquipment('99'))] },
    });
    expect(set.buckets.differing).toHaveLength(1);
    expect(set.buckets.differing[0].changedFields).toEqual(['equipment']);
    expect(set.buckets.differing[0].applicable).toBe(false);
  });
});

describe('fieldAdmin :: severity is looked up, never passed in', () => {
  it('registers a severity for every declared code', () => {
    const codes = Object.values(FIELD_ADMIN_REASON);
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) {
      expect(Object.keys(FIELD_ADMIN_REASON_SEVERITY)).toContain(code);
      expect(Object.values(FIELD_ADMIN_SEVERITY)).toContain(FIELD_ADMIN_REASON_SEVERITY[code]);
    }
  });

  it('refuses a finding carrying a hand-written severity', () => {
    expect(() =>
      assertFieldAdminFindings([
        {
          code: FIELD_ADMIN_REASON.SUBJECT_DIFFERS,
          severity: FIELD_ADMIN_SEVERITY.INFO,
          message: 'downgraded by hand',
          details: {},
        },
      ])
    ).toThrow(/the frozen table registers it as "blocking"/);
  });

  it('derives blocked over compromised over clean', () => {
    const finding = (severity) => ({ code: 'x', severity, message: '', details: {} });
    expect(deriveFieldAdminStatus([])).toBe(FIELD_ADMIN_STATUS.CLEAN);
    expect(deriveFieldAdminStatus([finding(FIELD_ADMIN_SEVERITY.INFO)])).toBe(
      FIELD_ADMIN_STATUS.CLEAN
    );
    expect(deriveFieldAdminStatus([finding(FIELD_ADMIN_SEVERITY.COMPROMISE)])).toBe(
      FIELD_ADMIN_STATUS.COMPROMISED
    );
    expect(
      deriveFieldAdminStatus([
        finding(FIELD_ADMIN_SEVERITY.COMPROMISE),
        finding(FIELD_ADMIN_SEVERITY.BLOCKING),
      ])
    ).toBe(FIELD_ADMIN_STATUS.BLOCKED);
  });
});

describe('fieldAdmin :: the privacy guard on an operator-written note', () => {
  it('accepts ordinary prose', () => {
    expect(NoteSchema.parse('gates locked while the contractor is on site')).toBe(
      'gates locked while the contractor is on site'
    );
  });

  it('refuses every identity shape, proved from the shared table', () => {
    // Generated from `privacy/textShapes.js`'s own samples, so a shape cannot be
    // declared there without being proved here - and adding a shape without a
    // sample fails rather than passing quietly.
    expect(IDENTITY_SHAPES.length).toBeGreaterThan(3);
    for (const { name, samples } of IDENTITY_SHAPES) {
      expect(samples.length, `${name} has no sample`).toBeGreaterThan(0);
      for (const sample of samples) {
        const result = NoteSchema.safeParse(`closed ${sample}`);
        expect({ name, sample, ok: result.success }).toEqual({ name, sample, ok: false });
      }
    }
  });

  it('refuses both normal forms of the same string, not one form of two', () => {
    // **The measured bypass**: a name carrying a diaeresis was refused in NFC
    // and accepted in NFD. `\\p{L}` matches neither the decomposed base letter
    // as non-ASCII nor the combining mark, and nothing normalised - so the
    // spelling of the input decided whether the guard could see it, which
    // means an operator could pick the spelling that got through.
    //
    // Asserted on **both forms of one string**, deliberately. Two different
    // strings would pass while the hole was open.
    const name = 'Zo\u00eb Hendricks memorial';
    const nfc = name.normalize('NFC');
    const nfd = name.normalize('NFD');
    // Meta-assertion: if these were the same string the test would prove
    // nothing about normalisation.
    expect(nfc).not.toBe(nfd);
    expect(nfc.length).not.toBe(nfd.length);
    for (const [form, value] of [
      ['NFC', nfc],
      ['NFD', nfd],
    ]) {
      expect({ form, refused: !NoteSchema.safeParse(value).success }).toEqual({
        form,
        refused: true,
      });
      expect({ form, shapes: findIdentityShapes(value).map((hit) => hit.shape) }).toEqual({
        form,
        shapes: ['non-ascii-letter'],
      });
    }
  });

  it('sees a combining mark that composes with nothing', () => {
    // The second line of defence. A stray mark has no precomposed form to
    // normalise into, so `\\p{M}` beside `\\p{L}` is what catches it.
    expect(findIdentityShapes('closed \u0301 today').map((hit) => hit.shape)).toEqual([
      'non-ascii-letter',
    ]);
  });

  it('bounds the length', () => {
    expect(NoteSchema.safeParse('x'.repeat(NOTE_MAX_LENGTH)).success).toBe(true);
    expect(NoteSchema.safeParse('x'.repeat(NOTE_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('accepts ordinary abbreviations an operator would actually write', () => {
    // `/(?:[A-Za-z]\.){2,}/` matches `p.m.` exactly as it matches `S.R.F.C.`.
    // Refusing "closed after 6 p.m." with a message about personal data is a
    // false accusation, and it teaches people to work around the guard.
    for (const note of [
      'closed after 6 p.m.',
      'open from 8 a.m.',
      'gates locked, e.g. weekends',
      'contractor on site, i.e. no access',
    ]) {
      expect({ note, ok: NoteSchema.safeParse(note).success }).toEqual({ note, ok: true });
    }
  });

  it('still refuses an acronym the abbreviation list does not name', () => {
    // The narrowing is a short list of fixed tokens, not a rule about dots, so
    // it cannot swallow a real club acronym.
    for (const note of ['S.R.F.C. tournament', 'U.S.C. event', 'closed for A.B.C.']) {
      expect({ note, ok: NoteSchema.safeParse(note).success }).toEqual({ note, ok: false });
    }
  });

  it('narrows nothing for the corpus scanner', () => {
    // The corpus keeps the strictest reading: `findIdentityShapes()` only
    // relaxes when a caller asks, and `tests/season2026CorpusVocabulary.test.js`
    // reads IDENTITY_SHAPES directly and never calls it.
    expect(findIdentityShapes('closed after 6 p.m.').map((hit) => hit.shape)).toEqual([
      'initialism',
    ]);
    expect(findIdentityShapes('closed after 6 p.m.', { allowCommonAbbreviations: true })).toEqual(
      []
    );
  });

  it('never hides an identity shape behind an abbreviation', () => {
    // **The property the guard depends on**, and the version that can fail.
    //
    // The first version of this test only ever built `closed ${abbr} ${sample}`
    // - spaces on both sides - which is the case the whole-token rule already
    // protects, so it could not fail for the class it names. The boundary rule
    // is load-bearing exactly where the abbreviation *abuts* the shape, so that
    // is what this builds. Measured against the code it replaced:
    // `u.s.@mail.internal` tripped `email` on the strict path and **nothing**
    // on the note path, because the end-boundary admitted `@`.
    //
    // Stated as an inclusion rather than a per-shape check: every non-initialism
    // shape the strict scan finds must survive the narrowed scan. The initialism
    // is the one verdict the narrowing is allowed to change.
    let checked = 0;
    for (const { name, samples } of IDENTITY_SHAPES) {
      if (name === 'initialism') continue;
      for (const sample of samples) {
        for (const abbreviation of COMMON_ABBREVIATIONS) {
          // **Exhaustive over adjacency**, because that is where the
          // boundary rule is load-bearing. Splicing the abbreviation against
          // every suffix and every prefix of the sample reaches the case the
          // hand-written list missed: `u.s.` sitting where an email's local
          // part goes, so the character after it is `@`.
          const spliced = [`${abbreviation} ${sample}`, `${sample} ${abbreviation}`];
          for (let cut = 0; cut <= sample.length; cut += 1) {
            spliced.push(`closed ${abbreviation}${sample.slice(cut)}`);
            spliced.push(`closed ${sample.slice(0, cut)}${abbreviation}`);
          }
          for (const text of spliced) {
            const strict = findIdentityShapes(text)
              .map((hit) => hit.shape)
              .filter((shape) => shape !== 'initialism');
            const narrowed = findIdentityShapes(text, { allowCommonAbbreviations: true }).map(
              (hit) => hit.shape
            );
            for (const shape of strict) {
              expect({ text, shape, survived: narrowed.includes(shape) }).toEqual({
                text,
                shape,
                survived: true,
              });
            }
            checked += 1;
          }
        }
      }
    }
    // Meta-assertion: a loop that examined nothing would pass silently.
    expect(checked).toBeGreaterThan(1000);
  });

  it('does not let an abbreviation swallow the head of an email address', () => {
    // The measured instance, named on its own so a regression reads as itself
    // rather than as one of two hundred generated cases.
    const text = 'u.s.@mail.internal';
    expect(findIdentityShapes(text).map((hit) => hit.shape)).toContain('email');
    expect(
      findIdentityShapes(text, { allowCommonAbbreviations: true }).map((hit) => hit.shape)
    ).toContain('email');
    expect(NoteSchema.safeParse(text).success).toBe(false);
  });

  it('still sees a real initialism standing beside an abbreviation', () => {
    // The narrowing removes the abbreviation, not the shape. A club acronym in
    // the same sentence must survive.
    const text = 'closed after 6 p.m. for the S.R.F.C. tournament';
    expect(
      findIdentityShapes(text, { allowCommonAbbreviations: true }).map((hit) => hit.shape)
    ).toEqual(['initialism']);
    expect(NoteSchema.safeParse(text).success).toBe(false);
  });

  it('scans for literals, so a regex metacharacter in the list is inert', () => {
    // The control for removing the escaping class. `COMMON_ABBREVIATIONS` is
    // exported and meant to grow, and the realistic route to the old defect was
    // someone adding `no.(rev.)` - not an attacker. Passed as a *test-local*
    // list; the exported constant must never carry these.
    for (const hostile of ['no.(rev.)', 's+p', 'a[b', 'c\\d', '.*', '^$']) {
      const text = `keep ${hostile} keep`;
      // Neither throws...
      const stripped = withoutCommonAbbreviations(text, [hostile]);
      // ... nor strips more than the literal itself, which a pattern built by
      // an incomplete escape would have done - `.*` above is the clearest case.
      expect({ hostile, stripped }).toEqual({ hostile, stripped: 'keep  keep' });
    }
  });

  it('leaves text alone when a hostile entry does not literally occur', () => {
    // The other half: an entry that would match everything as a pattern must
    // match nothing as a literal.
    expect(withoutCommonAbbreviations('closed for reseeding', ['.*'])).toBe('closed for reseeding');
    expect(withoutCommonAbbreviations('a.b c', ['c\\d'])).toBe('a.b c');
  });

  it('builds no regular expression from a value, anywhere in the module', () => {
    // The class, asserted gone rather than described as gone. Two sites used to
    // construct one: the abbreviation stripper (from a list entry) and
    // `findIdentityShapes` (from `pattern.source`, to strip a `g` flag).
    // Neither exists now - the first scans for literals, the second forbids the
    // flag at the source instead - so the module has nothing to escape.
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../packages/core/src/privacy/textShapes.js'
      ),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1 ');
    // Meta-assertion: a comment stripper that ate the file would make the line
    // below pass over nothing.
    expect(code).toContain('export function withoutCommonAbbreviations');
    expect(code).not.toContain('new RegExp');
  });

  it('refuses a global identity shape at module load', () => {
    // Why the rebuild could be removed: `String.match` with a `g` pattern
    // returns every match rather than a match object, and a shared `g` pattern
    // carries `lastIndex` between calls. Forbidding the flag is what makes
    // using the declared pattern directly safe.
    for (const { name, pattern } of IDENTITY_SHAPES) {
      expect({ name, global: pattern.global }).toEqual({ name, global: false });
    }
  });

  it('keeps its indices exact when a character lowercases to two', () => {
    // A defect found while writing this file, not by review: the scan
    // pre-computed `source.toLowerCase()` and indexed into it with offsets from
    // `source`. `'\u0130'.toLowerCase()` is two code units, so one such
    // character slid every later offset and the scan compared the wrong
    // positions. This instance failed safe - the abbreviation was simply not
    // stripped - but a misaligned match strips characters that are not the
    // abbreviation, and this runs *before* the identity scan, so it could break
    // an address apart until no shape matched it.
    expect(withoutCommonAbbreviations('\u0130\u0130\u0130 p.m.')).toBe('\u0130\u0130\u0130 ');
    expect(withoutCommonAbbreviations('\u0130 closed p.m. rest')).toBe('\u0130 closed  rest');

    // ... and the shapes that matter survive it.
    const text = '\u0130 p.m. zzq@zzqfictional.example';
    const narrowed = findIdentityShapes(text, { allowCommonAbbreviations: true }).map(
      (hit) => hit.shape
    );
    expect(narrowed).toContain('email');
    expect(narrowed).toContain('non-ascii-letter');
  });

  it('removes an abbreviation only as a whole token', () => {
    expect(withoutCommonAbbreviations('p.m.')).toBe('');
    expect(withoutCommonAbbreviations('a p.m. b')).toBe('a  b');
    // Inside a longer dotted run it is left exactly where the shape can see it.
    expect(withoutCommonAbbreviations('Xp.m.')).toBe('Xp.m.');
    expect(withoutCommonAbbreviations('S.p.m.C.')).toBe('S.p.m.C.');
  });

  it('names what tripped, so an operator can fix the value', () => {
    const result = NoteSchema.safeParse('call 925-555-0134');
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/phone-shaped text/);
  });
});

describe('fieldAdmin :: the blackout schema refuses a half-stated window', () => {
  it('accepts all day and accepts a timed window', () => {
    expect(blackout('b1').startMinutes).toBeNull();
    expect(blackout('b1', { startMinutes: 960, endMinutes: 1140 }).endMinutes).toBe(1140);
  });

  it('refuses one time without the other', () => {
    // "Closed from 16:00" is ambiguous between "until close" and "for an
    // unstated length", and the constraint sheet writes neither.
    expect(() => blackout('b1', { startMinutes: 960 })).toThrow();
    expect(() => blackout('b1', { endMinutes: 1140 })).toThrow();
  });

  it('refuses an end before a start, in dates and in minutes', () => {
    expect(() => blackout('b1', { fromDate: '2026-09-09', toDate: '2026-09-01' })).toThrow();
    expect(() => blackout('b1', { startMinutes: 1140, endMinutes: 960 })).toThrow();
  });

  it('refuses a scope that names no ground', () => {
    expect(() => blackout('b1', { scope: BLACKOUT_SCOPE.VENUE, venueIds: [] })).toThrow();
    expect(() =>
      blackout('b1', { scope: BLACKOUT_SCOPE.SURFACE, venueIds: ['v'], surfaceIds: [] })
    ).toThrow();
  });

  it('refuses an unrecognised key', () => {
    // `.strict()`, for the reason `facility/schemas.js` states.
    expect(() => blackout('b1', { unexpected: true })).toThrow();
  });
});
