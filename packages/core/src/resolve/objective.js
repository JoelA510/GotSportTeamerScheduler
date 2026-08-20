/**
 * **The objective. The only scoring function in this package.**
 *
 * > *"Add change minimisation as a first-class solver objective, distinct from
 * > schedule quality. Today the objective optimises quality alone, so a re-solve
 * > returns the best schedule it can find rather than the nearest acceptable
 * > one. Once a schedule is published, 'nearest' almost always beats 'best.'"*
 *
 * ## Why there is exactly one function here that multiplies anything
 *
 * [`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md) §6.10 records that
 * this repository already carries **two** fitness functions —
 * `autoScheduler.computeFitness()` and a diverged hand-port inside
 * `supabase/functions/auto-scheduler/index.ts` — with different coefficients,
 * different terms, and nothing that detects the drift between them. A third one
 * would not be a feature; it would be the same defect a third time.
 *
 * So the shape of this file is the guarantee. {@link scoreObjective} is the
 * **only** place in `resolve/` where a count is multiplied by a weight. It takes
 * a bag of counted terms and a weight table and returns costs. Everything else
 * here — {@link candidateObjectiveCounts}, {@link objectiveCountsForSchedule} —
 * only *counts*, and every caller in the package (the placer's slot choice, the
 * dry-run report, the change budget) goes through the same one function with the
 * same one table. `tests/minimalDiff.test.js` asserts that structurally: exactly
 * one weight table is declared in `resolve/` and `freeze/`, exactly one function
 * reads it, and no file in either package mentions `computeFitness`.
 *
 * ## Two families of term, and the trade between them is the point
 *
 * | family | terms | counted from |
 * |---|---|---|
 * | **change** | `changedGame`, `driftMinute`, `changedSurface` | the reference schedule, game by game |
 * | **quality** | `unplacedGame`, `blockingViolation`, `compromiseViolation` | the standing rule engine / the facility check |
 *
 * The weights are **policy, not data** — nothing in the corpus can supply them —
 * so what is asserted about them is their *ordering*, and every one of them is
 * overridable per run. The defaults say, in order: never leave a game without a
 * time; never break a blocking constraint; do not move a published game unless
 * ten compromises hang on it; and among slots that score the same, take the one
 * nearest to where the game already was.
 *
 * Setting the three change weights to zero is a supported and deliberately
 * conspicuous act: it is the objective incident 1's solver had, it is what the
 * positive control in `tests/freezeScopes.test.js` runs, and a run scored that
 * way stamps `RESOLVE_OBJECTIVE_CHANGE_TERM_DISABLED` at `compromise` so it can
 * never be mistaken for an ordinary one.
 *
 * @module resolve/objective
 */

import { CONSTRAINT_SEVERITY } from '../constraints/reasonCodes.js';

/**
 * Every term the objective knows how to count.
 *
 * @readonly
 * @enum {string}
 */
export const RESOLVE_OBJECTIVE_TERM = Object.freeze({
  /** One game whose slot differs from the reference schedule's. */
  CHANGED_GAME: 'changedGame',
  /** One minute of kickoff drift away from the reference slot. */
  DRIFT_MINUTE: 'driftMinute',
  /** One game standing on different ground than the reference gave it. */
  CHANGED_SURFACE: 'changedSurface',
  /** One game left with no time at all (incident 10's TIME TBD). */
  UNPLACED_GAME: 'unplacedGame',
  /** One blocking violation or blocking placement finding. */
  BLOCKING_VIOLATION: 'blockingViolation',
  /** One compromise violation or compromise placement finding. */
  COMPROMISE_VIOLATION: 'compromiseViolation',
});

/** Which terms measure distance from the reference schedule. */
export const RESOLVE_CHANGE_TERMS = Object.freeze([
  RESOLVE_OBJECTIVE_TERM.CHANGED_GAME,
  RESOLVE_OBJECTIVE_TERM.DRIFT_MINUTE,
  RESOLVE_OBJECTIVE_TERM.CHANGED_SURFACE,
]);

/** Which terms measure how good the schedule is, irrespective of the diff. */
export const RESOLVE_QUALITY_TERMS = Object.freeze([
  RESOLVE_OBJECTIVE_TERM.UNPLACED_GAME,
  RESOLVE_OBJECTIVE_TERM.BLOCKING_VIOLATION,
  RESOLVE_OBJECTIVE_TERM.COMPROMISE_VIOLATION,
]);

/**
 * The default weights.
 *
 * Policy, and stated as a strict ordering rather than as tuned numbers, because
 * a tuned number invites the next reader to re-tune it:
 *
 * ```text
 * unplacedGame > blockingViolation > changedGame > compromiseViolation > driftMinute = changedSurface
 * ```
 *
 * Read as sentences: a game with no time is worse than an illegal one; an
 * illegal game is worse than ten moved ones; **a moved game is worse than ten
 * compromises**, which is the whole of "nearest beats best"; and how far a game
 * moved, and whether it changed pitch, only separate slots that are otherwise
 * equal.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const RESOLVE_OBJECTIVE_WEIGHTS = Object.freeze({
  [RESOLVE_OBJECTIVE_TERM.UNPLACED_GAME]: 100000,
  [RESOLVE_OBJECTIVE_TERM.BLOCKING_VIOLATION]: 10000,
  [RESOLVE_OBJECTIVE_TERM.CHANGED_GAME]: 1000,
  [RESOLVE_OBJECTIVE_TERM.COMPROMISE_VIOLATION]: 100,
  [RESOLVE_OBJECTIVE_TERM.DRIFT_MINUTE]: 1,
  [RESOLVE_OBJECTIVE_TERM.CHANGED_SURFACE]: 1,
});

/**
 * Resolve a caller's weight overrides against the defaults.
 *
 * Refuses an unknown term rather than ignoring it: a caller who writes
 * `{ changedGames: 0 }` (plural) and gets the default behaviour back has been
 * told nothing, and would report a minimal-diff run they never made.
 *
 * @param {Record<string, number>|null|undefined} overrides
 * @returns {Readonly<Record<string, number>>}
 */
export function resolveObjectiveWeights(overrides) {
  if (overrides === null || overrides === undefined) return RESOLVE_OBJECTIVE_WEIGHTS;
  if (typeof overrides !== 'object') {
    throw new TypeError('resolve: objective weights must be an object of term -> number');
  }
  /** @type {Record<string, number>} */
  const weights = { ...RESOLVE_OBJECTIVE_WEIGHTS };
  for (const [term, weight] of Object.entries(overrides)) {
    if (!Object.hasOwn(RESOLVE_OBJECTIVE_WEIGHTS, term)) {
      throw new Error(
        `resolve: "${term}" is not an objective term; the terms are ${Object.keys(RESOLVE_OBJECTIVE_WEIGHTS).sort().join(', ')}`
      );
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error(
        `resolve: the weight for "${term}" must be a finite number >= 0, not ${String(weight)}`
      );
    }
    weights[term] = weight;
  }
  return Object.freeze(weights);
}

/**
 * Are all three change terms switched off?
 *
 * @param {Readonly<Record<string, number>>} weights
 * @returns {boolean}
 */
export function changeTermsDisabled(weights) {
  return RESOLVE_CHANGE_TERMS.every((term) => (weights[term] ?? 0) === 0);
}

/**
 * **The one function in `resolve/` that multiplies a count by a weight.**
 *
 * @param {Readonly<Record<string, number>>} counts - term -> how many
 * @param {Readonly<Record<string, number>>} weights - term -> what each costs
 * @returns {{ total: number, changeCost: number, qualityCost: number, terms: Record<string, { count: number, weight: number, cost: number }> }}
 */
export function scoreObjective(counts, weights) {
  /** @type {Record<string, { count: number, weight: number, cost: number }>} */
  const terms = {};
  let changeCost = 0;
  let qualityCost = 0;
  for (const term of Object.keys(RESOLVE_OBJECTIVE_WEIGHTS)) {
    const count = counts[term] ?? 0;
    const weight = weights[term] ?? 0;
    const cost = count * weight;
    terms[term] = { count, weight, cost };
    if (/** @type {ReadonlyArray<string>} */ (RESOLVE_CHANGE_TERMS).includes(term)) {
      changeCost += cost;
    } else qualityCost += cost;
  }
  for (const term of Object.keys(counts)) {
    if (!Object.hasOwn(RESOLVE_OBJECTIVE_WEIGHTS, term)) {
      throw new Error(
        `resolve: the objective was handed a count for "${term}", which is not a term it weighs; a counted term nothing scores is a number nobody reads`
      );
    }
  }
  return { total: changeCost + qualityCost, changeCost, qualityCost, terms };
}

/**
 * How far one slot is from the reference slot, as counted terms.
 *
 * `driftMinute` is counted **only when the two slots fall on the same date**.
 * Minutes past midnight on two different days are not a distance, and this
 * package constructs no `Date` and holds no season calendar to turn them into
 * one (GAP-32). A game that changed date is therefore counted as a changed game
 * and, where it applies, a changed surface — never as a drift of some number of
 * minutes it did not actually drift.
 *
 * @param {import('./types.js').Slot|null} reference
 * @param {import('./types.js').Slot|null} slot
 * @returns {Record<string, number>}
 */
export function changeCountsFor(reference, slot) {
  if (reference === null || slot === null) return {};
  const differs =
    reference.date !== slot.date ||
    reference.surfaceId !== slot.surfaceId ||
    reference.startMinutes !== slot.startMinutes;
  if (!differs) return {};
  return {
    [RESOLVE_OBJECTIVE_TERM.CHANGED_GAME]: 1,
    [RESOLVE_OBJECTIVE_TERM.DRIFT_MINUTE]:
      reference.date === slot.date ? Math.abs(slot.startMinutes - reference.startMinutes) : 0,
    [RESOLVE_OBJECTIVE_TERM.CHANGED_SURFACE]: reference.surfaceId === slot.surfaceId ? 0 : 1,
  };
}

/**
 * The terms one candidate slot for one game carries.
 *
 * The quality half is **consumed** from `checkPlacement()` — which is Phase 1.3's
 * `checkKickoffAvailability()` re-severitied by the Phase 2.1 registry — rather
 * than re-derived here. This file weighs; it does not decide what is illegal.
 *
 * @param {Object} input
 * @param {import('./types.js').Slot|null} input.reference - where the game is held from
 * @param {import('./types.js').Slot} input.slot - the candidate
 * @param {ReturnType<import('./legality.js').checkPlacement>|null} [input.placement]
 * @returns {Record<string, number>}
 */
export function candidateObjectiveCounts(input) {
  /** @type {Record<string, number>} */
  const counts = { ...changeCountsFor(input.reference, input.slot) };
  const placement = input.placement ?? null;
  if (placement === null) return counts;
  let blocking = 0;
  let compromise = 0;
  for (const finding of placement.findings) {
    if (finding.severity === CONSTRAINT_SEVERITY.BLOCKING) blocking += 1;
    else if (finding.severity === CONSTRAINT_SEVERITY.COMPROMISE) compromise += 1;
  }
  if (blocking > 0) counts[RESOLVE_OBJECTIVE_TERM.BLOCKING_VIOLATION] = blocking;
  if (compromise > 0) counts[RESOLVE_OBJECTIVE_TERM.COMPROMISE_VIOLATION] = compromise;
  return counts;
}

/**
 * The terms a whole schedule carries against a reference schedule.
 *
 * The changed games are enumerated from the **reference**, never from the
 * candidate and never from a move ledger: a game a stage dropped, or one a stage
 * wrote around the gate, has to be counted rather than vanish with the data that
 * would have named it. That is the same rule `diffAgainstBaseline()` follows and
 * the reason incident 1's recovery had to be game by game.
 *
 * @param {Object} input
 * @param {ReadonlyArray<import('./types.js').PlacedGame>} input.referenceGames
 * @param {ReadonlyArray<import('./types.js').PlacedGame>} input.games
 * @param {Object|null} [input.verification] - a `runRuleEngine()` result, or null
 * @returns {Record<string, number>}
 */
export function objectiveCountsForSchedule(input) {
  const placed = new Map(input.games.map((game) => [game.id, game]));
  /** @type {Record<string, number>} */
  const counts = {};
  const add = (term, howMany) => {
    if (howMany > 0) counts[term] = (counts[term] ?? 0) + howMany;
  };

  for (const before of input.referenceGames) {
    const after = placed.get(before.id) ?? null;
    if (after === null) {
      add(RESOLVE_OBJECTIVE_TERM.UNPLACED_GAME, 1);
      continue;
    }
    const terms = changeCountsFor(
      { date: before.date, surfaceId: before.surfaceId, startMinutes: before.startMinutes },
      { date: after.date, surfaceId: after.surfaceId, startMinutes: after.startMinutes }
    );
    for (const [term, count] of Object.entries(terms)) add(term, count);
  }

  const verification = input.verification ?? null;
  if (verification !== null) {
    for (const violation of verification.violations) {
      if (violation.severity === CONSTRAINT_SEVERITY.BLOCKING) {
        add(RESOLVE_OBJECTIVE_TERM.BLOCKING_VIOLATION, 1);
      } else if (violation.severity === CONSTRAINT_SEVERITY.COMPROMISE) {
        add(RESOLVE_OBJECTIVE_TERM.COMPROMISE_VIOLATION, 1);
      }
    }
  }
  return counts;
}

/**
 * Score a whole schedule against a reference. Convenience over the two functions
 * above, and the shape the dry-run report and the change budget both read.
 *
 * @param {Object} input
 * @param {ReadonlyArray<import('./types.js').PlacedGame>} input.referenceGames
 * @param {ReadonlyArray<import('./types.js').PlacedGame>} input.games
 * @param {Object|null} [input.verification] - a `runRuleEngine()` result, or null
 * @param {Readonly<Record<string, number>>} input.weights
 * @returns {ReturnType<typeof scoreObjective> & { qualityMeasured: boolean }}
 */
export function scoreSchedule(input) {
  const counts = objectiveCountsForSchedule(input);
  return {
    ...scoreObjective(counts, input.weights),
    qualityMeasured: (input.verification ?? null) !== null,
  };
}
