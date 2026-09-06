/**
 * **The change set: what an import proposes, and what it refuses to decide.**
 *
 * An import here is a **proposal**, never an application. Nothing in this file
 * writes to any store; every change set carries
 * {@link FIELD_ADMIN_REASON.CHANGE_SET_NOT_APPLIED} so no report can imply
 * otherwise.
 *
 * ## Parity's shape, not parity's function
 *
 * `PHASE_8_PLAN.md` §8.4 says `publication/parity.js` "already has the
 * partitioning shape (matched / differing / added / removed); reuse it rather
 * than inventing a second vocabulary". That is read here as **the shape, not
 * the function**, and the reason is in parity's own docstring: its subjects are
 * `ParityRow`s whose fields are `outputGeneration.js`'s export columns, and
 * `assertSubjectFields()` throws on any field outside `PARITY_FIELD_ORDER`. A
 * blackout keys on ground, dates and minutes past midnight; not one of those is
 * a parity field, so `compareParityRows()` cannot be called on one without
 * routing facility subjects through the column set the club happens to publish
 * its games in.
 *
 * `scenario/diff.js` set this precedent in Phase 6.1 and parity's docstring
 * records it: adopt the shape - enumerated from both sides, every subject in
 * exactly one bucket, totals reconciled against both inputs, **the
 * reconciliation exported so a test can make it fail** - without calling it.
 * {@link changeSetPartitionFindings} is that reconciliation, and
 * `tests/fieldAdminChangeSet.test.js` hands it a partition with a subject
 * dropped and one with a subject counted twice and proves both fire.
 *
 * ## Two axes
 *
 * See `reasonCodes.js` for why the plan's four words are not a partition of one
 * thing. In short: **interpretation** asks whether a source row became a record
 * at all; **disposition** asks how that record compares with what is held. A
 * row that cannot be interpreted has no disposition, and it is reported on its
 * own axis rather than as a disposition it does not have.
 *
 * Disposition carries **five** values, not parity's four. `uncompared` is the
 * fifth: both sides hold the subject and every compared field was absent, so it
 * is neither a match nor a difference.
 *
 * **Why five here and four there**, since the shape is otherwise parity's:
 * `uncompared` is an *extension* for a case parity answers with a finding
 * instead of a bucket, not a renaming of any of parity's four. Read out of
 * `compareParityRows()` rather than assumed - it skips a compared field whose
 * cell is absent on either side, so a pair with every field skipped has an
 * empty `changedFields` and goes to `matched`, with the absence on
 * `pair.absentFields` and a `PARITY_FIELD_ABSENT` finding. That is a complete
 * answer in a report read beside its findings. It is not one here, where
 * `SUBJECTS_MATCHED` counts a bucket and asserts those subjects agree. The
 * four shared names keep parity's meanings exactly; the fifth is added beside
 * them.
 *
 * ## Where two sources disagree, both are carried
 *
 * The club keeps two decoder rings and they disagree on 12 of the 20 codes they
 * share. This module reports all 12 as `differing`, applies none of them, and
 * attaches the disagreement's **kind** so the composition survives the count.
 * It does not pick, and it does not reconcile.
 *
 * **The scope of that 12 matters, and only the adapter used to state it.** The
 * 12 is a count over `actual_label` - what each ring *calls* the ground.
 * Including the venue cell gives **13**, because `11v11 Field 1` has both rings
 * writing `Willowmead Park Turf` while the practice ring leaves the venue
 * blank; that thirteenth is reported on the interpretation axis, where a row
 * that names no venue belongs.
 *
 * Labels are the right scope because `compareDecoderRings()` in the corpus
 * loader is the single producer of "decoder-ring disagreement", and it compares
 * labels. A second scope here would be a second producer of one derived status,
 * which is the defect Phase 8.0's first review round already found once.
 *
 * @module fieldAdmin/changeSet
 */

import {
  DISPOSITION,
  FIELD_ADMIN_REASON,
  INTERPRETATION,
  assertFieldAdminFindings,
  createFieldAdminMeta,
  deriveFieldAdminStatus,
  makeFieldAdminFinding,
} from './reasonCodes.js';

/** How many example keys an aggregate finding carries. */
const EXAMPLE_LIMIT = 5;

/**
 * Name one side of a disagreement so an operator can find the row.
 *
 * The file alone is not enough when two rows of *one* sheet disagree - which is
 * the corpus's own case, `field_inventory.csv` listing Willowmead Park twice -
 * so the row index comes along whenever the files are the same.
 *
 * @param {import('./types.js').ChangeSetSubject} entry
 * @param {number} index - position within the subject's rows
 * @returns {string}
 */
function sourceLabel(entry, index) {
  const rows = entry.rows.filter((row) => row.record !== null);
  const row = rows[index];
  if (row === undefined) return 'an unnamed source';
  const sameFile = rows.filter((other) => other.sourceFile === row.sourceFile).length > 1;
  return sameFile ? `${row.sourceFile} row ${row.rowIndex}` : row.sourceFile;
}

/**
 * The separator between parts of a rendered value or a composite key.
 *
 * `\u0000` written as an escape, never as a raw byte: `CLAUDE.md` §3 records a
 * raw NUL once making a 57 KB file merge as an opaque binary blob whose diff
 * nobody could read, and `tests/sourceHygiene.test.js` enforces the escape.
 *
 * NUL rather than a space or a comma because it cannot occur in an id, a venue
 * name or a date, so `['a b']` and `['a', 'b']` render differently - which for
 * ground is a different answer. `facility/aliases.js` joins candidate surface
 * sets the same way for the same reason.
 */
const SEPARATOR = '\u0000';

/**
 * Every interpretation state, so a switch over them can be exhaustive.
 *
 * Read back out of the enum rather than written again, so adding a state
 * without an arm fails rather than ageing this list.
 */
const INTERPRETATION_VALUES = Object.freeze(Object.values(INTERPRETATION));

/**
 * **The one key space.** A record's identity under the subject's key fields.
 *
 * Both sides of every comparison go through this, and that is the whole point.
 * An earlier version keyed the held side on `keyFields` and the proposed side
 * on each projector's own `subjectKey` string. The two agreed on the decoder
 * rings by coincidence -- `keyFields: ['displayName']` and a `subjectKey` of
 * the display name -- and could never agree anywhere else: `blackouts` keys on
 * `id` (`field_constraints.csv#3`) while its projector composed
 * `` `${venue} ${fromDate} ${toDate} ${fieldsRaw}` ``. Re-importing an export
 * of the corpus reported **11 removed and 11 added for identical input**, with
 * eleven blocking `SUBJECT_REMOVED` findings, and nothing caught it because
 * every test held an empty current state.
 *
 * `subjectKey` survives as what it always should have been: a **label** for a
 * human, used in findings and on unresolvable rows, which have no record to key
 * on at all. It is never an identity again.
 *
 * @param {Record<string, unknown>} record
 * @param {ReadonlyArray<string>} keyFields
 * @returns {string}
 */
export function subjectIdentity(record, keyFields) {
  return keyFields.map((field) => renderValue(record[field])).join(SEPARATOR);
}

/**
 * Group projected rows by the identity of the record they carry.
 *
 * A `Map` rather than an object: a key is built from data cells, and
 * `__proto__` must be a key like any other.
 *
 * @param {ReadonlyArray<import('./types.js').ProjectedRow>} rows
 * @param {ReadonlyArray<string>} keyFields
 * @returns {Map<string, import('./types.js').ProjectedRow[]>}
 */
function groupBySubject(rows, keyFields) {
  /** @type {Map<string, import('./types.js').ProjectedRow[]>} */
  const grouped = new Map();
  for (const row of rows) {
    const key = subjectIdentity(/** @type {Record<string, unknown>} */ (row.record), keyFields);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [row]);
    else bucket.push(row);
  }
  return grouped;
}

/**
 * Split projected rows by interpretation, exhaustively.
 *
 * The `default:` arm **throws**, naming the union. Phase 8.3 found three silent
 * `default:` arms in two review rounds, each dropping a case while a
 * meta-counter testified it had been examined; nothing in the repo checks for
 * that class generally, so every switch in this module names its union.
 *
 * @param {ReadonlyArray<import('./types.js').ProjectedRow>} rows
 * @returns {{ usable: import('./types.js').ProjectedRow[], unresolvable: import('./types.js').ProjectedRow[], interpreted: number, doubtful: number }}
 */
export function splitByInterpretation(rows) {
  /** @type {import('./types.js').ProjectedRow[]} */
  const usable = [];
  /** @type {import('./types.js').ProjectedRow[]} */
  const unresolvable = [];
  let interpreted = 0;
  let doubtful = 0;

  for (const row of rows) {
    switch (row.interpretation) {
      case INTERPRETATION.INTERPRETED:
        interpreted += 1;
        usable.push(row);
        break;
      case INTERPRETATION.DOUBTFUL:
        doubtful += 1;
        usable.push(row);
        break;
      case INTERPRETATION.UNRESOLVABLE:
        unresolvable.push(row);
        break;
      default:
        throw new Error(
          `fieldAdmin: interpretation "${row.interpretation}" has no arm; add one beside its neighbours in INTERPRETATION (${INTERPRETATION_VALUES.join(', ')})`
        );
    }
  }

  return { usable, unresolvable, interpreted, doubtful };
}

/**
 * Compare one projected record against one held record over the compared
 * fields.
 *
 * An **absent** cell on either side is recorded as absent and is counted as
 * neither agreement nor difference, exactly as `compareParityRows()` treats
 * one. Folding "we do not know" into "the same" is how a missing value reads as
 * a match.
 *
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @param {ReadonlyArray<string>} comparedFields
 * @returns {{ changedFields: string[], absentFields: string[], comparisons: number }}
 */
function compareRecords(before, after, comparedFields) {
  /** @type {string[]} */
  const changedFields = [];
  /** @type {string[]} */
  const absentFields = [];
  let comparisons = 0;

  for (const field of comparedFields) {
    const beforeValue = before[field];
    const afterValue = after[field];
    const beforeAbsent = beforeValue === null || beforeValue === undefined;
    const afterAbsent = afterValue === null || afterValue === undefined;
    if (beforeAbsent || afterAbsent) {
      absentFields.push(field);
      continue;
    }
    comparisons += 1;
    // Arrays of ids are ordinary values here; comparing them by a stable
    // rendering keeps `['a','b']` equal to `['a','b']` without making
    // `['b','a']` equal to it, which for ground would be a different answer.
    if (renderValue(beforeValue) !== renderValue(afterValue)) changedFields.push(field);
  }

  return { changedFields, absentFields, comparisons };
}

/**
 * One stable rendering of a comparable value.
 *
 * The single producer of "are these two cells the same", so a comparison and a
 * serialisation cannot disagree about it.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function renderValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => renderValue(item)).join(SEPARATOR);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // **A plain object must render its contents, not its type.** `String({})` is
  // `"[object Object]"`, which makes every object equal to every other one: an
  // `equipment` list of `{item, value}` pairs compared clean while a quantity
  // changed underneath it, and the subject was then reported applicable. Keys
  // are sorted so two objects written in different key orders still compare
  // equal, because for a record they are the same record.
  if (typeof value === 'object') {
    return Object.keys(/** @type {Record<string, unknown>} */ (value))
      .sort()
      .map((key) => `${key}=${renderValue(/** @type {Record<string, unknown>} */ (value)[key])}`)
      .join(SEPARATOR);
  }
  return String(value);
}

/**
 * **Every subject a change set holds, in one place.**
 *
 * When `uncompared` arrived, sixteen places across the module and its tests
 * spread the disposition buckets by hand, and **thirteen of the sixteen
 * silently kept covering four of five** - each one a place where a subject
 * could sit in a bucket nobody looked in. (A measurement of that moment, not a
 * standing count: a live total in a docstring is prose that goes stale, which
 * is the failure this module is otherwise built against.) Patching thirteen
 * call sites leaves the seventeenth to be written wrong; one producer does
 * not.
 *
 * Built from {@link DISPOSITION} rather than from a written-out list, so a
 * sixth value cannot be added without this function carrying it - and
 * {@link assertEveryDispositionCovered} proves that in a test.
 *
 * @param {{ buckets: Object }|Object} changeSetOrPartition - a change set or a bare partition
 * @returns {import('./types.js').ChangeSetSubject[]}
 */
export function everySubject(changeSetOrPartition) {
  const buckets = assertEveryBucketPresent(
    /** @type {Object} */ (changeSetOrPartition).buckets ?? changeSetOrPartition
  );
  return Object.values(DISPOSITION).flatMap((disposition) => buckets[BUCKET_OF[disposition]]);
}

/**
 * Every bucket {@link BUCKET_OF} names is present and is an array.
 *
 * **The fifth bucket used to be the only lenient one.** `matched`, `differing`,
 * `added` and `removed` were read straight off the partition and would throw on
 * a missing one; `uncompared` was read as `partition.uncompared ?? []`, and
 * `everySubject()` skipped any bucket that was not an array. A partition built
 * without the fifth bucket therefore reconciled to zero and came back clean --
 * the four-strict-one-lenient split the twin sweep exists to find, in the one
 * function written to stop exactly that.
 *
 * @param {Object} buckets
 * @returns {Record<string, import('./types.js').ChangeSetSubject[]>}
 */
function assertEveryBucketPresent(buckets) {
  const missing = Object.values(BUCKET_OF).filter(
    (name) => !Array.isArray(/** @type {Record<string, unknown>} */ (buckets)[name])
  );
  if (missing.length > 0) {
    throw new Error(
      `fieldAdmin: partition is missing the bucket(s) [${missing.join(', ')}]; every disposition in [${Object.values(DISPOSITION).join(', ')}] must have one`
    );
  }
  return /** @type {Record<string, import('./types.js').ChangeSetSubject[]>} */ (buckets);
}

/**
 * The bucket name each disposition lives in.
 *
 * They are the same word today and this map exists so they need not stay that
 * way - and so {@link everySubject} reads the buckets *through* the enum rather
 * than beside it, which is what makes a missing bucket a loud failure.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BUCKET_OF = Object.freeze({
  [DISPOSITION.MATCHED]: 'matched',
  [DISPOSITION.DIFFERING]: 'differing',
  [DISPOSITION.ADDED]: 'added',
  [DISPOSITION.REMOVED]: 'removed',
  [DISPOSITION.UNCOMPARED]: 'uncompared',
});

/**
 * Every disposition has a bucket, and every bucket a disposition.
 *
 * Exported so a test can hold {@link BUCKET_OF} to {@link DISPOSITION} in both
 * directions rather than trusting that the two were edited together.
 *
 * @returns {{ dispositions: string[], buckets: string[] }}
 */
export function assertEveryDispositionCovered() {
  const dispositions = Object.values(DISPOSITION).sort();
  const buckets = Object.keys(BUCKET_OF).sort();
  if (dispositions.join(',') !== buckets.join(',')) {
    throw new Error(
      `fieldAdmin: BUCKET_OF covers [${buckets.join(', ')}] but DISPOSITION declares [${dispositions.join(', ')}]`
    );
  }
  return { dispositions, buckets: Object.values(BUCKET_OF).sort() };
}

/**
 * Does the partition account for every input exactly once, on **both** axes?
 *
 * **Exported, and given its counts as arguments** rather than closing over the
 * comparison, for the reason `parityPartitionFindings()` is: a check nobody can
 * make fail is not a check. The test hands this a partition with a subject
 * dropped and one with a subject counted twice, and proves both fire.
 *
 * Both axes are reconciled, because a partition can be sound on one and broken
 * on the other: rows can go missing between projection and comparison while the
 * disposition buckets still add up among themselves.
 *
 * @param {import('./types.js').ChangeSetPartition} partition
 * @param {{ sourceRowsRead: number, currentSubjectsRead: number, projectedSubjects: number }} counts
 * @returns {import('./types.js').FieldAdminFinding[]}
 */
export function changeSetPartitionFindings(partition, counts) {
  // First, so a partition missing a bucket is named rather than surfacing as a
  // `TypeError` from whichever line happens to read it first.
  assertEveryBucketPresent(partition);
  const matched = partition.matched.length;
  const differing = partition.differing.length;
  const added = partition.added.length;
  const removed = partition.removed.length;
  const uncompared = partition.uncompared.length;
  const unresolvable = partition.unresolvable.length;

  /** @type {import('./types.js').FieldAdminFinding[]} */
  const findings = [];

  /* -- axis 1: every source row is interpreted, doubtful or unresolvable -- */
  // Every subject that came from a source row, derived rather than spelled out.
  // `removed` is the one disposition excluded, because a removed subject is
  // named by no source row and carries none; every other disposition -- a sixth
  // included -- is counted here by default. The hand-written version of this
  // sum named four buckets and would have been the next one to keep covering
  // four of five.
  const rowsAccounted =
    everySubject(partition)
      .filter((subject) => subject.disposition !== DISPOSITION.REMOVED)
      .reduce((sum, subject) => sum + subject.rows.length, 0) + unresolvable;
  if (rowsAccounted !== counts.sourceRowsRead) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.CHANGE_SET_PARTITION_INCOMPLETE,
        `the partition accounts for ${rowsAccounted} source row(s) of ${counts.sourceRowsRead}: ${rowsAccounted - unresolvable} carried on a subject and ${unresolvable} unresolvable`,
        {
          axis: 'interpretation',
          accounted: rowsAccounted,
          expected: counts.sourceRowsRead,
          unresolvable,
        }
      )
    );
  }

  /* -- axis 2: every subject, from each side ---------------------------- */
  //
  // **Counted from `before` / `after`, not from bucket membership.** The
  // obvious reconciliation is `matched + differing + removed === held`, and it
  // is wrong here: a subject whose two *sources* disagree is `differing` even
  // when nothing is held, so bucket membership no longer implies which sides a
  // subject stands on. Counting the sides directly says what is actually meant
  // - every held subject is accounted for exactly once, and so is every
  // proposed one - and it keeps working whatever the bucket rules become.
  // Through the one producer, so a sixth disposition cannot be forgotten here.
  const subjects = everySubject(partition);
  // **Held *records*, not held subjects.** A key that two held records share is
  // one subject carrying both, so counting subjects would leave the surplus
  // unaccounted for and report a partition hole that is not one. `heldCount` is
  // what each subject actually stands for on the held side.
  //
  // Read **strictly**, the same as the buckets a few lines up. `heldCount` was
  // read as `subject.heldCount ?? 0`, and `types.js` declares it a required
  // `number`: all four construction sites set it, so the default only ever
  // covered a state the production path cannot reach -- while silently
  // under-counting the held side and reporting a partition hole that is not
  // one if anything ever did reach it. The twin of the tolerant fifth bucket,
  // one function away from it.
  const currentAccounted = subjects.reduce((sum, subject) => {
    if (typeof subject.heldCount !== 'number') {
      throw new Error(
        `fieldAdmin: subject "${subject.key}" carries no heldCount, so the held side cannot be reconciled`
      );
    }
    return sum + subject.heldCount;
  }, 0);
  if (currentAccounted !== counts.currentSubjectsRead) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.CHANGE_SET_PARTITION_INCOMPLETE,
        `the partition accounts for ${currentAccounted} held subject(s) of ${counts.currentSubjectsRead}: matched ${matched}, differing ${differing}, added ${added}, removed ${removed}, uncompared ${uncompared}`,
        {
          axis: 'disposition',
          side: 'current',
          accounted: currentAccounted,
          expected: counts.currentSubjectsRead,
          matched,
          differing,
          added,
          removed,
          uncompared,
        }
      )
    );
  }

  const proposedAccounted = subjects.filter((subject) => subject.after !== null).length;
  if (proposedAccounted !== counts.projectedSubjects) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.CHANGE_SET_PARTITION_INCOMPLETE,
        `the partition accounts for ${proposedAccounted} proposed subject(s) of ${counts.projectedSubjects}: matched ${matched}, differing ${differing}, added ${added}, removed ${removed}, uncompared ${uncompared}`,
        {
          axis: 'disposition',
          side: 'proposed',
          accounted: proposedAccounted,
          expected: counts.projectedSubjects,
          matched,
          differing,
          added,
          removed,
          uncompared,
        }
      )
    );
  }

  return findings;
}

/**
 * Refuse a change set whose key or comparison is not a comparison at all.
 *
 * Thrown rather than reported, for the reason `assertSubjectFields()` throws: a
 * comparison over zero fields reports perfect agreement having looked at
 * nothing, and a field that is both the identity and the comparison compares a
 * set against itself. The second of those is the exact defect the Phase 2
 * review found in the flagship "examined every division" check.
 *
 * @param {ReadonlyArray<string>} keyFields
 * @param {ReadonlyArray<string>} comparedFields
 * @returns {void}
 */
function assertSubjectFields(keyFields, comparedFields) {
  if (keyFields.length === 0) {
    throw new Error('fieldAdmin: a change set must key on at least one field');
  }
  if (comparedFields.length === 0) {
    throw new Error('fieldAdmin: a change set that compares no field compares nothing');
  }
  for (const field of comparedFields) {
    if (keyFields.includes(field)) {
      throw new Error(
        `fieldAdmin: "${field}" is both an identity field and a compared field, so it can only ever compare equal`
      );
    }
  }
}

/**
 * The disagreement across the source rows that named one subject, or `null`.
 *
 * `kind` is supplied by the projector rather than derived here, because two
 * producers already answer this question for the decoder rings -
 * `season2026PracticeParsers.js`'s `DECODER_DISAGREEMENT_KIND` and
 * `facility/aliases.js`'s `ALIAS_LABEL_AGREEMENT` - and a third would be the
 * second-producer defect that Phase 8.0's first review round already found once.
 *
 * @param {ReadonlyArray<import('./types.js').ProjectedRow>} rows
 * @param {ReadonlyArray<string>} comparedFields
 * @param {(rows: ReadonlyArray<import('./types.js').ProjectedRow>) => string} kindOf
 * @returns {import('./types.js').SourceDisagreement|null}
 */
function disagreementAcross(rows, comparedFields, kindOf, tally) {
  if (rows.length < 2) return null;
  const withRecords = rows.filter((row) => row.record !== null);
  if (withRecords.length < 2) return null;

  for (const field of comparedFields) {
    const values = withRecords.map((row) =>
      renderValue(/** @type {Record<string, unknown>} */ (row.record)[field])
    );
    // Counted whether or not it finds a difference. A comparison that happened
    // is evidence the change set looked at something, which is exactly what
    // CHANGE_SET_VACUOUS asks about - and counting only the differences would
    // make a set that agreed everywhere look like a set that compared nothing.
    tally.sourceComparisons += withRecords.length;
    if (new Set(values).size === 1) continue;
    return {
      kind: kindOf(withRecords),
      field,
      sources: withRecords.map((row) => row.sourceFile),
      values: withRecords.map(
        (row) =>
          /** @type {string|null} */ (
            /** @type {Record<string, unknown>} */ (row.record)[field] ?? null
          )
      ),
    };
  }
  return null;
}

/**
 * The default disagreement kind, for subjects with no vocabulary of their own.
 *
 * Deliberately **not** used for the decoder rings: `projectors/rings.js` passes
 * `labelAgreementOf`, which reuses `facility/aliases.js`'s
 * `ALIAS_LABEL_AGREEMENT` verbatim. Two producers already answer that question
 * for the rings and a third here would be the second-producer defect.
 *
 * @returns {string}
 */
export function defaultDisagreementKind() {
  return 'value-conflict';
}

/**
 * **Build a change set.** The one comparator in this module.
 *
 * @param {Object} input
 * @param {string} input.subject - what this is a change set of, in words
 * @param {{ label: string, records: ReadonlyArray<Record<string, unknown>> }} input.current
 * @param {{ label: string, rows: ReadonlyArray<import('./types.js').ProjectedRow> }} input.proposed
 * @param {ReadonlyArray<string>} input.keyFields
 * @param {ReadonlyArray<string>} input.comparedFields
 * @param {(rows: ReadonlyArray<import('./types.js').ProjectedRow>) => string} [input.disagreementKind]
 *   - names the *kind* of a source disagreement for this subject. Supplied by
 *     the projector that owns the subject's vocabulary rather than derived
 *     here, so a kind has one producer.
 * @returns {import('./types.js').ChangeSet}
 */
export function buildChangeSet(input) {
  const { subject, current, proposed, keyFields, comparedFields } = input;
  const disagreementKind = input.disagreementKind ?? defaultDisagreementKind;
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new Error('fieldAdmin: a change set must say what it is a change set of');
  }
  assertSubjectFields(keyFields, comparedFields);

  const meta = createFieldAdminMeta();
  /** @type {import('./types.js').FieldAdminFinding[]} */
  const findings = [];

  meta.sourceRowsRead = proposed.rows.length;
  meta.currentSubjectsRead = current.records.length;

  const split = splitByInterpretation(proposed.rows);
  meta.rowsInterpreted = split.interpreted;
  meta.rowsDoubtful = split.doubtful;
  meta.rowsUnresolvable = split.unresolvable.length;

  // **Never silently drop an unplaceable row.** One finding each, carrying the
  // raw cell, so an operator can see what the sheet said.
  for (const row of split.unresolvable) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.ROW_UNRESOLVABLE,
        `${row.sourceFile} row ${row.rowIndex} names "${row.subjectKey}", which resolved to no record: ${row.interpretationReason ?? 'no reason given'}`,
        {
          subject,
          sourceFile: row.sourceFile,
          rowIndex: row.rowIndex,
          subjectKey: row.subjectKey,
          reason: row.interpretationReason,
          raw: JSON.stringify(row.raw),
        }
      )
    );
  }

  // Both sides through `subjectIdentity()`. See its docstring for the defect
  // that made two key spaces worth a paragraph.
  //
  // **Grouped, not indexed.** `new Map(records.map(...))` last-wins on a
  // duplicate key, which is the same silent-collapse defect the source side had
  // - and it was measured on the held side too: re-importing the alias export
  // read 47 records into a 27-key map and dropped 20 with nothing naming them,
  // then compared each practice-ring record against the fields-ring one. A key
  // that does not identify a held record is reported, and the subject it
  // collides on is never applicable.
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const heldByKey = new Map();
  for (const record of current.records) {
    const key = subjectIdentity(record, keyFields);
    const bucket = heldByKey.get(key);
    if (bucket === undefined) heldByKey.set(key, [record]);
    else bucket.push(record);
  }
  for (const [key, records] of heldByKey) {
    if (records.length < 2) continue;
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.HELD_KEY_AMBIGUOUS,
        `identity "${key}" names ${records.length} held record(s), so ${keyFields.join(', ')} does not identify a record in "${subject}"; every one is counted and none is compared against`,
        { subject, key, heldCount: records.length }
      )
    );
  }
  const proposedByKey = groupBySubject(split.usable, keyFields);
  meta.projectedSubjects = proposedByKey.size;

  /** @type {import('./types.js').ChangeSetSubject[]} */
  const matched = [];
  /** @type {import('./types.js').ChangeSetSubject[]} */
  const differing = [];
  /** @type {import('./types.js').ChangeSetSubject[]} */
  const added = [];
  /** @type {import('./types.js').ChangeSetSubject[]} */
  const removed = [];
  /** @type {import('./types.js').ChangeSetSubject[]} */
  const uncompared = [];
  let fieldComparisons = 0;
  /** Comparisons made between two *sources* describing one subject. */
  const tally = { sourceComparisons: 0 };

  const keys = [...new Set([...heldByKey.keys(), ...proposedByKey.keys()])].sort();

  for (const key of keys) {
    const heldRecords = heldByKey.get(key) ?? [];
    // The first is read as the comparison subject, exactly as the first source
    // row is read as the proposal - and the ambiguity is already reported
    // above, which is what stops the choice being silent.
    const held = heldRecords.length > 0 ? heldRecords[0] : null;
    const heldAmbiguous = heldRecords.length > 1;
    const rows = proposedByKey.get(key) ?? [];

    if (rows.length === 0) {
      // Held and named by no source row. **The disposition the plan's four
      // words omit**, and the one that keeps an import non-destructive: it is
      // reported, and it is never applied.
      removed.push({
        key,
        // A held subject no source names has no source row to take a label
        // from, so the identity is the best label available.
        label: key,
        heldCount: heldRecords.length,
        disposition: DISPOSITION.REMOVED,
        changedFields: [],
        absentFields: [],
        before: held,
        after: null,
        rows: [],
        sourceDisagreement: null,
        applicable: false,
        notApplicableReason:
          'held in current state and named by no source row; an import proposes nothing here',
      });
      continue;
    }

    const disagreement = disagreementAcross(rows, comparedFields, disagreementKind, tally);
    const doubtful = rows.some((row) => row.interpretation === INTERPRETATION.DOUBTFUL);
    // **The first row is the proposal; the rest are carried, not applied.**
    //
    // Exactly as `compareDecoderRings()` reads the first ring while looking the
    // code up in the other. The others stay on `subject.rows`, so nothing is
    // hidden, and any disagreement between them over a compared field is
    // reported as `SOURCES_DISAGREE` and makes the subject non-applicable.
    //
    // **The bound this puts on a subject definition**, stated because it is not
    // obvious: a subject whose `keyFields` do not identify one record turns two
    // real records into one proposal plus a finding. That is right for the
    // decoder rings, where two rings describe one published name on purpose. It
    // would be wrong for, say, two permit reservations on one permit, date and
    // facility at different hours - so `permitWindows` keys on the row's own
    // `id`, which is unique by construction. A subject added here must key on
    // something that identifies a record, and `PARITY_KEY_AMBIGUOUS` one module
    // over is the same hazard under its own name.
    const record = /** @type {Record<string, unknown>} */ (rows[0].record);

    if (held === null) {
      // **A subject nothing holds is still `differing` when its own sources
      // disagree**, and this is the branch the decoder rings land in.
      //
      // `differing` here means "a person must decide before anything is
      // applied", and it is reached two ways: the proposal differs from what is
      // held, *or* the sources differ from each other. On a first import
      // nothing is held at all, so treating a two-ring conflict as a plain
      // `added` would make all 12 decoder-ring disagreements applicable - which
      // is precisely the silent reconciliation the corpus exists to prevent.
      // `added` therefore means "not held, **and** the sources agree", which
      // keeps the seven fields-ring-only codes where they belong.
      const entry = {
        key,
        label: rows[0].subjectKey,
        heldCount: 0,
        disposition: disagreement === null ? DISPOSITION.ADDED : DISPOSITION.DIFFERING,
        changedFields: [],
        absentFields: [],
        before: null,
        after: record,
        rows,
        sourceDisagreement: disagreement,
        applicable: disagreement === null && !doubtful,
        notApplicableReason: disagreement
          ? 'two sources disagree about this subject and neither is preferred'
          : doubtful
            ? 'built from a cell whose reading is in doubt'
            : null,
      };
      if (disagreement === null) added.push(entry);
      else differing.push(entry);
      continue;
    }

    const comparison = compareRecords(held, record, comparedFields);
    fieldComparisons += comparison.comparisons;
    const isDifferent = comparison.changedFields.length > 0 || disagreement !== null;
    // **A subject nothing looked at is not a subject that agreed.**
    //
    // A pair whose every compared field is absent on one side or the other
    // lands in `matched` with no changed fields - and used to report
    // `applicable: true` having performed zero comparisons.
    // `CHANGE_SET_UNCOMPARED` guards only the aggregate, so a set that compared
    // something *somewhere* could still carry a subject nothing had examined,
    // reported as safe to apply. Measured: a two-subject set came back `clean`
    // with "2 of 2 subject(s) could be applied".
    //
    // An `added` subject is deliberately not caught by this: it compares
    // nothing because there is nothing held to compare against, which is a
    // different statement from "we looked and learned nothing".
    const nothingCompared = comparison.comparisons === 0;
    const notApplicable = heldAmbiguous
      ? `${heldRecords.length} held records share this identity, so there is no single record to compare against`
      : nothingCompared
        ? `no field could be compared: ${comparison.absentFields.join(', ')} ${comparison.absentFields.length === 1 ? 'is' : 'are'} absent on one side or the other`
        : null;
    /** @type {import('./types.js').ChangeSetSubject} */
    const entry = {
      key,
      label: rows[0].subjectKey,
      heldCount: heldRecords.length,
      disposition: isDifferent
        ? DISPOSITION.DIFFERING
        : nothingCompared
          ? DISPOSITION.UNCOMPARED
          : DISPOSITION.MATCHED,
      changedFields: comparison.changedFields,
      absentFields: comparison.absentFields,
      before: held,
      after: record,
      rows,
      sourceDisagreement: disagreement,
      applicable: !isDifferent && !doubtful && !heldAmbiguous && !nothingCompared,
      notApplicableReason:
        notApplicable ??
        (disagreement
          ? 'two sources disagree about this subject and neither is preferred'
          : isDifferent
            ? 'the source differs from what is held; a person decides'
            : doubtful
              ? 'built from a cell whose reading is in doubt'
              : null),
    };
    // **A subject nothing compared is not a match.** It leaves `matched`
    // entirely rather than merely losing `applicable`: staying there kept it
    // inside the `SUBJECTS_MATCHED` count and message, and left the whole set
    // reading `clean`.
    if (isDifferent) differing.push(entry);
    else if (nothingCompared) uncompared.push(entry);
    else matched.push(entry);
  }

  /** @type {import('./types.js').ChangeSetPartition} */
  const partition = {
    matched,
    differing,
    added,
    removed,
    uncompared,
    unresolvable: split.unresolvable,
    fieldComparisons,
  };

  /**
   * Every subject that came from a source row.
   *
   * **Written as the exclusion of the one disposition that cannot, not as a
   * list of the ones that can.** `removed` means held and named by no source
   * row, so it can carry no source disagreement; every other disposition came
   * from a row and can. A sixth disposition therefore joins this set by
   * default, and leaving it out would take an edit someone has to justify --
   * which is the opposite of the four hand-written spreads this replaces, where
   * `uncompared` was silently missing from three of them.
   */
  const sourcedSubjects = everySubject(partition).filter(
    (entry) => entry.disposition !== DISPOSITION.REMOVED
  );

  meta.subjectsMatched = matched.length;
  meta.subjectsDiffering = differing.length;
  meta.subjectsAdded = added.length;
  meta.subjectsRemoved = removed.length;
  meta.subjectsUncompared = uncompared.length;
  meta.fieldComparisons = fieldComparisons;
  meta.sourceComparisons = tally.sourceComparisons;
  meta.subjectsWithSourceDisagreement = sourcedSubjects.filter(
    (entry) => entry.sourceDisagreement !== null
  ).length;
  meta.subjectsApplicable = everySubject(partition).filter((entry) => entry.applicable).length;

  findings.push(
    ...changeSetPartitionFindings(partition, {
      sourceRowsRead: meta.sourceRowsRead,
      currentSubjectsRead: meta.currentSubjectsRead,
      projectedSubjects: meta.projectedSubjects,
    })
  );

  for (const row of split.usable) {
    if (row.interpretation !== INTERPRETATION.DOUBTFUL) continue;
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.ROW_DOUBTFUL,
        `${row.sourceFile} row ${row.rowIndex} ("${row.subjectKey}") was read as ${row.interpretationReason ?? 'doubtful'}; the raw cell is kept beside the reading so it can be overruled`,
        {
          subject,
          sourceFile: row.sourceFile,
          rowIndex: row.rowIndex,
          subjectKey: row.subjectKey,
          reason: row.interpretationReason,
          raw: JSON.stringify(row.raw),
        }
      )
    );
  }

  // One finding per differing subject and per removal: each needs a person.
  //
  // **Both messages that name sources go through `sourceLabel()`.** This one
  // used to `sources.join(' and ')` raw, so the corpus emitted `"Willowmead
  // Park" is described differently by field_inventory.csv and
  // field_inventory.csv` - the same file twice, saying nothing about which row.
  // Its twin `SOURCES_DISAGREE` was corrected in the previous round and this
  // was not, which is the half-application shape this PR keeps producing.
  for (const entry of differing) {
    const what =
      entry.changedFields.length > 0
        ? `differs from ${current.label} in ${entry.changedFields.join(', ')}`
        : `is described differently by ${
            entry.sourceDisagreement
              ? entry.sourceDisagreement.values
                  .map((_value, index) => sourceLabel(entry, index))
                  .join(' and ')
              : 'two sources'
          }`;
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.SUBJECT_DIFFERS,
        `"${entry.label}" ${what}; nothing is applied`,
        {
          subject,
          key: entry.key,
          changedFields: entry.changedFields.join(','),
          disagreementKind: entry.sourceDisagreement?.kind ?? null,
        }
      )
    );
  }

  for (const entry of uncompared) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.SUBJECT_UNCOMPARED,
        `"${entry.label}" is held and proposed, and every compared field (${entry.absentFields.join(', ')}) is absent on one side or the other, so nothing was learned about it; it is neither a match nor a difference`,
        { subject, key: entry.key, absentFields: entry.absentFields.join(',') }
      )
    );
  }

  for (const entry of removed) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.SUBJECT_REMOVED,
        `"${entry.label}" is held in ${current.label} and named by no row of ${proposed.label}; an import proposes nothing here and removes nothing`,
        { subject, key: entry.key }
      )
    );
  }

  // Where two sources disagree, **surface both and refuse to pick**.
  for (const entry of sourcedSubjects) {
    if (entry.sourceDisagreement === null) continue;
    const { kind, field, sources, values } = entry.sourceDisagreement;
    // **`field` is named**, and it was computed and never read until the review
    // pointed at it. The cost was visible on real data: the corpus's own
    // finding read `"11v11 (2)" per field_inventory.csv and "11v11" per
    // field_inventory.csv` - the same file twice and no column, which is
    // exactly what `field` supplies. Honoured rather than deleted, because a
    // disagreement an operator cannot locate is one they cannot act on.
    //
    // The source is disambiguated by position too, for the same reason: two
    // rows of one sheet can disagree with each other, and naming the file twice
    // says nothing about which row.
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.SOURCES_DISAGREE,
        `"${entry.label}" disagrees on ${field}: ${values
          .map((value, index) => `${JSON.stringify(value)} per ${sourceLabel(entry, index)}`)
          .join(' and ')}; every candidate is carried and none is preferred`,
        {
          subject,
          key: entry.key,
          kind,
          field,
          sources: sources.join(','),
          values: values.join(' | '),
        }
      )
    );
  }

  if (added.length > 0) {
    // One aggregate rather than one per subject, exactly as `PARITY_ROW_ADDED`
    // is: additions are news rather than divergence, and one finding each would
    // bury the differences that need a person.
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.SUBJECTS_ADDED,
        `${added.length} subject(s) in ${proposed.label} are not in ${current.label}; they are additions, not differences`,
        {
          subject,
          count: added.length,
          exampleKeys: added
            .slice(0, EXAMPLE_LIMIT)
            .map((entry) => entry.key)
            .join(' | '),
        }
      )
    );
  }

  if (matched.length > 0) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.SUBJECTS_MATCHED,
        `${matched.length} subject(s) of ${current.label} match ${proposed.label} on ${comparedFields.join(', ')}`,
        {
          subject,
          matched: matched.length,
          comparedFields: comparedFields.join(','),
          fieldComparisons,
        }
      )
    );
  }

  const subjectsPartitioned =
    matched.length + differing.length + added.length + removed.length + uncompared.length;
  // **Both kinds of comparison count.** A first import holds nothing, so no
  // `before`/`after` comparison happens at all - and yet comparing the two
  // decoder rings against each other is real work: **40** comparisons on the
  // season corpus, counted as `meta.sourceComparisons` and asserted in
  // `tests/fieldAdminSeason2026Import.test.js` rather than written here from
  // memory. (An earlier draft of this comment said 54, which was a guess; the
  // ring subject compares one field over the 20 codes both rings carry, and the
  // scan stops at the first field that differs.) Judging vacuity on
  // `fieldComparisons` alone reported the ring import, which found all 12
  // disagreements, as a change set that had looked at nothing.
  const comparisons = fieldComparisons + tally.sourceComparisons;
  if (subjectsPartitioned === 0) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.CHANGE_SET_VACUOUS,
        `"${subject}" partitioned 0 subject(s); a change set over nothing holds trivially and means nothing`,
        {
          subject,
          subjectsPartitioned,
          fieldComparisons,
          sourceComparisons: tally.sourceComparisons,
        }
      )
    );
  } else if (comparisons === 0) {
    findings.push(
      makeFieldAdminFinding(
        FIELD_ADMIN_REASON.CHANGE_SET_UNCOMPARED,
        `"${subject}" partitioned ${subjectsPartitioned} subject(s) and compared none of them: 0 field comparison(s) against ${current.label} and 0 between sources, so this is a first load rather than a reconciliation`,
        {
          subject,
          subjectsPartitioned,
          fieldComparisons,
          sourceComparisons: tally.sourceComparisons,
        }
      )
    );
  }

  // **Emitted always.** Import is a proposal; this module applies nothing.
  findings.push(
    makeFieldAdminFinding(
      FIELD_ADMIN_REASON.CHANGE_SET_NOT_APPLIED,
      `"${subject}" is a proposal: ${meta.subjectsApplicable} of ${subjectsPartitioned} subject(s) could be applied without a person deciding, and this module applies none of them`,
      { subject, applicable: meta.subjectsApplicable, partitioned: subjectsPartitioned }
    )
  );

  assertFieldAdminFindings(findings, `change set "${subject}"`);

  return {
    subject,
    currentLabel: current.label,
    proposedLabel: proposed.label,
    keyFields: [...keyFields],
    comparedFields: [...comparedFields],
    buckets: partition,
    findings,
    status: deriveFieldAdminStatus(findings),
    meta,
  };
}
