/**
 * **Parity: is what we have still what we told them?**
 *
 * > *"Recovery was only possible by re-importing the published schedule and
 * > treating it as ground truth and diffing row by row."* — incident 1, on a
 * > season in which 366 of 679 games had silently moved.
 *
 * One comparator, over two sets of normalised parity rows. It does not care
 * whether a row came from a {@link import('./snapshot.js').makePublicationSnapshot}
 * artifact, from a fresh `publicationRowsFor()` projection, or from an
 * externally-sourced export somebody re-imported from the public website — the
 * adapters in `rows.js` and `adapters/` are thin functions into one row shape,
 * and this is the only place two rows are ever compared.
 *
 * ## Four buckets, enumerated from both sides
 *
 * `matched`, `differing`, `added`, `removed`, with
 * `matched + differing + added + removed === rowsCompared` **counted** rather
 * than asserted from how the lists were built ({@link parityPartitionFindings},
 * exported so a test can hand it an inconsistent partition and watch it fire).
 *
 * The distinction between `added` and `differing` is the whole acceptance test.
 * The published rec artifact holds 567 rows; the working schedule holds those
 * 567 plus a 112-row 11v11 layer that was never published to families. Those
 * 112 are **additions**, not differences, and a checker that reported them as
 * divergence would raise a 112-row false alarm on a schedule that is in fact
 * byte-for-byte faithful. So `PARITY_ROW_ADDED` is `info` and reaches the
 * findings as a single aggregate, while `PARITY_ROW_DIFFERS` and
 * `PARITY_ROW_REMOVED` are `blocking` and reach it one row at a time: a
 * divergence and a vanished fixture each need a person to look at that row.
 *
 * ## Field-name mapping, and why it is falsifiable on its own
 *
 * The public view spells things differently from internal storage, so rules
 * translate labels before anything is compared. The trap is that a mapping
 * table is invisible when it is wrong: on this corpus the published rec rows
 * and the working schedule are byte-identical across all eight columns, so
 * **an empty mapping table passes the 567/567 test** and a table full of
 * plausible rules for labels that no longer exist would pass it too.
 *
 * Hence `mappingRulesDeclared` versus `mappingRulesApplied` in the meta, both
 * reported rather than one implied from the other, and
 * `MAPPING_RULE_UNEXERCISED` at **blocking** for a declared rule that matched
 * nothing. A report over the rec subject says `mappingRulesApplied: 0` in as
 * many words rather than letting a reader assume a translation happened.
 *
 * @module publication/parity
 */

import {
  PARITY_BUCKET,
  PUBLICATION_REASON,
  createPublicationMeta,
  derivePublicationStatus,
  makePublicationFinding,
} from './reasonCodes.js';
import { PARITY_FIELD_ORDER, isParityField, parityRowKey, populatedParityFields } from './rows.js';
import { MappingRuleSchema } from './schemas.js';

/** How many example ids an aggregate finding carries. */
const EXAMPLE_LIMIT = 5;

/**
 * `${home} v ${away}` — the same label shape `resolve/state.js`
 * `diffAgainstBaseline()` puts on a `ScheduleChange`, so a notice built from
 * either reads the same way.
 *
 * @param {import('./types.js').ParityRow} row
 * @returns {string}
 */
function labelOf(row) {
  return `${row.home ?? '?'} v ${row.away ?? '?'}`;
}

/**
 * Apply mapping rules to one side's rows.
 *
 * Rules run **in declaration order against the row as progressively
 * rewritten**, so a later rule sees what an earlier one produced. That is
 * stated rather than left to be discovered: it is what lets one rule normalise
 * a venue and a second key off the normalised value, and it is also why a rule
 * whose `match` a previous rule destroys will report itself unexercised rather
 * than silently doing nothing.
 *
 * @param {ReadonlyArray<import('./types.js').ParityRow>} rows
 * @param {ReadonlyArray<import('./types.js').MappingRule>} rules
 * @returns {{ rows: import('./types.js').ParityRow[], applications: number[], rowsRewritten: number }}
 */
export function applyMappingRules(rows, rules) {
  const applications = rules.map(() => 0);
  let rowsRewritten = 0;

  const mapped = rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const working = { ...row };
    let touched = false;
    rules.forEach((rule, index) => {
      const matches = Object.entries(rule.match).every(
        ([field, value]) => working[field] === value
      );
      if (!matches) return;
      for (const [field, value] of Object.entries(rule.set)) working[field] = value;
      applications[index] += 1;
      touched = true;
    });
    if (touched) rowsRewritten += 1;
    return /** @type {import('./types.js').ParityRow} */ (working);
  });

  return { rows: mapped, applications, rowsRewritten };
}

/**
 * Group rows by their identity under the subject's key fields.
 *
 * @param {ReadonlyArray<import('./types.js').ParityRow>} rows
 * @param {ReadonlyArray<string>} keyFields
 * @returns {Map<string, import('./types.js').ParityRow[]>}
 */
function groupByKey(rows, keyFields) {
  /** @type {Map<string, import('./types.js').ParityRow[]>} */
  const grouped = new Map();
  for (const row of rows) {
    const key = parityRowKey(row, keyFields);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [row]);
    else bucket.push(row);
  }
  return grouped;
}

/**
 * **The comparator.** Partition two row sets into the four buckets.
 *
 * Pure: no findings, no counters beyond what it returns, no opinion about
 * severity. {@link checkParity} is the layer that judges. Kept separate and
 * exported because Phase 6.1's scenario diff is this same comparison over two
 * derived schedules, and the repository is not acquiring a second one.
 *
 * Rows sharing one key are paired in input order and the surplus falls into
 * `added` or `removed`; the ambiguity is reported rather than resolved, because
 * a key that does not identify a row can pair the wrong two.
 *
 * @param {Object} input
 * @param {ReadonlyArray<import('./types.js').ParityRow>} input.published
 * @param {ReadonlyArray<import('./types.js').ParityRow>} input.current
 * @param {ReadonlyArray<string>} input.keyFields
 * @param {ReadonlyArray<string>} input.comparedFields
 * @returns {import('./types.js').ParityPartition}
 */
export function compareParityRows({ published, current, keyFields, comparedFields }) {
  const publishedByKey = groupByKey(published, keyFields);
  const currentByKey = groupByKey(current, keyFields);

  /** @type {import('./types.js').ParityPair[]} */
  const matched = [];
  /** @type {import('./types.js').ParityPair[]} */
  const differing = [];
  /** @type {import('./types.js').ParityOrphan[]} */
  const added = [];
  /** @type {import('./types.js').ParityOrphan[]} */
  const removed = [];
  /** @type {import('./types.js').ParityKeyAmbiguity[]} */
  const ambiguousKeys = [];
  /** @type {Array<{ key: string, field: string, side: string }>} */
  const absentFieldCells = [];
  let fieldComparisons = 0;

  const keys = [...new Set([...publishedByKey.keys(), ...currentByKey.keys()])].sort();

  for (const key of keys) {
    const publishedRows = publishedByKey.get(key) ?? [];
    const currentRows = currentByKey.get(key) ?? [];

    if (publishedRows.length > 1 || currentRows.length > 1) {
      ambiguousKeys.push({
        key,
        publishedCount: publishedRows.length,
        currentCount: currentRows.length,
      });
    }

    const pairCount = Math.min(publishedRows.length, currentRows.length);
    for (let index = 0; index < pairCount; index += 1) {
      const publishedRow = publishedRows[index];
      const currentRow = currentRows[index];
      /** @type {string[]} */
      const changedFields = [];
      /** @type {string[]} */
      const absentFields = [];
      /** @type {Record<string, unknown>} */
      const before = {};
      /** @type {Record<string, unknown>} */
      const after = {};

      for (const field of comparedFields) {
        const publishedValue = publishedRow[field];
        const currentValue = currentRow[field];
        before[field] = publishedValue ?? null;
        after[field] = currentValue ?? null;
        const publishedAbsent = publishedValue === null || publishedValue === undefined;
        const currentAbsent = currentValue === null || currentValue === undefined;
        if (publishedAbsent || currentAbsent) {
          absentFields.push(field);
          if (publishedAbsent) absentFieldCells.push({ key, field, side: 'published' });
          if (currentAbsent) absentFieldCells.push({ key, field, side: 'current' });
          continue;
        }
        fieldComparisons += 1;
        if (publishedValue !== currentValue) changedFields.push(field);
      }

      /** @type {import('./types.js').ParityPair} */
      const pair = {
        key,
        label: labelOf(publishedRow),
        publishedRow,
        currentRow,
        changedFields,
        absentFields,
        before,
        after,
      };
      if (changedFields.length === 0) matched.push(pair);
      else differing.push(pair);
    }

    for (let index = pairCount; index < currentRows.length; index += 1) {
      added.push({ key, label: labelOf(currentRows[index]), row: currentRows[index] });
    }
    for (let index = pairCount; index < publishedRows.length; index += 1) {
      removed.push({ key, label: labelOf(publishedRows[index]), row: publishedRows[index] });
    }
  }

  return {
    matched,
    differing,
    added,
    removed,
    ambiguousKeys,
    absentFieldCells,
    fieldComparisons,
  };
}

/**
 * Does the partition account for every input row exactly once?
 *
 * **Exported, and given its counts as arguments** rather than closing over the
 * comparison, for the reason `reserve/publication.js`
 * `publicationCoverageFindings()` is: a check nobody can make fail is not a
 * check. `tests/publicationParity.test.js` hands this a partition with a row
 * dropped and one with a row counted twice, and proves both fire.
 *
 * @param {import('./types.js').ParityPartition} partition
 * @param {{ publishedCount: number, currentCount: number }} counts
 * @returns {import('./types.js').PublicationFinding[]}
 */
export function parityPartitionFindings(partition, counts) {
  const matched = partition.matched.length;
  const differing = partition.differing.length;
  const added = partition.added.length;
  const removed = partition.removed.length;

  /** @type {import('./types.js').PublicationFinding[]} */
  const findings = [];

  const publishedAccounted = matched + differing + removed;
  if (publishedAccounted !== counts.publishedCount) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_PARTITION_INCOMPLETE,
        `the partition accounts for ${publishedAccounted} published row(s) of ${counts.publishedCount}: matched ${matched}, differing ${differing}, removed ${removed}`,
        {
          side: 'published',
          accounted: publishedAccounted,
          expected: counts.publishedCount,
          matched,
          differing,
          removed,
        }
      )
    );
  }

  const currentAccounted = matched + differing + added;
  if (currentAccounted !== counts.currentCount) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_PARTITION_INCOMPLETE,
        `the partition accounts for ${currentAccounted} current row(s) of ${counts.currentCount}: matched ${matched}, differing ${differing}, added ${added}`,
        {
          side: 'current',
          accounted: currentAccounted,
          expected: counts.currentCount,
          matched,
          differing,
          added,
        }
      )
    );
  }

  return findings;
}

/**
 * Refuse a subject whose key or comparison is not a subject at all.
 *
 * Thrown rather than reported, because these are producer bugs: a comparison
 * over zero fields would report perfect parity having looked at nothing, and a
 * field that is both the identity and the comparison compares a set against
 * itself.
 *
 * @param {ReadonlyArray<string>} keyFields
 * @param {ReadonlyArray<string>} comparedFields
 * @returns {void}
 */
function assertSubjectFields(keyFields, comparedFields) {
  if (keyFields.length === 0) {
    throw new Error('publication: a parity subject must key on at least one field');
  }
  if (comparedFields.length === 0) {
    throw new Error('publication: a parity subject that compares no field compares nothing');
  }
  for (const field of [...keyFields, ...comparedFields]) {
    if (!isParityField(field)) {
      throw new Error(`publication: "${field}" is not a parity row field`);
    }
  }
  for (const field of comparedFields) {
    if (keyFields.includes(field)) {
      throw new Error(
        `publication: "${field}" is both an identity field and a compared field, so it can only ever compare equal`
      );
    }
  }
}

/**
 * Compare a published artifact against the current working schedule.
 *
 * @param {Object} input
 * @param {string} input.subject - what this comparison is of, in words
 * @param {{ label: string, rows: ReadonlyArray<import('./types.js').ParityRow> }} input.published
 * @param {{ label: string, rows: ReadonlyArray<import('./types.js').ParityRow> }} input.current
 * @param {ReadonlyArray<string>} input.keyFields
 * @param {ReadonlyArray<string>} input.comparedFields
 * @param {ReadonlyArray<Object>} [input.mappingRules]
 * @returns {import('./types.js').ParityResult}
 */
export function checkParity(input) {
  const { subject, published, current, keyFields, comparedFields } = input;
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new Error('publication: a parity run must say what it is a comparison of');
  }
  assertSubjectFields(keyFields, comparedFields);

  const rules = (input.mappingRules ?? []).map((rule) => MappingRuleSchema.parse(rule));
  const meta = createPublicationMeta();
  /** @type {import('./types.js').PublicationFinding[]} */
  const findings = [];

  meta.publishedRowsRead = published.rows.length;
  meta.currentRowsRead = current.rows.length;
  meta.mappingRulesDeclared = rules.length;

  const publishedRules = rules.filter((rule) => rule.appliesTo === 'published');
  const currentRules = rules.filter((rule) => rule.appliesTo === 'current');
  const mappedPublished = applyMappingRules(published.rows, publishedRules);
  const mappedCurrent = applyMappingRules(current.rows, currentRules);
  meta.rowsRewritten = mappedPublished.rowsRewritten + mappedCurrent.rowsRewritten;

  /** @type {import('./types.js').MappingRuleReport[]} */
  const ruleReports = rules.map((rule) => {
    const applications =
      rule.appliesTo === 'published'
        ? mappedPublished.applications[publishedRules.indexOf(rule)]
        : mappedCurrent.applications[currentRules.indexOf(rule)];
    return {
      id: rule.id,
      appliesTo: rule.appliesTo,
      match: rule.match,
      set: rule.set,
      provenance: rule.provenance,
      applications,
    };
  });
  meta.mappingRulesApplied = ruleReports.reduce((sum, rule) => sum + rule.applications, 0);

  for (const rule of ruleReports) {
    if (rule.applications > 0) continue;
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.MAPPING_RULE_UNEXERCISED,
        `mapping rule "${rule.id}" (${rule.provenance}) matched no row on the ${rule.appliesTo} side of "${subject}", so it is either a label that has gone or a rule that was never right`,
        { ruleId: rule.id, appliesTo: rule.appliesTo, provenance: rule.provenance, subject }
      )
    );
  }
  if (rules.length === 0) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.MAPPING_NOT_EXERCISED,
        `"${subject}" declared no field-name mapping rule, so no label was translated and mappingRulesApplied is 0`,
        { subject, mappingRulesDeclared: 0, mappingRulesApplied: 0 }
      )
    );
  } else {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.MAPPING_APPLIED,
        `"${subject}" declared ${rules.length} mapping rule(s), applied ${meta.mappingRulesApplied} time(s) across ${meta.rowsRewritten} row(s)`,
        {
          subject,
          mappingRulesDeclared: rules.length,
          mappingRulesApplied: meta.mappingRulesApplied,
          rowsRewritten: meta.rowsRewritten,
        }
      )
    );
  }

  const partition = compareParityRows({
    published: mappedPublished.rows,
    current: mappedCurrent.rows,
    keyFields,
    comparedFields,
  });

  meta.rowsMatched = partition.matched.length;
  meta.rowsDiffering = partition.differing.length;
  meta.rowsAdded = partition.added.length;
  meta.rowsRemoved = partition.removed.length;
  meta.rowsCompared = meta.rowsMatched + meta.rowsDiffering + meta.rowsAdded + meta.rowsRemoved;
  meta.fieldComparisons = partition.fieldComparisons;

  findings.push(
    ...parityPartitionFindings(partition, {
      publishedCount: published.rows.length,
      currentCount: current.rows.length,
    })
  );

  for (const pair of partition.differing) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_ROW_DIFFERS,
        `"${pair.label}" differs from what was published in ${pair.changedFields.join(', ')}`,
        {
          subject,
          key: pair.key,
          label: pair.label,
          changedFields: pair.changedFields.join(','),
          publishedRowId: pair.publishedRow.rowId,
          currentRowId: pair.currentRow.rowId,
        }
      )
    );
  }

  for (const orphan of partition.removed) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_ROW_REMOVED,
        `"${orphan.label}" was published and is not in ${current.label} at all`,
        { subject, key: orphan.key, label: orphan.label, rowId: orphan.row.rowId }
      )
    );
  }

  if (partition.added.length > 0) {
    // One aggregate rather than one per row, and deliberately: additions are
    // news rather than divergence, and 112 info findings would bury the four
    // that are not.
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_ROW_ADDED,
        `${partition.added.length} row(s) in ${current.label} were never in ${published.label}; they are additions, not differences`,
        {
          subject,
          count: partition.added.length,
          exampleKeys: partition.added
            .slice(0, EXAMPLE_LIMIT)
            .map((orphan) => orphan.key)
            .join(' | '),
        }
      )
    );
  }

  if (partition.matched.length > 0) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_ROWS_MATCHED,
        `${partition.matched.length} row(s) of ${published.label} match ${current.label} on ${comparedFields.join(', ')}`,
        {
          subject,
          matched: partition.matched.length,
          comparedFields: comparedFields.join(','),
          fieldComparisons: partition.fieldComparisons,
        }
      )
    );
  }

  /** @type {Map<string, { count: number, examples: string[] }>} */
  const absentByField = new Map();
  for (const cell of partition.absentFieldCells) {
    const entry = absentByField.get(cell.field) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < EXAMPLE_LIMIT) entry.examples.push(`${cell.side}:${cell.key}`);
    absentByField.set(cell.field, entry);
  }
  for (const [field, entry] of absentByField) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_FIELD_ABSENT,
        `"${subject}" compares ${field}, which ${entry.count} row-side(s) do not carry, so those cells cannot be compared and were not counted as agreement`,
        { subject, field, cells: entry.count, examples: entry.examples.join(' | ') }
      )
    );
  }

  const populated = new Set([
    ...populatedParityFields(mappedPublished.rows),
    ...populatedParityFields(mappedCurrent.rows),
  ]);
  for (const field of PARITY_FIELD_ORDER) {
    if (!populated.has(field)) continue;
    if (keyFields.includes(field) || comparedFields.includes(field)) continue;
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_FIELD_UNCOMPARED,
        `"${subject}" carries ${field} on at least one side and neither keys nor compares it, so its parity numbers say nothing about ${field}`,
        { subject, field }
      )
    );
  }

  for (const ambiguity of partition.ambiguousKeys) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_KEY_AMBIGUOUS,
        `identity "${ambiguity.key}" names ${ambiguity.publishedCount} published row(s) and ${ambiguity.currentCount} current row(s), so ${keyFields.join(', ')} does not identify a fixture in "${subject}"`,
        {
          subject,
          key: ambiguity.key,
          publishedCount: ambiguity.publishedCount,
          currentCount: ambiguity.currentCount,
        }
      )
    );
  }

  if (meta.rowsCompared === 0 || partition.fieldComparisons === 0) {
    findings.push(
      makePublicationFinding(
        PUBLICATION_REASON.PARITY_VACUOUS,
        `"${subject}" partitioned ${meta.rowsCompared} row(s) and performed ${partition.fieldComparisons} field comparison(s); parity over nothing holds trivially and means nothing`,
        {
          subject,
          rowsCompared: meta.rowsCompared,
          fieldComparisons: partition.fieldComparisons,
        }
      )
    );
  }

  return {
    subject,
    publishedLabel: published.label,
    currentLabel: current.label,
    keyFields: [...keyFields],
    comparedFields: [...comparedFields],
    buckets: {
      [PARITY_BUCKET.MATCHED]: partition.matched,
      [PARITY_BUCKET.DIFFERING]: partition.differing,
      [PARITY_BUCKET.ADDED]: partition.added,
      [PARITY_BUCKET.REMOVED]: partition.removed,
    },
    mapping: {
      declared: rules.length,
      applied: meta.mappingRulesApplied,
      rules: ruleReports,
    },
    findings,
    status: derivePublicationStatus(findings),
    meta,
  };
}
