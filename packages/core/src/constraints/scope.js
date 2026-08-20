/**
 * Scope matching, effective windows, and the precedence rule.
 *
 * **The precedence rule, in full.** Given a set of records that speak to one
 * policy and one context:
 *
 * 1. Drop nothing silently. Every candidate is *judged* and the verdict is kept
 *    (`ConstraintApplicability`), so "why did this rule not apply?" always has
 *    an answer.
 * 2. A record outside its effective window is **inactive**, reported as
 *    `CONSTRAINT_NOT_YET_EFFECTIVE` or `CONSTRAINT_EXPIRED`. A record whose
 *    window cannot be judged because the caller gave no date is
 *    `CONSTRAINT_WINDOW_UNJUDGED` at `compromise` — not a pass.
 * 3. A record whose scope dimension is absent from the context is
 *    `CONSTRAINT_SCOPE_UNJUDGED` at `compromise`. Falling through to the global
 *    answer is precisely how the Orchard Park rule would get lost.
 * 4. Among what is left, group by **type tier** (hard / soft / preference). The
 *    tiers do not compete: "10 minutes is the hard floor" and "20 minutes is
 *    what we aim for" are both true simultaneously.
 * 5. Within a tier, the **narrowest scope wins** — `venue` (2) beats `global`
 *    (0), which is the Orchard Park case in GAP-12.
 * 6. If two survive at the same specificity and **disagree**, the more
 *    restrictive is applied *and* `CONSTRAINT_PRECEDENCE_AMBIGUOUS` is emitted.
 *    The resolver never picks a winner silently — the same contract
 *    `EQUIPMENT_PRECEDENCE_AMBIGUOUS` and `PERMIT_PRECEDENCE_AMBIGUOUS` already
 *    keep. Records that agree are not ambiguous; the first by id is taken and
 *    nothing is reported.
 *
 * "More restrictive" is asked of the record, not of a central table: each
 * carries `restrictiveDirection`, because a *minimum* gap gets stricter as the
 * number rises and a *maximum* gap gets stricter as it falls.
 *
 * @module constraints/scope
 */

import {
  CONSTRAINT_REASON,
  CONSTRAINT_SCOPE_KIND,
  makeConstraintFinding,
  specificityOf,
  typeRankOf,
} from './reasonCodes.js';

/**
 * Is this record live on this date?
 *
 * `date` of `undefined` means the caller did not say, which is a third answer
 * (`judged: false`) rather than a yes.
 *
 * @param {import('./types.js').ConstraintRecord} record
 * @param {string|undefined} date - ISO `YYYY-MM-DD`
 * @returns {{ active: boolean, judged: boolean, code: string|null }}
 */
export function judgeWindow(record, date) {
  const bounded = record.effectiveFrom !== null || record.effectiveTo !== null;
  if (!bounded) return { active: true, judged: true, code: null };
  if (date === undefined || date === null) {
    return { active: false, judged: false, code: CONSTRAINT_REASON.CONSTRAINT_WINDOW_UNJUDGED };
  }
  if (record.effectiveFrom !== null && date < record.effectiveFrom) {
    return { active: false, judged: true, code: CONSTRAINT_REASON.CONSTRAINT_NOT_YET_EFFECTIVE };
  }
  if (record.effectiveTo !== null && date > record.effectiveTo) {
    return { active: false, judged: true, code: CONSTRAINT_REASON.CONSTRAINT_EXPIRED };
  }
  return { active: true, judged: true, code: null };
}

/**
 * The context field each scope kind is judged against, and the record field it
 * is compared with. `null` means the kind needs no context field (global).
 */
const SCOPE_MATCHERS = Object.freeze({
  [CONSTRAINT_SCOPE_KIND.GLOBAL]: null,
  [CONSTRAINT_SCOPE_KIND.DATE]: { contextField: 'date', recordField: 'date' },
  [CONSTRAINT_SCOPE_KIND.DATE_RANGE]: { contextField: 'date', recordField: null },
  [CONSTRAINT_SCOPE_KIND.VENUE]: { contextField: 'venueId', recordField: 'venueId' },
  [CONSTRAINT_SCOPE_KIND.SURFACE]: { contextField: 'surfaceLineage', recordField: 'surfaceId' },
  [CONSTRAINT_SCOPE_KIND.DIVISION]: {
    contextField: 'divisionLabel',
    recordField: 'divisionLabel',
  },
  [CONSTRAINT_SCOPE_KIND.TEAM]: { contextField: 'teamIds', recordField: 'teamId' },
  [CONSTRAINT_SCOPE_KIND.PERSON]: { contextField: 'personIds', recordField: 'personId' },
});

/**
 * Normalise a context so the plural forms always exist.
 *
 * `surfaceLineage` defaults to `[surfaceId]` — correct for a leaf, and lossy for
 * anything with ancestors, which is why callers that hold a
 * {@link import('../facility/types.js').FacilityGraph} should pass
 * `surface.lineage` instead of relying on this.
 *
 * @param {import('./types.js').ScopeContext} context
 * @returns {Record<string, unknown>}
 */
export function normaliseContext(context = {}) {
  const teamIds = context.teamIds ?? (context.teamId ? [context.teamId] : undefined);
  const personIds = context.personIds ?? (context.personId ? [context.personId] : undefined);
  const surfaceLineage =
    context.surfaceLineage ?? (context.surfaceId ? [context.surfaceId] : undefined);
  return { ...context, teamIds, personIds, surfaceLineage };
}

/**
 * Does this record's scope cover this context?
 *
 * @param {import('./types.js').ConstraintRecord} record
 * @param {import('./types.js').ScopeContext} context - already normalised
 * @returns {{ inScope: boolean, judged: boolean, code: string|null, dimensionsTested: number }}
 */
export function judgeScope(record, context) {
  const matcher = SCOPE_MATCHERS[record.scope.kind];
  if (matcher === null || matcher === undefined) {
    // `global`: nothing to narrow on, so nothing to test.
    return { inScope: true, judged: true, code: null, dimensionsTested: 0 };
  }

  const value = /** @type {Record<string, unknown>} */ (context)[matcher.contextField];
  if (value === undefined || value === null) {
    return {
      inScope: false,
      judged: false,
      code: CONSTRAINT_REASON.CONSTRAINT_SCOPE_UNJUDGED,
      dimensionsTested: 1,
    };
  }

  if (record.scope.kind === CONSTRAINT_SCOPE_KIND.DATE_RANGE) {
    const date = /** @type {string} */ (value);
    const inScope =
      (record.scope.fromDate === null || date >= record.scope.fromDate) &&
      (record.scope.toDate === null || date <= record.scope.toDate);
    return { inScope, judged: true, code: null, dimensionsTested: 1 };
  }

  const target = record.scope[/** @type {string} */ (matcher.recordField)];
  const inScope = Array.isArray(value) ? value.includes(target) : value === target;
  const code =
    inScope && record.scope.kind === CONSTRAINT_SCOPE_KIND.DIVISION
      ? CONSTRAINT_REASON.CONSTRAINT_DIVISION_LABEL_MATCH
      : null;
  return { inScope, judged: true, code, dimensionsTested: 1 };
}

/**
 * Judge one record against one context, keeping the verdict either way.
 *
 * @param {import('./types.js').ConstraintRecord} record
 * @param {import('./types.js').ScopeContext} context - already normalised
 * @returns {{ applicability: import('./types.js').ConstraintApplicability, findings: import('./types.js').ConstraintFinding[], dimensionsTested: number }}
 */
export function judgeApplicability(record, context) {
  /** @type {import('./types.js').ConstraintFinding[]} */
  const findings = [];
  const window = judgeWindow(record, /** @type {string|undefined} */ (context.date));
  const scope = judgeScope(record, context);

  if (window.code) {
    findings.push(
      makeConstraintFinding(
        window.code,
        window.code === CONSTRAINT_REASON.CONSTRAINT_WINDOW_UNJUDGED
          ? `constraint "${record.id}" has an effective window and no date was supplied, so whether it applies cannot be decided`
          : `constraint "${record.id}" is outside its effective window on ${context.date}`,
        {
          constraintId: record.id,
          policy: record.policy,
          date: context.date ?? null,
          effectiveFrom: record.effectiveFrom,
          effectiveTo: record.effectiveTo,
        }
      )
    );
  }
  if (scope.code) {
    findings.push(
      makeConstraintFinding(
        scope.code,
        scope.code === CONSTRAINT_REASON.CONSTRAINT_SCOPE_UNJUDGED
          ? `constraint "${record.id}" is scoped to a ${record.scope.kind} and the context names none, so whether it applies cannot be decided`
          : `constraint "${record.id}" matched division label "${record.scope.divisionLabel}"; division labels are not a key (GAP-24)`,
        {
          constraintId: record.id,
          policy: record.policy,
          scopeKind: record.scope.kind,
          divisionLabel: record.scope.divisionLabel,
        }
      )
    );
  }

  return {
    applicability: {
      constraintId: record.id,
      applicable: window.active && scope.inScope,
      inWindow: window.active,
      inScope: scope.inScope,
      judged: window.judged && scope.judged,
      specificity: specificityOf(record.scope.kind),
      code: window.code ?? scope.code ?? null,
    },
    findings,
    dimensionsTested: scope.dimensionsTested,
  };
}

/**
 * Do two records say the same thing?
 *
 * Compared on the parts that change an outcome — type and parameters — not on
 * rationale, source or name. Two records that agree are not an ambiguity; they
 * are duplication, which is a tidiness problem rather than a correctness one.
 *
 * @param {import('./types.js').ConstraintRecord} a
 * @param {import('./types.js').ConstraintRecord} b
 * @returns {boolean}
 */
export function recordsAgree(a, b) {
  if (a.type !== b.type) return false;
  const keys = new Set([...Object.keys(a.parameters), ...Object.keys(b.parameters)]);
  for (const key of keys) {
    if (a.parameters[key] !== b.parameters[key]) return false;
  }
  const aCodes = [...a.reasonCodes].sort().join(' ');
  const bCodes = [...b.reasonCodes].sort().join(' ');
  return aCodes === bCodes;
}

/**
 * Which of two records is more restrictive?
 *
 * Order of comparison: hardness first (a hard rule always beats a soft one),
 * then the record's own numeric parameters in the direction it declares, then
 * the id so the answer is deterministic rather than input-order dependent.
 *
 * @param {import('./types.js').ConstraintRecord} a
 * @param {import('./types.js').ConstraintRecord} b
 * @returns {import('./types.js').ConstraintRecord}
 */
export function moreRestrictiveOf(a, b) {
  const typeDelta = typeRankOf(a.type) - typeRankOf(b.type);
  if (typeDelta !== 0) return typeDelta > 0 ? a : b;

  if (a.restrictiveDirection !== 'none' && a.restrictiveDirection === b.restrictiveDirection) {
    const keys = [...new Set([...Object.keys(a.parameters), ...Object.keys(b.parameters)])].sort();
    for (const key of keys) {
      const av = a.parameters[key];
      const bv = b.parameters[key];
      if (typeof av !== 'number' || typeof bv !== 'number' || av === bv) continue;
      const higherWins = a.restrictiveDirection === 'higher';
      return (higherWins ? av > bv : av < bv) ? a : b;
    }
  }

  return a.id <= b.id ? a : b;
}

/**
 * Pick the winner among candidates of one type tier.
 *
 * @param {import('./types.js').ConstraintRecord[]} candidates - all applicable, one tier
 * @returns {{ winner: import('./types.js').ConstraintRecord|null, ambiguousWith: string[], loserIds: string[] }}
 */
export function pickByPrecedence(candidates) {
  if (candidates.length === 0) return { winner: null, ambiguousWith: [], loserIds: [] };

  let best = specificityOf(candidates[0].scope.kind);
  for (const candidate of candidates) {
    const rank = specificityOf(candidate.scope.kind);
    if (rank > best) best = rank;
  }
  const finalists = candidates.filter((candidate) => specificityOf(candidate.scope.kind) === best);

  let winner = finalists[0];
  for (const finalist of finalists.slice(1)) {
    winner = moreRestrictiveOf(winner, finalist);
  }

  const ambiguousWith = finalists
    .filter((finalist) => finalist.id !== winner.id && !recordsAgree(finalist, winner))
    .map((finalist) => finalist.id)
    .sort();

  const loserIds = candidates
    .filter((candidate) => candidate.id !== winner.id)
    .map((candidate) => candidate.id)
    .sort();

  return { winner, ambiguousWith, loserIds };
}
