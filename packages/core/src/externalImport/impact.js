/**
 * Pre-commit impact analysis: *"if we accepted **these** rows, what would
 * break?"*
 *
 * ## The finding this module exists for: a verdict belongs to a set
 *
 * The season corpus makes the point without any construction. Four of the eight
 * externally-published fixtures sit 30 minutes later than the times the club
 * agreed, all four on 2026-08-22, two on Alder Pitch 2 and two on Pitch 3. There
 * are therefore **sixteen** ways to accept them, and they do not agree:
 *
 * - accept **nothing** and the plan is the plan;
 * - accept the **10:00 -> 10:30** move on a pitch and leave its 12:00 partner
 *   where it is, and two 11v11 games sit 90 minutes apart on one pitch — an
 *   occupancy that ends exactly as the next one starts, a **0-minute** gap
 *   against `game_formats.csv`'s 20-minute turnover floor, inside a declared
 *   120-minute block;
 * - accept the **12:00 -> 12:30** move on a pitch and the 12:30 fixture, running
 *   to 14:00, lands on top of a 13:50 9v9 game on the *overlapping* pitch —
 *   Pitch 1A and 1B against Pitch 2, Pitch 4A and 4B against Pitch 3. That is
 *   **incident 3**, to the minute: *"externally-published fixtures at 12:30 made
 *   an already-published 9v9 block illegal by exactly 10 minutes"*.
 *
 * So an analysis that evaluates the import **as a whole** answers a question
 * nobody asked. This module's public entry points are
 * {@link analyseImportImpact}, which answers about one stated set and says on
 * every result that it answers about that set alone, and
 * {@link sweepAcceptanceSets}, which answers about all of them and reports a
 * safe set that has an unsafe subset as
 * {@link import('./reasonCodes.js').EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SUBSET_UNSAFE}
 * at blocking.
 *
 * ## What it measures, and what it does not
 *
 * Consulted, through the modules that own each question:
 *
 * | question | owner |
 * | --- | --- |
 * | do two bookings share ground? | `facility/occupancy.js` `surfacesConflict()` |
 * | do they share a clock? | `facility/occupancy.js` `bookingsOverlapInTime()`, whose `null` is carried as undecidable and never as "no clash" |
 * | which pairs clash across a whole plan? | `facility/occupancy.js` `findFacilityConflicts()` — the only conflict enumerator, before and after |
 * | how long does a fixture occupy ground? | `timing/formatTiming.js` `occupancyEndMinutes()`, worst case |
 * | how long must a pitch be clear between two? | the format's `turnoverMinMinutes` and `blockMinutes` |
 *
 * **Not** consulted, stated on every result as
 * {@link import('./reasonCodes.js').EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SCOPE_STATED}
 * rather than left for a reader to assume: permit windows and sunset
 * (`availability/`), coach travel and personal timelines (`people/`,
 * `evaluators/`), the constraint registry and the rule engine, and warm-up
 * occupancy (`timing/warmup.js`). Each is a real question about a moved fixture
 * and none of them is asked here. On this corpus none of them changes an answer
 * — the moves are 30 minutes inside a 7:00-to-20:00 permit, ten hours before
 * sunset, and no coach in the corpus is committed elsewhere on those two dates —
 * but that is a fact about the corpus, not a property of this module, and the
 * finding says so.
 *
 * ## Undecidable pairs, and why a standing one does not condemn every import
 *
 * The two `Scrimmage` rows at Summit HS on 2026-08-22 have no `game_formats.csv`
 * timing row (GAP-14), so their occupancy end is `null` and
 * `bookingsOverlapInTime()` answers `null` about the pair they form. That is a
 * standing fact about the schedule: it is true before this import and after it,
 * whatever anybody accepts.
 *
 * If it moved the verdict, **every** acceptance set on this corpus would come
 * back `undetermined`, including the empty one, and the module would have
 * nothing to say. So the verdict is fed only the pairs the projection could have
 * changed — those involving at least one **moved** fixture — exactly as an
 * introduced clash moves it and a pre-existing one does not. Standing
 * undecidable pairs are counted and named in the scope finding, so they are
 * visible rather than suppressed, and a moved fixture with an unknown footprint
 * makes its own set `undetermined` at once.
 *
 * @module externalImport/impact
 */

import {
  bookingsOverlapInTime,
  findFacilityConflicts,
  surfacesConflict,
} from '../facility/occupancy.js';
import { getFormatTiming, occupancyEndMinutes } from '../timing/formatTiming.js';

import {
  EXTERNAL_IMPACT_VERDICT,
  EXTERNAL_IMPORT_REASON,
  EXTERNAL_IMPORT_SEVERITY,
  assertExternalImportFindings,
  createExternalImportMeta,
  deriveExternalImpactVerdict,
  deriveExternalImportStatus,
  externalImportSeverityOf,
  makeExternalImportFinding,
} from './reasonCodes.js';
import { acceptanceDomainOf } from './resolution.js';
import { ImpactQuerySchema } from './schemas.js';

/**
 * The largest acceptance domain {@link sweepAcceptanceSets} will enumerate
 * exhaustively. `2 ** 12` is 4,096 projections; above it the sweep examines the
 * empty set, the full set, every singleton and every complement of a singleton,
 * and says so with
 * {@link import('./reasonCodes.js').EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE}
 * naming how many of the `2 ** n` it looked at.
 *
 * It is a stated cap rather than a silent one because the alternative failure is
 * the one this module exists to prevent: a sweep that quietly skipped the subset
 * that breaks, and reported the ones it tried as though they were all of them.
 */
export const ACCEPTANCE_SWEEP_CAP = 12;

/**
 * The layers this analysis does not consult. Named on every result.
 *
 * @type {ReadonlyArray<string>}
 */
export const EXTERNAL_IMPACT_LAYERS_NOT_CONSULTED = Object.freeze([
  'availability/ permit windows and blackout dates',
  'availability/ sunset and lighting',
  'people/ and evaluators/ coach travel and personal timelines',
  'constraints/ registry and ruleEngine/ rules',
  'timing/warmup.js warm-up occupancy',
]);

/**
 * A stable, order-independent rendering of an acceptance set.
 *
 * @param {ReadonlyArray<string>} rowIds
 * @returns {string}
 */
export function acceptanceSetKey(rowIds) {
  const sorted = [...rowIds].sort();
  return sorted.length === 0 ? '<none>' : sorted.join('+');
}

/**
 * The identity of one clash or shortfall, so before and after can be diffed.
 *
 * Built from the code and the two fixture ids, sorted — never from the message,
 * which carries minutes that move when a fixture does and would make every pair
 * look introduced.
 *
 * @param {import('./types.js').ExternalImportFinding} finding
 * @returns {string}
 */
function pairKeyOf(finding) {
  const details = /** @type {Record<string, unknown>} */ (finding.details);
  const ids = [details.bookingAId, details.bookingBId]
    .filter((id) => typeof id === 'string')
    .sort();
  return `${finding.code}|${details.surfaceId ?? ''}|${ids.join('~')}`;
}

/**
 * A facility finding, restated in this module's vocabulary.
 *
 * Restated rather than forwarded, for the reason
 * `FEASIBILITY_CLAIM_CATEGORY_ONLY` is a translation of an attribution code: a
 * forwarded finding carries a code `externalImportSeverityOf()` cannot look up,
 * and `assertExternalImportFindings()` would then throw in the reader's hand
 * instead of the writer's. The facility code and message ride along in
 * `details`, so nothing about the original is lost.
 *
 * @param {import('../facility/types.js').FacilityFinding} finding
 * @returns {import('./types.js').ExternalImportFinding}
 */
function clashFinding(finding) {
  const details = /** @type {Record<string, unknown>} */ (finding.details);
  return makeExternalImportFinding(
    EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_INTRODUCED,
    finding.message,
    { ...details, facilityCode: finding.code, facilitySeverity: finding.severity }
  );
}

/**
 * Restate one finding under a different code, keeping its details.
 *
 * @param {import('./types.js').ExternalImportFinding} finding
 * @param {string} code
 * @param {string} prefix
 * @returns {import('./types.js').ExternalImportFinding}
 */
function restate(finding, code, prefix) {
  return makeExternalImportFinding(code, `${prefix}${finding.message}`, finding.details);
}

/**
 * **Project one acceptance set onto the fixtures we hold.**
 *
 * Freeze by default, minimal diff: a fixture no accepted row names comes through
 * byte-identical, and the result says which rows moved which fixtures and by how
 * many minutes. `CLAUDE.md` §3 — *"solver changes default to maximum freeze /
 * minimal diff"* — applied to an import.
 *
 * @param {Object} input
 * @param {import('./types.js').ExternalImportResolution} input.resolution
 * @param {ReadonlyArray<Object>} input.standing - `StandingFixtureSchema` values
 * @param {ReadonlyArray<string>} input.acceptedRowIds
 * @param {import('../timing/types.js').FormatTimingTable} input.timingTable
 * @returns {{ fixtures: import('./types.js').ProjectedFixture[], moved: import('./types.js').ProjectedFixture[], findings: import('./types.js').ExternalImportFinding[] }}
 */
export function projectAcceptance({ resolution, standing, acceptedRowIds, timingTable }) {
  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [];
  const rowsById = new Map(resolution.rows.map((row) => [row.rowId, row]));

  /** @type {Map<string, import('./types.js').ExternalRowResolution>} */
  const movesByFixture = new Map();
  for (const rowId of acceptedRowIds) {
    const row = rowsById.get(rowId);
    if (row === undefined) {
      findings.push(
        makeExternalImportFinding(
          EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE,
          `row ${rowId} was accepted but this classification does not hold it`,
          { rowId, reason: 'unknown-row' }
        )
      );
      continue;
    }
    if (!row.acceptable || row.fixtureId === null) {
      findings.push(
        makeExternalImportFinding(
          EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE,
          `row ${rowId} was accepted but it is ${row.rowClass}: ${row.acceptableBecause}, so nothing was projected for it`,
          {
            rowId,
            rowClass: row.rowClass,
            reason: row.reasonCode,
            acceptableBecause: row.acceptableBecause,
          }
        )
      );
      continue;
    }
    movesByFixture.set(row.fixtureId, row);
  }

  /** @type {import('./types.js').ProjectedFixture[]} */
  const fixtures = [];
  /** @type {import('./types.js').ProjectedFixture[]} */
  const moved = [];

  for (const fixture of standing) {
    const row = movesByFixture.get(fixture.fixtureId);
    /** @type {import('./types.js').ProjectedFixture} */
    const base = {
      fixtureId: fixture.fixtureId,
      date: fixture.date,
      kickoffMinutes: fixture.kickoffMinutes,
      endMinutes: fixture.endMinutes,
      venueId: fixture.venueId,
      surfaceId: fixture.surfaceId,
      format: fixture.format,
      division: fixture.division,
      homeLabel: fixture.homeLabel,
      awayLabel: fixture.awayLabel,
      movedByRowId: null,
      kickoffDeltaMinutes: null,
    };
    if (row === undefined) {
      fixtures.push(base);
      continue;
    }

    const next = { ...base, movedByRowId: row.rowId, kickoffDeltaMinutes: 0 };
    for (const difference of row.differences) {
      if (difference.field === 'kickoffMinutes' && typeof difference.theirs === 'number') {
        next.kickoffMinutes = difference.theirs;
        next.kickoffDeltaMinutes = /** @type {number} */ (difference.deltaMinutes);
      } else if (difference.field === 'venueId' && typeof difference.theirs === 'string') {
        next.venueId = difference.theirs;
      } else if (difference.field === 'surfaceId' && typeof difference.theirs === 'string') {
        next.surfaceId = difference.theirs;
      }
      // `format` and `division` differences are recorded on the row and are not
      // projected: this module moves a fixture, it does not restate what game it
      // is. A format disagreement is a conversation, not an edit.
    }
    // Recomputed rather than shifted: a shifted end silently keeps a footprint
    // that was measured for a different format, and `occupancyEndMinutes()`
    // returns null for an unknown one rather than a fabricated number.
    const occupancy = occupancyEndMinutes(timingTable, next.format, next.kickoffMinutes);
    next.endMinutes = occupancy === null ? null : occupancy.endMinutes;

    if (
      next.kickoffMinutes !== base.kickoffMinutes ||
      next.surfaceId !== base.surfaceId ||
      next.venueId !== base.venueId
    ) {
      moved.push(next);
    }
    fixtures.push(next);
  }

  return { fixtures, moved, findings };
}

/**
 * Every projected fixture as a facility booking.
 *
 * @param {ReadonlyArray<import('./types.js').ProjectedFixture>} fixtures
 * @returns {import('../facility/types.js').FacilityBooking[]}
 */
function bookingsOf(fixtures) {
  return fixtures.map((fixture) => ({
    id: fixture.fixtureId,
    surfaceId: fixture.surfaceId,
    date: fixture.date,
    startMinutes: fixture.kickoffMinutes,
    endMinutes: fixture.endMinutes,
    format: fixture.format,
    label:
      fixture.homeLabel === null && fixture.awayLabel === null
        ? null
        : `${fixture.homeLabel ?? '?'} v ${fixture.awayLabel ?? '?'}`,
  }));
}

/**
 * Pairs that share ground and whose concurrency could **not** be decided.
 *
 * Uses `surfacesConflict()` and `bookingsOverlapInTime()` — the two primitives
 * that own those questions — rather than re-deriving either. It exists because
 * `findFacilityConflicts()` reports an unknown footprint per *booking*, and the
 * question here is per *pair*: a scrimmage with no known end is only undecidable
 * against something it could actually collide with.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {ReadonlyArray<import('../facility/types.js').FacilityBooking>} bookings
 * @returns {{ pairsCompared: number, undecidable: Array<{ aId: string, bId: string, surfaceAId: string, surfaceBId: string, date: string }> }}
 */
function scanUndecidablePairs(graph, bookings) {
  let pairsCompared = 0;
  /** @type {Array<{ aId: string, bId: string, surfaceAId: string, surfaceBId: string, date: string }>} */
  const undecidable = [];
  for (let i = 0; i < bookings.length; i += 1) {
    for (let j = i + 1; j < bookings.length; j += 1) {
      const a = bookings[i];
      const b = bookings[j];
      if (a.date !== b.date) continue;
      pairsCompared += 1;
      const concurrent = bookingsOverlapInTime(a, b);
      if (concurrent !== null) continue;
      if (!surfacesConflict(graph, a.surfaceId, b.surfaceId).conflict) continue;
      undecidable.push({
        aId: a.id,
        bId: b.id,
        surfaceAId: a.surfaceId,
        surfaceBId: b.surfaceId,
        date: a.date,
      });
    }
  }
  return { pairsCompared, undecidable };
}

/**
 * Same-surface spacing findings: turnover floor and declared block cadence.
 *
 * Both are read off the **earlier** fixture's format, because both are
 * properties of the ground being handed over rather than of what arrives next.
 *
 * ## A pair this cannot check says so
 *
 * Two things stop a check: an **unknown occupancy end** on the earlier fixture
 * (GAP-14, the corpus's `Scrimmage` rows), which leaves nothing to measure a
 * turnover gap from; and a **format `game_formats.csv` does not register**,
 * which leaves neither a floor nor a block to measure against. Both used to be
 * bare `continue`s that skipped *both* checks and emitted nothing, so a pair
 * nothing had looked at was indistinguishable from a pair that had been looked
 * at and was clean — in a module whose stated rule is that unknown is not
 * "fine". Each check is now attempted on its own and every one that cannot run
 * is published as
 * {@link import('./reasonCodes.js').EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SPACING_UNCHECKED},
 * naming the pair and which checks went unrun. Note that the two reasons are not
 * the same shape: an unknown end stops the turnover check only, because cadence
 * is measured kickoff to kickoff and needs no footprint at all.
 *
 * A format that registers `null` for a floor or a block is a different fact —
 * the format declares no such rule — and is not reported here, because there is
 * nothing that went unchecked.
 *
 * @param {import('../timing/types.js').FormatTimingTable} timingTable
 * @param {ReadonlyArray<import('./types.js').ProjectedFixture>} fixtures
 * @returns {import('./types.js').ExternalImportFinding[]}
 */
function spacingFindings(timingTable, fixtures) {
  /** @type {Map<string, import('./types.js').ProjectedFixture[]>} */
  const bySurface = new Map();
  for (const fixture of fixtures) {
    const key = `${fixture.date}|${fixture.surfaceId}`;
    if (!bySurface.has(key)) bySurface.set(key, []);
    /** @type {import('./types.js').ProjectedFixture[]} */ (bySurface.get(key)).push(fixture);
  }

  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [];
  for (const [key, list] of [...bySurface.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort(
      (a, b) => a.kickoffMinutes - b.kickoffMinutes || a.fixtureId.localeCompare(b.fixtureId)
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const earlier = sorted[i - 1];
      const later = sorted[i];
      const timing = getFormatTiming(timingTable, earlier.format);
      const [date, surfaceId] = key.split('|');
      const shared = {
        bookingAId: earlier.fixtureId,
        bookingBId: later.fixtureId,
        surfaceId,
        date,
        earlierKickoffMinutes: earlier.kickoffMinutes,
        earlierEndMinutes: earlier.endMinutes,
        laterKickoffMinutes: later.kickoffMinutes,
        format: earlier.format,
      };

      /** @type {string[]} */
      const checksUnrun = [];
      /** @type {string[]} */
      const because = [];
      if (!timing) {
        checksUnrun.push('turnover', 'cadence');
        because.push(
          `game_formats.csv registers no timing for ${earlier.format === null ? 'a fixture stating no format' : JSON.stringify(earlier.format)} (GAP-14), so neither a turnover floor nor a declared block exists to measure against`
        );
      } else if (earlier.endMinutes === null) {
        checksUnrun.push('turnover');
        because.push(
          `${earlier.fixtureId} has no known occupancy end, so the gap handed over to ${later.fixtureId} cannot be measured`
        );
      }
      if (checksUnrun.length > 0) {
        findings.push(
          makeExternalImportFinding(
            EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SPACING_UNCHECKED,
            `${surfaceId} on ${date}: ${checksUnrun.join(' and ')} went unchecked between ${earlier.fixtureId} and ${later.fixtureId} — ${because.join('; ')}. The pair is reported as unchecked rather than left to read as clean`,
            {
              ...shared,
              checksUnrun,
              checksRun: ['turnover', 'cadence'].filter((check) => !checksUnrun.includes(check)),
            }
          )
        );
      }
      if (!timing) continue;

      if (earlier.endMinutes !== null && timing.turnoverMinMinutes !== null) {
        const gap = later.kickoffMinutes - earlier.endMinutes;
        if (gap < timing.turnoverMinMinutes) {
          findings.push(
            makeExternalImportFinding(
              EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_TURNOVER_SHORTFALL,
              `${surfaceId} on ${date}: ${earlier.fixtureId} ends at minute ${earlier.endMinutes} and ${later.fixtureId} starts at ${later.kickoffMinutes}, a ${gap}-minute gap against the ${timing.format} turnover floor of ${timing.turnoverMinMinutes}`,
              { ...shared, gapMinutes: gap, floorMinutes: timing.turnoverMinMinutes }
            )
          );
        }
      }

      if (timing.blockMinutes !== null) {
        const cadence = later.kickoffMinutes - earlier.kickoffMinutes;
        if (cadence < timing.blockMinutes) {
          findings.push(
            makeExternalImportFinding(
              EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CADENCE_BREACH,
              `${surfaceId} on ${date}: kickoffs ${cadence} minutes apart against the ${timing.format} block of ${timing.blockMinutes}, ${timing.blockMinutes - cadence} short`,
              {
                ...shared,
                cadenceMinutes: cadence,
                blockMinutes: timing.blockMinutes,
                shortfallMinutes: timing.blockMinutes - cadence,
              }
            )
          );
        }
      }
    }
  }
  return findings;
}

/**
 * Every finding one plan produces, keyed so two plans can be diffed.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('../timing/types.js').FormatTimingTable} timingTable
 * @param {ReadonlyArray<import('./types.js').ProjectedFixture>} fixtures
 * @returns {{ byKey: Map<string, import('./types.js').ExternalImportFinding>, pairsCompared: number, undecidable: Array<{ aId: string, bId: string, surfaceAId: string, surfaceBId: string, date: string }> }}
 */
function planFindings(graph, timingTable, fixtures) {
  const bookings = bookingsOf(fixtures);
  const { conflicts } = findFacilityConflicts(graph, bookings);
  const scan = scanUndecidablePairs(graph, bookings);

  /** @type {Map<string, import('./types.js').ExternalImportFinding>} */
  const byKey = new Map();
  for (const conflict of conflicts) {
    const finding = clashFinding(conflict);
    byKey.set(pairKeyOf(finding), finding);
  }
  for (const finding of spacingFindings(timingTable, fixtures)) {
    byKey.set(pairKeyOf(finding), finding);
  }
  return { byKey, pairsCompared: scan.pairsCompared, undecidable: scan.undecidable };
}

/**
 * **Why one accepted row moved no fixture.**
 *
 * Five causes make a set move nothing, and a sixth member reports that none of
 * them explains it, and the sentence that used to report them
 * named two. A set whose rows were **refused** moved nothing because none of it
 * could be applied, which is the opposite of a no-op; a row whose fixture is
 * outside `query.dates` moved nothing because the projection never saw it; a row
 * that carries a value we do not hold moved nothing and is not agreement either.
 * Calling any of those *"differ only on fields this module records"* or
 * *"already agree with what we hold"* tells an operator the import was a no-op
 * when it was refused, out of scope, or one-sided.
 *
 * So each accepted row is put in a bucket **by what was observed** — the
 * projection's own findings, the fixture ids the projection actually held, and
 * the row's own differences and one-sided fields — and the clause is looked up
 * from the bucket. No clause is written next to the branch that produces it.
 *
 * ## Buckets, not a partition
 *
 * A row can be more than one of these things, and for one round the loop below
 * tested {@link RECORDED_ONLY} before {@link ONE_SIDED} and stopped at the
 * first hit. A row differing on `format` *and* carrying a `division` we do not
 * hold was reported as one that *"differ[s] **only** on fields this module
 * records"* and was absent from `oneSidedRowIds` — a summary that named one of
 * the two true things and denied the other in the same clause. The word "only"
 * was itself the false claim.
 *
 * The first three causes are terminal: a **refused** row was never evaluated
 * further, an **out-of-scope** row's fields cannot explain a projection that
 * never held its fixture, and {@link UNEXPLAINED} means precisely that no
 * account was reached. The last three are properties of the row, and
 * {@link RECORDED_ONLY} and {@link ONE_SIDED} can both hold; {@link AGREES} is
 * exclusive with both by construction, being the absence of each. So the
 * clauses no longer add up to the accepted count, and the message says which
 * rows are named twice rather than leaving a reader to discover it by
 * arithmetic that no longer works.
 *
 * {@link UNEXPLAINED} is the honest floor rather than a decoration: two accepted
 * rows naming one fixture leave only the last of them projected, and a message
 * that has to name a cause would name the wrong one. It says so instead.
 *
 * @readonly
 * @enum {string}
 */
const NOTHING_PROJECTED_CAUSE = Object.freeze({
  /** Undecidable, unmatched, or named by no row of this classification. */
  REFUSED: 'refused',
  /** Its fixture is not in the projection's date scope. */
  OUT_OF_SCOPE: 'outside-the-projection-scope',
  /** It differs only on fields this module records and does not move. */
  RECORDED_ONLY: 'recorded-not-moved',
  /** It states a value we do not hold, or we hold one it does not state. */
  ONE_SIDED: 'one-sided-field',
  /** Nothing differs and nothing is one-sided. The only true no-op. */
  AGREES: 'agrees',
  /** Applied, in scope, with a difference this module moves — and it did not. */
  UNEXPLAINED: 'unexplained',
});

/**
 * The clause each cause contributes, in the order they are said.
 *
 * @type {Readonly<Record<string, string>>}
 */
const NOTHING_PROJECTED_CLAUSE = Object.freeze({
  [NOTHING_PROJECTED_CAUSE.REFUSED]: 'could not be applied at all',
  [NOTHING_PROJECTED_CAUSE.OUT_OF_SCOPE]:
    'name a fixture outside the dates this projection covers, so nothing of theirs was projected either way',
  [NOTHING_PROJECTED_CAUSE.RECORDED_ONLY]: 'differ on fields this module records rather than moves',
  [NOTHING_PROJECTED_CAUSE.ONE_SIDED]:
    'carry a value we do not hold, or are held against one they do not state, which is not agreement',
  [NOTHING_PROJECTED_CAUSE.AGREES]: 'already agree with what we hold',
  [NOTHING_PROJECTED_CAUSE.UNEXPLAINED]:
    'moved nothing for a reason this analysis cannot name, which is reported rather than attributed to one of the causes above',
});

/** @type {ReadonlyArray<string>} */
const NOTHING_PROJECTED_CAUSE_ORDER = Object.freeze([
  NOTHING_PROJECTED_CAUSE.REFUSED,
  NOTHING_PROJECTED_CAUSE.OUT_OF_SCOPE,
  NOTHING_PROJECTED_CAUSE.RECORDED_ONLY,
  NOTHING_PROJECTED_CAUSE.ONE_SIDED,
  NOTHING_PROJECTED_CAUSE.AGREES,
  NOTHING_PROJECTED_CAUSE.UNEXPLAINED,
]);

/** The compared fields a projection actually applies to a fixture. */
const PROJECTED_FIELDS = Object.freeze(['kickoffMinutes', 'venueId', 'surfaceId']);

/**
 * **Every** {@link NOTHING_PROJECTED_CAUSE} that holds of one accepted row.
 *
 * Returns a list rather than a value: a row that is two things is two things,
 * and the caller that has to say so cannot recover the second from a single
 * answer. The three terminal causes still return alone, because each of them
 * means the row was never evaluated far enough for the others to have been
 * observed at all.
 *
 * @param {string} rowId
 * @param {Object} input
 * @param {Set<string>} input.rejected
 * @param {import('./types.js').ExternalImportResolution} input.resolution
 * @param {Set<string>} input.projectedFixtureIds
 * @returns {string[]} one or more causes
 */
function nothingProjectedCauses(rowId, { rejected, resolution, projectedFixtureIds }) {
  if (rejected.has(rowId)) return [NOTHING_PROJECTED_CAUSE.REFUSED];
  const row = resolution.rows.find((candidate) => candidate.rowId === rowId);
  // A row that is neither rejected nor held by this classification cannot
  // happen — `projectAcceptance()` rejects an unknown row id — but guessing
  // a cause for it would be the defect this table exists to close.
  if (row === undefined || row.fixtureId === null) return [NOTHING_PROJECTED_CAUSE.UNEXPLAINED];
  if (!projectedFixtureIds.has(row.fixtureId)) return [NOTHING_PROJECTED_CAUSE.OUT_OF_SCOPE];
  const fields = row.differences.map((difference) => difference.field);
  if (fields.some((field) => PROJECTED_FIELDS.includes(field))) {
    return [NOTHING_PROJECTED_CAUSE.UNEXPLAINED];
  }
  /** @type {string[]} */
  const causes = [];
  if (fields.length > 0) causes.push(NOTHING_PROJECTED_CAUSE.RECORDED_ONLY);
  // Not `else if`. The two are independent facts about the row: a difference on
  // a recorded field and a field only one artifact carries. Testing the second
  // only when the first missed is what reported a row that was both as one.
  if (row.oneSidedFields.length > 0) causes.push(NOTHING_PROJECTED_CAUSE.ONE_SIDED);
  if (causes.length === 0) causes.push(NOTHING_PROJECTED_CAUSE.AGREES);
  return causes;
}

/**
 * Sort every accepted row into each {@link NOTHING_PROJECTED_CAUSE} that holds
 * of it, and name the rows that landed in more than one.
 *
 * @param {Object} input
 * @param {ReadonlyArray<string>} input.acceptedRowIds
 * @param {ReadonlyArray<string>} input.rejectedRowIds
 * @param {import('./types.js').ExternalImportResolution} input.resolution
 * @param {Set<string>} input.projectedFixtureIds - the fixtures the projection held
 * @returns {{ buckets: Record<string, string[]>, multiple: string[] }} row ids per cause, each sorted
 */
function explainNothingProjected({
  acceptedRowIds,
  rejectedRowIds,
  resolution,
  projectedFixtureIds,
}) {
  /** @type {Record<string, string[]>} */
  const buckets = {};
  for (const cause of NOTHING_PROJECTED_CAUSE_ORDER) buckets[cause] = [];
  const rejected = new Set(rejectedRowIds);
  /** @type {string[]} */
  const multiple = [];

  for (const rowId of acceptedRowIds) {
    const causes = nothingProjectedCauses(rowId, { rejected, resolution, projectedFixtureIds });
    // Coverage, asserted rather than assumed: a row accounted for by no cause
    // is a row the sentence below does not mention, which is the shape of the
    // silent omission this whole family of findings keeps producing.
    if (causes.length === 0) {
      throw new Error(
        `externalImport: accepted row ${JSON.stringify(rowId)} moved nothing and reached no cause; every accepted row must be named under at least one`
      );
    }
    for (const cause of causes) buckets[cause].push(rowId);
    if (causes.length > 1) multiple.push(rowId);
  }

  for (const cause of NOTHING_PROJECTED_CAUSE_ORDER) buckets[cause].sort();
  return { buckets, multiple: multiple.sort() };
}

/**
 * **Analyse one acceptance set.**
 *
 * @param {Object} input
 * @param {string} input.subject
 * @param {import('./types.js').ExternalImportResolution} input.resolution
 * @param {ReadonlyArray<Object>} input.standing - `StandingFixtureSchema` values
 * @param {Object} input.query - see `ImpactQuerySchema`
 * @param {import('../facility/types.js').FacilityGraph} input.graph
 * @param {import('../timing/types.js').FormatTimingTable} input.timingTable
 * @returns {import('./types.js').ExternalImpactResult}
 */
export function analyseImportImpact({ subject, resolution, standing, query, graph, timingTable }) {
  const parsed = /** @type {any} */ (ImpactQuerySchema.parse(query));
  const meta = createExternalImportMeta();

  const importDates = [
    ...new Set(
      resolution.rows
        .filter((row) => row.fixtureId !== null)
        .map((row) => {
          const fixture = standing.find(
            (candidate) => /** @type {any} */ (candidate).fixtureId === row.fixtureId
          );
          return fixture === undefined ? null : /** @type {any} */ (fixture).date;
        })
        .filter((date) => date !== null)
    ),
  ].sort();
  const dates = parsed.dates.length > 0 ? [...parsed.dates].sort() : importDates;
  const scoped = standing.filter((fixture) => dates.includes(/** @type {any} */ (fixture).date));

  const acceptedRowIds = [...parsed.acceptedRowIds].sort();
  const projection = projectAcceptance({
    resolution,
    standing: scoped,
    acceptedRowIds,
    timingTable,
  });

  const before = planFindings(
    graph,
    timingTable,
    scoped.map((fixture) => ({
      fixtureId: /** @type {any} */ (fixture).fixtureId,
      date: /** @type {any} */ (fixture).date,
      kickoffMinutes: /** @type {any} */ (fixture).kickoffMinutes,
      endMinutes: /** @type {any} */ (fixture).endMinutes,
      venueId: /** @type {any} */ (fixture).venueId,
      surfaceId: /** @type {any} */ (fixture).surfaceId,
      format: /** @type {any} */ (fixture).format,
      division: /** @type {any} */ (fixture).division,
      homeLabel: /** @type {any} */ (fixture).homeLabel,
      awayLabel: /** @type {any} */ (fixture).awayLabel,
      movedByRowId: null,
      kickoffDeltaMinutes: null,
    }))
  );
  const after = planFindings(graph, timingTable, projection.fixtures);

  meta.acceptanceSetsExamined = 1;
  meta.fixturesProjected = projection.moved.length;
  meta.bookingPairsCompared = after.pairsCompared;
  meta.bookingPairsUndecidable = after.undecidable.length;

  const movedIds = new Set(projection.moved.map((fixture) => fixture.fixtureId));
  const touchedUndecidable = after.undecidable.filter(
    (pair) => movedIds.has(pair.aId) || movedIds.has(pair.bId)
  );
  const standingUndecidable = after.undecidable.length - touchedUndecidable.length;

  /** @type {import('./types.js').ExternalImportFinding[]} */
  const introduced = [];
  /** @type {import('./types.js').ExternalImportFinding[]} */
  const resolvedAway = [];
  /** @type {import('./types.js').ExternalImportFinding[]} */
  const preexisting = [];

  for (const [key, finding] of after.byKey) {
    if (before.byKey.has(key)) {
      preexisting.push(
        restate(
          finding,
          EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_PREEXISTING,
          'already true of the standing plan: '
        )
      );
    } else {
      introduced.push(finding);
    }
  }
  for (const [key, finding] of before.byKey) {
    if (after.byKey.has(key)) continue;
    resolvedAway.push(
      restate(
        finding,
        EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_CLASH_RESOLVED,
        'no longer true after this acceptance: '
      )
    );
  }

  meta.clashesIntroduced = introduced.length;
  meta.clashesResolved = resolvedAway.length;
  meta.clashesPreexisting = preexisting.length;

  for (const pair of touchedUndecidable) {
    introduced.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_UNDETERMINED,
        `${pair.aId} and ${pair.bId} share ground on ${pair.date} and one of them has no known end (GAP-14), so accepting this set leaves their concurrency undecided; a null from bookingsOverlapInTime() is not a "no clash"`,
        {
          bookingAId: pair.aId,
          bookingBId: pair.bId,
          surfaceAId: pair.surfaceAId,
          surfaceBId: pair.surfaceBId,
          date: pair.date,
          movedFixtureIds: [pair.aId, pair.bId].filter((id) => movedIds.has(id)),
        }
      )
    );
  }

  const setKey = acceptanceSetKey(acceptedRowIds);
  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [...projection.findings, ...introduced, ...resolvedAway, ...preexisting];

  if (acceptedRowIds.length > 0 && projection.moved.length === 0) {
    const rejectedRowIds = projection.findings
      .filter(
        (finding) => finding.code === EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_ROW_NOT_ACCEPTABLE
      )
      .map((finding) => /** @type {string} */ (finding.details.rowId))
      .sort();
    const { buckets, multiple } = explainNothingProjected({
      acceptedRowIds,
      rejectedRowIds,
      resolution,
      projectedFixtureIds: new Set(projection.fixtures.map((fixture) => fixture.fixtureId)),
    });
    const said = NOTHING_PROJECTED_CAUSE_ORDER.map((cause) => {
      const rowIds = buckets[cause];
      if (rowIds.length === 0) return null;
      return `${rowIds.length} ${NOTHING_PROJECTED_CLAUSE[cause]} (${rowIds.join(', ')})`;
    }).filter((clause) => clause !== null);
    // Said outright, because the counts above no longer sum to the accepted
    // count and a reader who adds them would conclude the set was bigger than
    // it is. The alternative — keeping the clauses exclusive — is what reported
    // a row that was two things as one of them.
    const overlap =
      multiple.length > 0
        ? `. ${multiple.length} row(s) above are named under more than one cause, because a row can be more than one thing, and the counts therefore do not sum to ${acceptedRowIds.length} (${multiple.join(', ')})`
        : '';
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_PROJECTED,
        `accepting ${acceptedRowIds.length} row(s) moved no fixture: ${said.join('; ')}${overlap}. This verdict is therefore about a change that does not exist, and says nothing about whether the rows were applied`,
        {
          setKey,
          acceptedRowIds,
          dates,
          rejectedRowIds: buckets[NOTHING_PROJECTED_CAUSE.REFUSED],
          outOfScopeRowIds: buckets[NOTHING_PROJECTED_CAUSE.OUT_OF_SCOPE],
          unprojectedRowIds: buckets[NOTHING_PROJECTED_CAUSE.RECORDED_ONLY],
          oneSidedRowIds: buckets[NOTHING_PROJECTED_CAUSE.ONE_SIDED],
          agreeingRowIds: buckets[NOTHING_PROJECTED_CAUSE.AGREES],
          unexplainedRowIds: buckets[NOTHING_PROJECTED_CAUSE.UNEXPLAINED],
          rowsUnderMoreThanOneCause: multiple,
        }
      )
    );
  }

  if (after.pairsCompared === 0) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_NOTHING_EXAMINED,
        `the projection over ${dates.join(', ') || 'no dates'} compared no pair of bookings, so "nothing was introduced" here means "nothing was looked at"`,
        { setKey, dates, fixturesInScope: scoped.length }
      )
    );
  }

  findings.push(
    makeExternalImportFinding(
      EXTERNAL_IMPORT_REASON.EXTERNAL_IMPACT_SCOPE_STATED,
      `this verdict is about the acceptance set ${setKey} alone and does not transfer to any subset or superset of it; it consulted facility occupancy and the format's block and turnover floor over ${dates.join(', ') || 'no dates'}, and did not consult ${EXTERNAL_IMPACT_LAYERS_NOT_CONSULTED.join('; ')}`,
      {
        setKey,
        acceptedRowIds,
        dates,
        fixturesInScope: scoped.length,
        fixturesMoved: projection.moved.length,
        bookingPairsCompared: after.pairsCompared,
        standingUndecidablePairs: standingUndecidable,
        layersNotConsulted: EXTERNAL_IMPACT_LAYERS_NOT_CONSULTED,
      }
    )
  );

  assertExternalImportFindings(findings, `impact of accepting ${setKey}`);

  return {
    subject,
    acceptedRowIds,
    setKey,
    dates,
    verdict: deriveExternalImpactVerdict({
      undecidablePairs: touchedUndecidable.length,
      introduced,
    }),
    moved: projection.moved,
    introduced,
    resolved: resolvedAway,
    preexisting,
    findings,
    status: deriveExternalImportStatus(findings),
    meta,
  };
}

/**
 * Every subset of a list, smallest first, as a list of sorted id arrays.
 *
 * @param {ReadonlyArray<string>} ids
 * @returns {string[][]}
 */
function allSubsets(ids) {
  /** @type {string[][]} */
  let out = [[]];
  for (const id of ids) out = out.concat(out.map((subset) => [...subset, id]));
  return out
    .map((subset) => [...subset].sort())
    .sort((a, b) => a.length - b.length || acceptanceSetKey(a).localeCompare(acceptanceSetKey(b)));
}

/**
 * **Sweep the acceptance sets, and report a safe set with an unsafe subset.**
 *
 * This is the entry point that answers the question the corpus poses. On the
 * season-2026 external publication the domain is four rows, all sixteen sets are
 * examined, and the sweep's own figures — not a hand-written expectation — say
 * how many are safe.
 *
 * @param {Object} input
 * @param {string} input.subject
 * @param {import('./types.js').ExternalImportResolution} input.resolution
 * @param {ReadonlyArray<Object>} input.standing
 * @param {import('../facility/types.js').FacilityGraph} input.graph
 * @param {import('../timing/types.js').FormatTimingTable} input.timingTable
 * @param {ReadonlyArray<ReadonlyArray<string>>} [input.sets] - override the enumeration
 * @param {ReadonlyArray<string>} [input.dates]
 * @returns {import('./types.js').ExternalAcceptanceSweep}
 */
export function sweepAcceptanceSets({
  subject,
  resolution,
  standing,
  graph,
  timingTable,
  sets,
  dates = [],
}) {
  const domain = acceptanceDomainOf(resolution);
  const setsPossible = 2 ** domain.length;
  const meta = createExternalImportMeta();
  /** @type {import('./types.js').ExternalImportFinding[]} */
  const findings = [];

  /** @type {string[][]} */
  let candidateSets;
  if (sets !== undefined) {
    candidateSets = sets.map((set) => [...set].sort());
  } else if (domain.length <= ACCEPTANCE_SWEEP_CAP) {
    candidateSets = allSubsets(domain);
  } else {
    const singletons = domain.map((id) => [id]);
    const complements = domain.map((id) => domain.filter((other) => other !== id));
    candidateSets = [[], [...domain], ...singletons, ...complements];
  }

  /**
   * **How many of the `2 ** n` these sets actually cover**, and therefore
   * whether the sweep is exhaustive.
   *
   * Exhaustiveness used to be `candidateSets.length === setsPossible` on the
   * caller-supplied branch and a hard `true` on the enumerated one. Both were
   * **counts**, and a count is not a cover: sixteen copies of the empty set over
   * a four-row domain published `exhaustive: true` and suppressed
   * `EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE` — this module's own failure mode,
   * a sweep that quietly skipped the subset that breaks and reported the ones it
   * tried as though they were all of them.
   *
   * So it is derived here, once, from whichever list the branches above
   * produced, and no branch gets to assert it about itself. A set naming a row
   * outside the domain covers nothing of the domain and is dropped before
   * counting; duplicates collapse. The domain has exactly `setsPossible`
   * distinct subsets, so reaching that many distinct ones *is* the cover, and it
   * is established without enumerating `2 ** n` of them to compare against.
   */
  const inDomain = new Set(domain);
  const setsCovered = new Set(
    candidateSets
      .filter((set) => set.every((rowId) => inDomain.has(rowId)))
      .map((set) => acceptanceSetKey([...new Set(set)]))
  ).size;
  const exhaustive = setsCovered === setsPossible;

  /** @type {import('./types.js').ExternalImpactResult[]} */
  const results = [];
  for (const set of candidateSets) {
    const result = analyseImportImpact({
      subject,
      resolution,
      standing,
      query: { acceptedRowIds: set, dates: [...dates] },
      graph,
      timingTable,
    });
    results.push(result);
    meta.acceptanceSetsExamined += 1;
    meta.fixturesProjected += result.meta.fixturesProjected;
    meta.bookingPairsCompared += result.meta.bookingPairsCompared;
    meta.bookingPairsUndecidable += result.meta.bookingPairsUndecidable;
    meta.clashesIntroduced += result.meta.clashesIntroduced;
    meta.clashesResolved += result.meta.clashesResolved;
    meta.clashesPreexisting += result.meta.clashesPreexisting;
  }

  const safeSetKeys = results
    .filter((result) => result.verdict === EXTERNAL_IMPACT_VERDICT.SAFE)
    .map((result) => result.setKey);
  const unsafeSetKeys = results
    .filter((result) => result.verdict === EXTERNAL_IMPACT_VERDICT.UNSAFE)
    .map((result) => result.setKey);
  const undeterminedSetKeys = results
    .filter((result) => result.verdict === EXTERNAL_IMPACT_VERDICT.UNDETERMINED)
    .map((result) => result.setKey);

  // A safe set with an unsafe subset is the whole point. It is reported at
  // blocking on the sweep, because an operator reading "the import is safe" and
  // then accepting three of its four rows is the failure this module exists to
  // stop.
  for (const result of results) {
    if (result.verdict !== EXTERNAL_IMPACT_VERDICT.SAFE) continue;
    const accepted = new Set(result.acceptedRowIds);
    const unsafeSubsets = results.filter(
      (other) =>
        other.setKey !== result.setKey &&
        other.acceptedRowIds.length < result.acceptedRowIds.length &&
        other.verdict !== EXTERNAL_IMPACT_VERDICT.SAFE &&
        other.acceptedRowIds.every((rowId) => accepted.has(rowId))
    );
    if (unsafeSubsets.length === 0) continue;
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SUBSET_UNSAFE,
        `accepting ${result.setKey} is safe, and ${unsafeSubsets.length} subset(s) of it are not (${unsafeSubsets.map((other) => other.setKey).join(', ')}); a verdict about the whole import says nothing about a partial acceptance of it`,
        {
          setKey: result.setKey,
          acceptedRowIds: result.acceptedRowIds,
          unsafeSubsetKeys: unsafeSubsets.map((other) => other.setKey),
          unsafeSubsetVerdicts: unsafeSubsets.map((other) => other.verdict),
        }
      )
    );
  }

  if (!exhaustive) {
    findings.push(
      makeExternalImportFinding(
        EXTERNAL_IMPORT_REASON.EXTERNAL_ACCEPTANCE_SETS_NOT_EXHAUSTIVE,
        `${candidateSets.length} acceptance set(s) were examined and they cover ${setsCovered} of the ${setsPossible} possible over ${domain.length} row(s); a set not covered has no verdict here, and its absence from the unsafe list means nothing`,
        {
          domainSize: domain.length,
          setsPossible,
          setsExamined: candidateSets.length,
          setsCovered,
          cap: ACCEPTANCE_SWEEP_CAP,
        }
      )
    );
  }

  assertExternalImportFindings(findings, `acceptance sweep of ${subject}`);

  // The sweep's own status folds in every set's blocking findings as well as its
  // own, so a sweep in which one set is unsafe cannot come back `allowed`.
  const composed = [
    ...findings,
    ...results.flatMap((result) =>
      result.findings.filter(
        (finding) => externalImportSeverityOf(finding.code) === EXTERNAL_IMPORT_SEVERITY.BLOCKING
      )
    ),
  ];

  return {
    subject,
    domainRowIds: domain,
    exhaustive,
    setsPossible,
    results,
    safeSetKeys,
    unsafeSetKeys,
    undeterminedSetKeys,
    findings,
    status: deriveExternalImportStatus(composed),
    meta,
  };
}

/**
 * Look up one set's result in a sweep, by its ids.
 *
 * Scans `sweep.results`, which is the sweep's own published record of what it
 * examined and the only place a caller holding a sweep can look. `sweepAcceptanceSets()`
 * used to build a `setKey -> result` index alongside it and never read it, so
 * the sweep carried two accounts of the same thing and one of them could drift
 * out of agreement with the other unnoticed. There is one now.
 *
 * @param {import('./types.js').ExternalAcceptanceSweep} sweep
 * @param {ReadonlyArray<string>} rowIds
 * @returns {import('./types.js').ExternalImpactResult|null}
 */
export function impactOfSet(sweep, rowIds) {
  const key = acceptanceSetKey(rowIds);
  return sweep.results.find((result) => result.setKey === key) ?? null;
}
