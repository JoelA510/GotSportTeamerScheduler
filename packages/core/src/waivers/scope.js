/**
 * Scope matching and effective windows for waivers.
 *
 * **The composition rule, in full.** A waiver reaches a subject when *all* of
 * the following hold, and every step keeps its verdict rather than dropping it:
 *
 * 1. The waiver is **live** on the subject's date. Outside its window it is
 *    reported `WAIVER_NOT_YET_EFFECTIVE` or `WAIVER_EXPIRED` at `info`; a
 *    waiver with a window judged against a subject carrying no date is
 *    `WAIVER_WINDOW_UNJUDGED` at `compromise` — not a pass, and not a
 *    silent application either.
 * 2. **Every dimension it names matches.** The dimensions compose as a
 *    conjunction: person *and* venue pair, not person *or* venue pair. A
 *    dimension the subject does not carry is `WAIVER_SCOPE_UNJUDGED` at
 *    `compromise`; falling through to "close enough" is how an exception
 *    granted for one coach ends up excusing the whole club.
 * 3. The waiver is **no broader than the constraint** it excepts. A waiver
 *    whose narrowest dimension is broader than the constraint's scope is a
 *    repeal wearing an exception's clothes, and earns
 *    `WAIVER_BROADER_THAN_CONSTRAINT` at `compromise`. It is still applied —
 *    the operator wrote it down and it is not this module's place to ignore it
 *    — but nobody gets to be surprised by it later.
 *
 * Step 3 is where waiver scope and constraint scope meet, and the integers are
 * deliberately shared: `WAIVER_SCOPE_SPECIFICITY` uses exactly the ranks
 * `CONSTRAINT_SCOPE_SPECIFICITY` uses, so the comparison is meaningful rather
 * than coincidental. A `global` constraint has rank 0, so any waiver at all is
 * narrower than it, which is why incident 9's person-scoped exception to the
 * global travel floor composes cleanly.
 *
 * @module waivers/scope
 */

import { specificityOf } from '../constraints/reasonCodes.js';

import {
  WAIVER_REASON,
  WAIVER_SCOPE_DIMENSION,
  makeWaiverFinding,
  waiverSpecificityOf,
} from './reasonCodes.js';

/**
 * Is this waiver live on this date?
 *
 * `date` of `undefined` means the caller did not say, which is a third answer
 * (`judged: false`) rather than a yes.
 *
 * @param {import('./types.js').WaiverRecord} record
 * @param {string|undefined} date - ISO `YYYY-MM-DD`
 * @returns {{ active: boolean, judged: boolean, code: string|null }}
 */
export function judgeWaiverWindow(record, date) {
  const bounded = record.effectiveFrom !== null || record.effectiveTo !== null;
  if (!bounded) return { active: true, judged: true, code: null };
  if (date === undefined || date === null) {
    return { active: false, judged: false, code: WAIVER_REASON.WAIVER_WINDOW_UNJUDGED };
  }
  if (record.effectiveFrom !== null && date < record.effectiveFrom) {
    return { active: false, judged: true, code: WAIVER_REASON.WAIVER_NOT_YET_EFFECTIVE };
  }
  if (record.effectiveTo !== null && date > record.effectiveTo) {
    return { active: false, judged: true, code: WAIVER_REASON.WAIVER_EXPIRED };
  }
  return { active: true, judged: true, code: null };
}

/**
 * Normalise a context so the plural forms always exist.
 *
 * `surfaceLineage` defaults to `[surfaceId]` — correct for a leaf and lossy for
 * anything with ancestors, so callers holding a
 * {@link import('../facility/types.js').FacilityGraph} should pass
 * `surface.lineage`. `venueIds` defaults to `[venueId]`, which is the
 * single-venue subject; a travel transition names both ends.
 *
 * @param {import('./types.js').WaiverContext} [context]
 * @returns {Record<string, unknown>}
 */
export function normaliseWaiverContext(context = {}) {
  return {
    ...context,
    personIds: context.personIds ?? (context.personId ? [context.personId] : undefined),
    teamIds: context.teamIds ?? (context.teamId ? [context.teamId] : undefined),
    gameIds: context.gameIds ?? (context.gameId ? [context.gameId] : undefined),
    venueIds: context.venueIds ?? (context.venueId ? [context.venueId] : undefined),
    surfaceLineage: context.surfaceLineage ?? (context.surfaceId ? [context.surfaceId] : undefined),
  };
}

/**
 * Every dimension a waiver names, in a stable order.
 *
 * @param {import('./types.js').WaiverRecord} record
 * @returns {string[]}
 */
export function waiverDimensions(record) {
  const scope = record.scope;
  /** @type {string[]} */
  const named = [];
  if (scope.personId !== null) named.push(WAIVER_SCOPE_DIMENSION.PERSON);
  if (scope.teamId !== null) named.push(WAIVER_SCOPE_DIMENSION.TEAM);
  if (scope.gameId !== null) named.push(WAIVER_SCOPE_DIMENSION.GAME);
  if (scope.venueIds !== null) named.push(WAIVER_SCOPE_DIMENSION.VENUES);
  if (scope.surfaceId !== null) named.push(WAIVER_SCOPE_DIMENSION.SURFACE);
  if (scope.divisionLabel !== null) named.push(WAIVER_SCOPE_DIMENSION.DIVISION);
  if (scope.date !== null) named.push(WAIVER_SCOPE_DIMENSION.DATE);
  if (scope.fromDate !== null || scope.toDate !== null) {
    named.push(WAIVER_SCOPE_DIMENSION.DATE_RANGE);
  }
  return named.sort();
}

/**
 * How narrow a waiver is: the rank of the narrowest dimension it names.
 *
 * The *narrowest* rather than the broadest, because a conjunction is at least
 * as narrow as its narrowest term: "this coach, on any date" is a statement
 * about one person however many dates it covers.
 *
 * @param {import('./types.js').WaiverRecord} record
 * @returns {number}
 */
export function waiverSpecificity(record) {
  const dimensions = waiverDimensions(record);
  let best = 0;
  for (const dimension of dimensions) {
    const rank = waiverSpecificityOf(dimension);
    if (rank > best) best = rank;
  }
  return best;
}

/**
 * Does every dimension this waiver names match the subject?
 *
 * Written as a flat sequence of independent checks rather than a table-driven
 * loop on purpose: each dimension matches by its own rule — an id against a
 * list, a venue set against a superset, a date against a range — and a generic
 * matcher would have to be told the rule anyway.
 *
 * @param {import('./types.js').WaiverRecord} record
 * @param {Record<string, unknown>} context - already normalised
 * @returns {{ inScope: boolean, judged: boolean, code: string|null, dimensionsTested: number, labelMatched: boolean }}
 */
export function judgeWaiverScope(record, context) {
  const scope = record.scope;
  const unjudged = WAIVER_REASON.WAIVER_SCOPE_UNJUDGED;
  let dimensionsTested = 0;
  let labelMatched = false;

  /** @type {Array<{ named: unknown, value: unknown, matches: () => boolean }>} */
  const checks = [];

  if (scope.personId !== null) {
    checks.push({
      named: scope.personId,
      value: context.personIds,
      matches: () =>
        /** @type {string[]} */ (context.personIds).includes(
          /** @type {string} */ (scope.personId)
        ),
    });
  }
  if (scope.teamId !== null) {
    checks.push({
      named: scope.teamId,
      value: context.teamIds,
      matches: () =>
        /** @type {string[]} */ (context.teamIds).includes(/** @type {string} */ (scope.teamId)),
    });
  }
  if (scope.gameId !== null) {
    checks.push({
      named: scope.gameId,
      value: context.gameIds,
      matches: () =>
        /** @type {string[]} */ (context.gameIds).includes(/** @type {string} */ (scope.gameId)),
    });
  }
  if (scope.venueIds !== null) {
    checks.push({
      named: scope.venueIds,
      value: context.venueIds,
      // The waiver names the venues its approval covers; a subject that also
      // touches a venue nobody approved is not the thing that was approved.
      matches: () => {
        const touched = /** @type {string[]} */ (context.venueIds);
        const covered = /** @type {string[]} */ (scope.venueIds);
        return touched.length > 0 && touched.every((venueId) => covered.includes(venueId));
      },
    });
  }
  if (scope.surfaceId !== null) {
    checks.push({
      named: scope.surfaceId,
      value: context.surfaceLineage,
      matches: () =>
        /** @type {string[]} */ (context.surfaceLineage).includes(
          /** @type {string} */ (scope.surfaceId)
        ),
    });
  }
  if (scope.date !== null) {
    checks.push({
      named: scope.date,
      value: context.date,
      matches: () => context.date === scope.date,
    });
  }
  if (scope.fromDate !== null || scope.toDate !== null) {
    checks.push({
      named: scope.fromDate ?? scope.toDate,
      value: context.date,
      matches: () => {
        const date = /** @type {string} */ (context.date);
        return (
          (scope.fromDate === null || date >= scope.fromDate) &&
          (scope.toDate === null || date <= scope.toDate)
        );
      },
    });
  }

  for (const check of checks) {
    dimensionsTested += 1;
    if (check.value === undefined || check.value === null) {
      return { inScope: false, judged: false, code: unjudged, dimensionsTested, labelMatched };
    }
    if (!check.matches()) {
      return { inScope: false, judged: true, code: null, dimensionsTested, labelMatched };
    }
  }

  if (scope.divisionLabel !== null) {
    dimensionsTested += 1;
    if (context.divisionLabel === undefined || context.divisionLabel === null) {
      return { inScope: false, judged: false, code: unjudged, dimensionsTested, labelMatched };
    }
    if (context.divisionLabel !== scope.divisionLabel) {
      return { inScope: false, judged: true, code: null, dimensionsTested, labelMatched };
    }
    labelMatched = true;
  }

  return { inScope: true, judged: true, code: null, dimensionsTested, labelMatched };
}

/**
 * Judge one waiver against one subject, keeping the verdict either way.
 *
 * `constraint` is optional so the applicability of a waiver can be judged
 * before its constraint has been looked up; when it is supplied, the
 * broader-than check runs.
 *
 * @param {import('./types.js').WaiverRecord} record
 * @param {Record<string, unknown>} context - already normalised
 * @param {import('../constraints/types.js').ConstraintRecord|null} [constraint]
 * @returns {{ applicability: import('./types.js').WaiverApplicability, findings: import('./types.js').WaiverFinding[], dimensionsTested: number }}
 */
export function judgeWaiverApplicability(record, context, constraint = null) {
  /** @type {import('./types.js').WaiverFinding[]} */
  const findings = [];
  const window = judgeWaiverWindow(record, /** @type {string|undefined} */ (context.date));
  const scope = judgeWaiverScope(record, context);
  const dimensions = waiverDimensions(record);
  const specificity = waiverSpecificity(record);

  if (window.code) {
    findings.push(
      makeWaiverFinding(
        window.code,
        window.code === WAIVER_REASON.WAIVER_WINDOW_UNJUDGED
          ? `waiver "${record.id}" has a validity window and no date was supplied, so whether it applies cannot be decided`
          : `waiver "${record.id}" is outside its validity window on ${context.date}`,
        {
          waiverId: record.id,
          constraintId: record.constraintId,
          date: context.date ?? null,
          effectiveFrom: record.effectiveFrom,
          effectiveTo: record.effectiveTo,
        }
      )
    );
  }

  if (scope.code) {
    findings.push(
      makeWaiverFinding(
        scope.code,
        `waiver "${record.id}" narrows on ${dimensions.join(', ')} and the subject names none of one of them, so whether it applies cannot be decided`,
        {
          waiverId: record.id,
          constraintId: record.constraintId,
          dimensions,
        }
      )
    );
  }

  if (scope.labelMatched && scope.inScope) {
    findings.push(
      makeWaiverFinding(
        WAIVER_REASON.WAIVER_DIVISION_LABEL_MATCH,
        `waiver "${record.id}" matched division label "${record.scope.divisionLabel}"; division labels are not a key (GAP-24)`,
        {
          waiverId: record.id,
          constraintId: record.constraintId,
          divisionLabel: record.scope.divisionLabel,
        }
      )
    );
  }

  const applicable = window.active && scope.inScope;

  if (applicable && constraint && specificity < specificityOf(constraint.scope.kind)) {
    findings.push(
      makeWaiverFinding(
        WAIVER_REASON.WAIVER_BROADER_THAN_CONSTRAINT,
        `waiver "${record.id}" narrows on ${dimensions.join(', ')} while the constraint "${constraint.id}" it excepts is already scoped to a ${constraint.scope.kind}; an exception broader than its rule is a repeal`,
        {
          waiverId: record.id,
          constraintId: constraint.id,
          waiverSpecificity: specificity,
          constraintScopeKind: constraint.scope.kind,
          constraintSpecificity: specificityOf(constraint.scope.kind),
        }
      )
    );
  }

  return {
    applicability: {
      waiverId: record.id,
      constraintId: record.constraintId,
      applicable,
      inWindow: window.active,
      inScope: scope.inScope,
      judged: window.judged && scope.judged,
      specificity,
      dimensions,
      code: window.code ?? scope.code ?? null,
    },
    findings,
    dimensionsTested: scope.dimensionsTested,
  };
}
