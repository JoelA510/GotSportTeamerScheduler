/**
 * **The comparison, optimised for exactly three things.**
 *
 * > *"The comparison output I actually needed every time was the same three
 * > things — which games differ, which constraints break, what capacity is
 * > lost. Optimise the diff for that, not for generic completeness."*
 *
 * | the three things | where it comes from |
 * | --- | --- |
 * | which games differ | {@link diffSchedules}, in `resolve/state.js`'s own `ScheduleChange` shape, using its own `slotChangedFields()` |
 * | which constraints break | `runRuleEngine()` on both sides, tallied by `resolve/report.js`'s own `violationTally()` |
 * | what capacity is lost | `buildReserveCapacityReport()` under each side's engines, per stated subject |
 *
 * and the quality delta beside them, from `scoreSchedule()` — **the one fitness
 * function**. Nothing in this file multiplies a count by a weight.
 *
 * ## Why this is not `compareParityRows()`
 *
 * `publication/parity.js` already holds a four-bucket comparator, and this
 * module adopts its **shape** — enumerated from both sides, every game in
 * exactly one bucket, totals reconciled against both inputs, the reconciliation
 * exported so a test can make it fail — without calling it. The reason is the
 * vocabulary: `compareParityRows()` compares `ParityRow`s, whose fields are
 * `outputGeneration.js`'s export columns, and routing schedule games through
 * that adapter would make a scenario diff depend on the column set the club
 * happens to publish. It would also inherit machinery a schedule does not need:
 * key ambiguity, input-order pairing and mapping rules all exist because a
 * re-imported export has no reliable identity, whereas a game id is unique by
 * construction — `createResolveState()` throws on a duplicate.
 *
 * The two comparators are kept honest against each other by
 * `tests/scenarioBranching.test.js`, which asserts there is exactly one
 * `changedFields` computation for a **slot** in the repository and that this
 * module reuses it.
 *
 * @module scenario/diff
 */

import { buildReserveCapacityReport } from '../reserve/capacity.js';
import { CONSTRAINT_SEVERITY } from '../constraints/reasonCodes.js';
import { scoreSchedule } from '../resolve/objective.js';
import { violationTally } from '../resolve/report.js';
import { slotChangedFields } from '../resolve/state.js';

import {
  SCENARIO_REASON,
  createScenarioMeta,
  deriveScenarioStatus,
  makeScenarioFinding,
  mergeScenarioMeta,
} from './reasonCodes.js';

/** How many example ids an aggregate finding carries. */
const EXAMPLE_LIMIT = 5;

/**
 * The slot a game stands on.
 *
 * @param {Object} game
 * @returns {import('../resolve/types.js').Slot}
 */
function slotOf(game) {
  return { date: game.date, surfaceId: game.surfaceId, startMinutes: game.startMinutes };
}

/**
 * `${home} v ${away}` — the same label shape `diffAgainstBaseline()` puts on a
 * `ScheduleChange`, so a notice built from either reads the same way.
 *
 * @param {Object} game
 * @returns {string}
 */
function labelOf(game) {
  return `${game.homeLabel ?? game.homeTeamId ?? '?'} v ${game.awayLabel ?? game.awayTeamId ?? '?'}`;
}

/**
 * **The comparator.** Partition two schedules' games into changed, added and
 * removed, enumerated from both sides.
 *
 * `resolve/state.js` `diffAgainstBaseline()` is `ResolveState`-scoped and has no
 * notion of an added or a removed game, because every game exists on both sides
 * of a re-solve by construction. Two *scenarios* are not like that: one branch
 * can carry a fixture the other has shelved. So this is the same shape one
 * bucket wider, and it computes a changed-field list through the same
 * `slotChangedFields()` the re-solver uses.
 *
 * Pure: no findings and no opinion about severity. {@link diffScenarios} judges.
 *
 * @param {Object} input
 * @param {ReadonlyArray<Object>} input.left
 * @param {ReadonlyArray<Object>} input.right
 * @param {Record<string, string>} [input.dispositions] - gameId -> freeze disposition, for the change records
 * @returns {{ changed: import('../resolve/types.js').ScheduleChange[], added: import('../resolve/types.js').ScheduleChange[], removed: import('../resolve/types.js').ScheduleChange[], unchanged: string[], comparisons: number }}
 */
export function diffSchedules({ left, right, dispositions = {} }) {
  const leftById = new Map(left.map((game) => [String(game.id), game]));
  const rightById = new Map(right.map((game) => [String(game.id), game]));
  const ids = [...new Set([...leftById.keys(), ...rightById.keys()])].sort();

  /** @type {import('../resolve/types.js').ScheduleChange[]} */
  const changed = [];
  /** @type {import('../resolve/types.js').ScheduleChange[]} */
  const added = [];
  /** @type {import('../resolve/types.js').ScheduleChange[]} */
  const removed = [];
  /** @type {string[]} */
  const unchanged = [];
  let comparisons = 0;

  for (const gameId of ids) {
    const before = leftById.get(gameId) ?? null;
    const after = rightById.get(gameId) ?? null;
    const disposition = dispositions[gameId] ?? null;

    if (before === null) {
      added.push({
        gameId,
        label: labelOf(/** @type {Object} */ (after)),
        disposition,
        changedFields: ['present'],
        before: null,
        after: slotOf(/** @type {Object} */ (after)),
      });
      continue;
    }
    if (after === null) {
      removed.push({
        gameId,
        label: labelOf(before),
        disposition,
        changedFields: ['present'],
        before: slotOf(before),
        after: null,
      });
      continue;
    }

    comparisons += 1;
    const beforeSlot = slotOf(before);
    const afterSlot = slotOf(after);
    const changedFields = slotChangedFields(beforeSlot, afterSlot);
    if (changedFields.length === 0) {
      unchanged.push(gameId);
      continue;
    }
    changed.push({
      gameId,
      label: labelOf(before),
      disposition,
      changedFields,
      before: beforeSlot,
      after: afterSlot,
    });
  }

  return { changed, added, removed, unchanged, comparisons };
}

/**
 * Does the partition account for every input game exactly once?
 *
 * **Exported, and given its counts as arguments** rather than closing over the
 * comparison, for the reason `parityPartitionFindings()` and
 * `publicationCoverageFindings()` are: a check nobody can make fail is not a
 * check. `tests/scenarioBranching.test.js` hands this a partition with a game
 * dropped and one with a game counted twice, and proves both fire.
 *
 * @param {{ changed: ReadonlyArray<Object>, added: ReadonlyArray<Object>, removed: ReadonlyArray<Object>, unchanged: ReadonlyArray<string> }} partition
 * @param {{ leftCount: number, rightCount: number }} counts
 * @returns {import('./types.js').ScenarioFinding[]}
 */
export function scheduleDiffPartitionFindings(partition, counts) {
  const unchanged = partition.unchanged.length;
  const changed = partition.changed.length;
  const added = partition.added.length;
  const removed = partition.removed.length;

  /** @type {import('./types.js').ScenarioFinding[]} */
  const findings = [];

  const leftAccounted = unchanged + changed + removed;
  if (leftAccounted !== counts.leftCount) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_DIFF_PARTITION_INCOMPLETE,
        `the diff accounts for ${leftAccounted} of the ${counts.leftCount} game(s) on the left: unchanged ${unchanged}, changed ${changed}, removed ${removed}`,
        {
          side: 'left',
          accounted: leftAccounted,
          expected: counts.leftCount,
          unchanged,
          changed,
          removed,
        }
      )
    );
  }

  const rightAccounted = unchanged + changed + added;
  if (rightAccounted !== counts.rightCount) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_DIFF_PARTITION_INCOMPLETE,
        `the diff accounts for ${rightAccounted} of the ${counts.rightCount} game(s) on the right: unchanged ${unchanged}, changed ${changed}, added ${added}`,
        {
          side: 'right',
          accounted: rightAccounted,
          expected: counts.rightCount,
          unchanged,
          changed,
          added,
        }
      )
    );
  }

  /** @type {Map<string, number>} */
  const appearances = new Map();
  for (const bucket of [partition.changed, partition.added, partition.removed]) {
    for (const entry of bucket) {
      const gameId = String(/** @type {Record<string, unknown>} */ (entry).gameId);
      appearances.set(gameId, (appearances.get(gameId) ?? 0) + 1);
    }
  }
  for (const gameId of partition.unchanged) {
    appearances.set(gameId, (appearances.get(gameId) ?? 0) + 1);
  }
  const doubled = [...appearances]
    .filter(([, count]) => count !== 1)
    .map(([gameId]) => gameId)
    .sort();
  if (doubled.length > 0) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_DIFF_PARTITION_INCOMPLETE,
        `${doubled.length} game(s) appear in more than one bucket of this diff (${doubled.slice(0, EXAMPLE_LIMIT).join(', ')}); a game counted twice is a diff larger than the season contains`,
        { side: 'both', gameCount: doubled.length, exampleGameIds: doubled.slice(0, EXAMPLE_LIMIT) }
      )
    );
  }

  return findings;
}

/**
 * Capacity for one stated subject, on both sides.
 *
 * **There is no single "capacity lost" scalar and this function will not invent
 * one.** `ReserveCapacityInputSchema` requires a `format`, a `surfaceIds`, a
 * `dates`, an `earliestKickoffMinutes` and a stated `requirement`; a headline
 * number over "capacity" would be a number over an unstated question. The
 * caller declares the subjects and gets one delta per subject.
 *
 * @param {Object} leftEngines
 * @param {Object} rightEngines
 * @param {ReadonlyArray<Object>} subjects - `ReserveCapacityInputSchema` inputs
 * @returns {{ deltas: import('./types.js').ScenarioCapacityDelta[], findings: import('./types.js').ScenarioFinding[] }}
 */
export function diffCapacity(leftEngines, rightEngines, subjects) {
  /** @type {import('./types.js').ScenarioCapacityDelta[]} */
  const deltas = [];
  /** @type {import('./types.js').ScenarioFinding[]} */
  const findings = [];

  for (const subject of subjects) {
    const left = buildReserveCapacityReport(leftEngines, subject);
    const right = buildReserveCapacityReport(rightEngines, subject);
    /** @type {Record<string, { left: number, right: number, delta: number }>} */
    const byDate = {};
    for (const date of [
      ...new Set([...Object.keys(left.slotsByDate), ...Object.keys(right.slotsByDate)]),
    ].sort()) {
      const leftSlots = left.slotsByDate[date] ?? 0;
      const rightSlots = right.slotsByDate[date] ?? 0;
      byDate[date] = { left: leftSlots, right: rightSlots, delta: rightSlots - leftSlots };
    }
    const leftTotal = Object.values(left.slotsByDate).reduce((sum, n) => sum + n, 0);
    const rightTotal = Object.values(right.slotsByDate).reduce((sum, n) => sum + n, 0);

    deltas.push({
      name: left.name,
      format: left.format,
      surfaceIds: Object.freeze([...new Set(subject.surfaceIds)].sort()),
      dates: Object.freeze([...new Set(subject.dates)].sort()),
      leftSlots: leftTotal,
      rightSlots: rightTotal,
      delta: rightTotal - leftTotal,
      byDate,
    });

    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_CAPACITY_DELTA,
        `"${left.name}": ${rightTotal} ${left.format} slot(s) against ${leftTotal} across ${Object.keys(byDate).length} date(s) on ${[...new Set(subject.surfaceIds)].length} surface(s) — a delta of ${rightTotal - leftTotal}. This is capacity for that subject and no other; there is no season-wide capacity number`,
        {
          name: left.name,
          format: left.format,
          leftSlots: leftTotal,
          rightSlots: rightTotal,
          delta: rightTotal - leftTotal,
          dateCount: Object.keys(byDate).length,
          surfaceCount: [...new Set(subject.surfaceIds)].length,
        }
      )
    );
  }

  return { deltas, findings };
}

/**
 * Compare two derived schedules: the three things, plus the quality delta.
 *
 * @param {Object} input
 * @param {string} input.subject - what this is a comparison of, in words
 * @param {{ label: string, schedule: import('../ruleEngine/types.js').Schedule, verification: Object|null, engines?: Object }} input.left
 * @param {{ label: string, schedule: import('../ruleEngine/types.js').Schedule, verification: Object|null, engines?: Object }} input.right
 * @param {ReadonlyArray<Object>} [input.capacitySubjects] - `ReserveCapacityInputSchema` inputs
 * @param {Readonly<Record<string, number>>} input.weights - the objective's, resolved by the caller
 * @param {Record<string, string>} [input.dispositions]
 * @returns {import('./types.js').ScenarioDiff}
 */
export function diffScenarios(input) {
  const { subject, left, right, weights } = input;
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new Error('scenario: a diff must say what it is a comparison of');
  }
  const meta = createScenarioMeta();
  /** @type {import('./types.js').ScenarioFinding[]} */
  const findings = [];

  /* -- (1) which games differ --------------------------------------------- */

  const partition = diffSchedules({
    left: left.schedule.games,
    right: right.schedule.games,
    dispositions: input.dispositions ?? {},
  });
  meta.gamesCompared = partition.comparisons;
  meta.gamesUnchanged = partition.unchanged.length;
  meta.gamesChanged = partition.changed.length;
  meta.gamesAdded = partition.added.length;
  meta.gamesRemoved = partition.removed.length;
  findings.push(
    ...scheduleDiffPartitionFindings(partition, {
      leftCount: left.schedule.games.length,
      rightCount: right.schedule.games.length,
    })
  );

  /* -- (2) which constraints break ---------------------------------------- */

  // The tally shape is `resolve/report.js`'s, verbatim. A second one here would
  // be free to count a waived violation differently from the dry-run report and
  // nothing would detect the drift.
  const before = violationTally(left.verification);
  const after = violationTally(right.verification);
  const measured = left.verification !== null && right.verification !== null;

  /** @type {Record<string, { left: number, right: number, delta: number }>} */
  const byCode = {};
  /** @type {string[]} */
  const newlyViolated = [];
  /** @type {string[]} */
  const noLongerViolated = [];
  for (const code of [
    ...new Set([...Object.keys(before.byCode), ...Object.keys(after.byCode)]),
  ].sort()) {
    const leftCount = before.byCode[code] ?? 0;
    const rightCount = after.byCode[code] ?? 0;
    byCode[code] = { left: leftCount, right: rightCount, delta: rightCount - leftCount };
    meta.violationCodesCompared += 1;
    // "Newly" is the filter the build plan asks for: a code the branch breaks
    // *more* than the baseline did, not every code either side carries. The
    // published season already carries 62 accepted exceptions and a report that
    // listed them all would bury the ones the branch caused.
    if (rightCount > leftCount) newlyViolated.push(code);
    if (rightCount < leftCount) noLongerViolated.push(code);
  }

  /** @type {Record<string, { left: number, right: number, delta: number }>} */
  const bySeverity = {};
  for (const severity of Object.values(CONSTRAINT_SEVERITY)) {
    const leftCount = before.bySeverity[severity] ?? 0;
    const rightCount = after.bySeverity[severity] ?? 0;
    bySeverity[severity] = { left: leftCount, right: rightCount, delta: rightCount - leftCount };
  }

  /* -- (3) what capacity is lost ------------------------------------------ */

  /** @type {import('./types.js').ScenarioCapacityDelta[]} */
  let capacity = [];
  const subjects = input.capacitySubjects ?? [];
  if (subjects.length === 0) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_CAPACITY_SUBJECT_UNSTATED,
        `"${subject}" states no capacity subject, so it reports no capacity delta at all. A capacity question needs a format, a surface set, a date set and a first kickoff before it has an answer; a single headline number would be a number over an unstated question`,
        { subject }
      )
    );
  } else if (!left.engines || !right.engines) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_CAPACITY_SUBJECT_UNSTATED,
        `"${subject}" states ${subjects.length} capacity subject(s) and one of the two sides supplied no engines to measure them under, so no delta could be computed`,
        { subject, subjectCount: subjects.length }
      )
    );
  } else {
    const measuredCapacity = diffCapacity(left.engines, right.engines, subjects);
    capacity = measuredCapacity.deltas;
    meta.capacitySubjectsCompared = capacity.length;
    findings.push(...measuredCapacity.findings);
  }

  /* -- the quality delta, through the one fitness function ----------------- */

  // `scoreSchedule()` and nothing else. **Both sides measured the same way or
  // neither**, exactly as `buildChangeReport()` does it: a quality-inclusive
  // score on one side and a quality-free one on the other produces a delta that
  // is entirely an artefact of the mismatch.
  //
  // **Each side is its own reference, so the change terms are zero on both.**
  // Scoring the left against itself and the right against the *left* made the
  // delta a sum of two different things: on this corpus 1,597,760, of which
  // 324,800 was the violation difference and the rest was 60 games having moved
  // and 12 having been shelved. A number that grows because the branch differs
  // from the baseline is not a measure of whether the branch is worse — it is
  // the partition above, counted twice and priced. How much moved is
  // `games.changed`, `games.added` and `games.removed`, three fields away; what
  // the move *cost* is `constraints.newlyViolated` and this delta.
  //
  // The property that makes it honest is asserted in
  // `tests/scenarioBranching.test.js`: swap the two sides and the delta negates
  // exactly. It could not, while either side's score was a function of the
  // other.
  const leftScore = scoreSchedule({
    referenceGames: left.schedule.games,
    games: left.schedule.games,
    verification: measured ? left.verification : null,
    weights,
  });
  const rightScore = scoreSchedule({
    referenceGames: right.schedule.games,
    games: right.schedule.games,
    verification: measured ? right.verification : null,
    weights,
  });

  if (!measured || partition.comparisons === 0) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_DIFF_VACUOUS,
        `"${subject}" compared ${partition.comparisons} game(s) present on both sides and ${measured ? 'measured' : 'did not measure'} the rule engine on both; a diff over nothing holds trivially, and "nothing got worse" and "nothing was measured" read the same to a tired operator`,
        { subject, gamesCompared: partition.comparisons, measured }
      )
    );
  }

  return {
    subject,
    leftLabel: left.label,
    rightLabel: right.label,
    games: {
      changed: partition.changed,
      added: partition.added,
      removed: partition.removed,
      unchanged: partition.unchanged.length,
    },
    constraints: { byCode, bySeverity, newlyViolated, noLongerViolated, measured },
    capacity,
    quality: {
      left: leftScore.total,
      right: rightScore.total,
      delta: rightScore.total - leftScore.total,
      measured,
    },
    findings,
    status: deriveScenarioStatus(findings),
    meta: mergeScenarioMeta(createScenarioMeta(), meta),
  };
}
