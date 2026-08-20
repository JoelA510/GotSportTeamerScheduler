/**
 * One shape for every answer: the {@link import('./types.js').ConstraintClaim}.
 *
 * Six modules already decide things. This file does not decide a seventh time;
 * it normalises what they decided into one comparable record so that *"the
 * permit closes at 20:00 and you have 150 minutes"*, *"the game on Pitch 1A runs
 * until 12:30"* and *"the travel floor is 60 minutes and this gap is 50"* can be
 * put in one list and read in order.
 *
 * ## What is copied and what is computed
 *
 * **Copied**: every number. `slackMinutes` is the owner's — `limit - end` from
 * `availability/kickoff.js`, `gap - minimum` from `waivers/coachTravel.js`, the
 * stated slack from a resolve cause. `binding` is the owner's. The registry
 * constraint ids come from `registryConstraintIdsFor()`, which is
 * `resolve/errors.js`'s single lookup, not a second one written here. The
 * `summary` line is rendered by `ruleEngine/engine.js`'s `summariseComputed()`,
 * which already produces the build plan's own phrasing.
 *
 * **Computed here**: exactly one thing — how claims from *different* sources
 * interleave, in {@link mergeClaimsByTightness}. Within a source the owner's
 * ordering is passed through untouched, because `orderByTightness()` exists
 * precisely so that nothing else has to sort those four.
 *
 * ## The bar a claim has to clear
 *
 * > *Attribution must name the specific constraint instance and the computed
 * > values, not a category label.*
 *
 * {@link isSpecificClaim} is that sentence as a predicate, and it is checked in
 * production rather than only in a test: a claim that names no instance, or one
 * that carries neither a computed value nor a reason code, makes its answer
 * `rejected` with `ATTRIBUTION_CLAIM_CATEGORY_ONLY`. `sunset` is a category.
 * *"sunset margin at minute 1064, binding by 14 minutes, against a permit close
 * at 1200 with 150 minutes of slack"* is an instance.
 *
 * @module attribution/claims
 */

import { AVAILABILITY_CONSTRAINT } from '../availability/reasonCodes.js';
import { summariseComputed } from '../ruleEngine/engine.js';
import { RULE_IDENTIFIER_KIND } from '../ruleEngine/reasonCodes.js';
import { registryConstraintIdsFor } from '../resolve/errors.js';

import {
  ATTRIBUTION_CODES_BY_CONSTRAINT_KIND,
  ATTRIBUTION_SEVERITY,
  ATTRIBUTION_SOURCE,
  ATTRIBUTION_SOURCE_ORDER,
} from './reasonCodes.js';

/** Detail keys that are identifiers or provenance rather than computed values. */
const IDENTIFIER_KEYS = new Set([
  'constraintId',
  'constraintIds',
  'constraintType',
  'severityBy',
  'baseSeverity',
  'code',
  'codes',
]);

/**
 * Every numeric detail of a record, which is what "the computed values" means.
 *
 * @param {Record<string, unknown>} details
 * @returns {Record<string, number>}
 */
export function numbersIn(details) {
  /** @type {Record<string, number>} */
  const numbers = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (IDENTIFIER_KEYS.has(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    numbers[key] = value;
  }
  return numbers;
}

/**
 * Build one claim, with every field defaulted the same way.
 *
 * @param {Partial<import('./types.js').ConstraintClaim> & { source: string, kind: string }} spec
 * @returns {import('./types.js').ConstraintClaim}
 */
export function makeClaim(spec) {
  const computed = spec.computed ?? {};
  const codes = [...new Set(spec.codes ?? (spec.code ? [spec.code] : []))].sort();
  const constraintIds = [...new Set(spec.constraintIds ?? [])].sort();
  return {
    source: spec.source,
    kind: spec.kind,
    instanceId: spec.instanceId ?? null,
    constraintId: spec.constraintId ?? constraintIds[0] ?? null,
    constraintIds,
    code: spec.code ?? codes[0] ?? null,
    codes,
    severity: spec.severity ?? ATTRIBUTION_SEVERITY.INFO,
    binding: spec.binding ?? false,
    limitMinutes: spec.limitMinutes ?? null,
    slackMinutes: spec.slackMinutes ?? null,
    computed,
    summary: summariseComputed(computed),
    detail: spec.detail ?? '',
    entities: spec.entities ?? [],
  };
}

/**
 * Does this claim name a specific constraint instance and say something
 * computed about it?
 *
 * Two halves, and both are needed. An instance with no values is *"the permit
 * record"*; values with no instance are *"60 minutes, somewhere"*. A reason code
 * counts as something computed because it is machine-readable and specific to
 * the record it was raised about — a permit blackout has no minutes to report
 * and inventing one would be worse than saying `PERMIT_BLACKOUT`.
 *
 * @param {import('./types.js').ConstraintClaim} claim
 * @returns {boolean}
 */
export function isSpecificClaim(claim) {
  const namesInstance = Boolean(claim.instanceId) || Boolean(claim.constraintId);
  const saysSomething = Object.keys(claim.computed).length > 0 || claim.codes.length > 0;
  return namesInstance && saysSomething;
}

/**
 * The registry constraints that govern a whole constraint *kind*.
 *
 * @param {Object} registry
 * @param {string} kind - an `AVAILABILITY_CONSTRAINT` value
 * @returns {string[]}
 */
function constraintIdsForKind(registry, kind) {
  return registryConstraintIdsFor(registry, ATTRIBUTION_CODES_BY_CONSTRAINT_KIND[kind] ?? []);
}

/**
 * The entity list for something standing on a surface on a date.
 *
 * Ids only, never labels: a violation that names `Select Game 7` as a team is
 * the phantom incident 4's second checker reported.
 *
 * @param {{ gameId?: string|null, surfaceId?: string|null, venueId?: string|null, date?: string|null }} where
 * @param {ReadonlyArray<string>} [counterpartGameIds]
 * @returns {Array<{ kind: string, id: string }>}
 */
export function entitiesOf(where, counterpartGameIds = []) {
  /** @type {Array<{ kind: string, id: string }>} */
  const entities = [];
  if (where.gameId) entities.push({ kind: RULE_IDENTIFIER_KIND.GAME, id: where.gameId });
  if (where.surfaceId) entities.push({ kind: RULE_IDENTIFIER_KIND.SURFACE, id: where.surfaceId });
  if (where.venueId) entities.push({ kind: RULE_IDENTIFIER_KIND.VENUE, id: where.venueId });
  if (where.date) entities.push({ kind: RULE_IDENTIFIER_KIND.DATE, id: where.date });
  for (const id of [...new Set(counterpartGameIds)].sort()) {
    entities.push({ kind: RULE_IDENTIFIER_KIND.GAME, id });
  }
  return entities;
}

/**
 * Sort findings into the constraint kind each one is about.
 *
 * The grouping lives here, in one place, because two callers need to agree
 * exactly: the claim builder, which attaches a finding to the bound it belongs
 * to, and the caller, which must give every finding that belongs to *no* bound a
 * claim of its own. A finding that fell between the two would be a blocking
 * violation nothing reported.
 *
 * @param {ReadonlyArray<import('./types.js').AttributionFinding>} findings
 * @returns {{ byKind: Record<string, import('./types.js').AttributionFinding[]>, ungrouped: import('./types.js').AttributionFinding[] }}
 */
export function groupFindingsByConstraintKind(findings) {
  /** @type {Record<string, import('./types.js').AttributionFinding[]>} */
  const byKind = {};
  /** @type {import('./types.js').AttributionFinding[]} */
  const ungrouped = [];
  for (const finding of findings) {
    let placed = false;
    for (const [kind, codes] of Object.entries(ATTRIBUTION_CODES_BY_CONSTRAINT_KIND)) {
      if (!codes.includes(finding.code)) continue;
      if (!byKind[kind]) byKind[kind] = [];
      byKind[kind].push(finding);
      placed = true;
      break;
    }
    if (!placed) ungrouped.push(finding);
  }
  return { byKind, ungrouped };
}

/**
 * One of the four edges, as a claim.
 *
 * The constraint arrives already judged and already ordered by
 * `availability/kickoff.js`; `findings` are the ones that spoke about this same
 * kind, so a broken bound is one claim carrying its own violation rather than a
 * bound and a violation reported as two unrelated things.
 *
 * @param {import('../availability/types.js').AvailabilityConstraint} constraint
 * @param {{ registry: Object, gameId: string|null, surfaceId: string, venueId: string|null, date: string }} ctx
 * @param {ReadonlyArray<import('./types.js').AttributionFinding>} findings - already re-severitied
 * @returns {import('./types.js').ConstraintClaim}
 */
export function claimFromAvailabilityConstraint(constraint, ctx, findings) {
  const detail = /** @type {Record<string, unknown>} */ (constraint.detail ?? {});
  const computed = {
    ...numbersIn(detail),
    ...(constraint.limitMinutes === null ? {} : { limitMinutes: constraint.limitMinutes }),
    ...(constraint.latestKickoffMinutes === null
      ? {}
      : { latestKickoffMinutes: constraint.latestKickoffMinutes }),
    ...(constraint.slackMinutes === null ? {} : { slackMinutes: constraint.slackMinutes }),
  };
  const codesOfKind = new Set(ATTRIBUTION_CODES_BY_CONSTRAINT_KIND[constraint.kind] ?? []);
  const spoke = findings.filter((finding) => codesOfKind.has(finding.code));
  const worst =
    spoke.find((finding) => finding.severity === ATTRIBUTION_SEVERITY.BLOCKING) ??
    spoke.find((finding) => finding.severity === ATTRIBUTION_SEVERITY.COMPROMISE) ??
    null;
  const counterparts = /** @type {string[]} */ (
    Array.isArray(detail.boundByBookingIds) ? detail.boundByBookingIds : []
  );

  return makeClaim({
    source: ATTRIBUTION_SOURCE.AVAILABILITY,
    kind: constraint.kind,
    instanceId: constraint.source,
    constraintIds: constraintIdsForKind(ctx.registry, constraint.kind),
    codes: spoke.map((finding) => finding.code),
    severity: worst ? worst.severity : ATTRIBUTION_SEVERITY.INFO,
    binding:
      constraint.binding === true ||
      (worst !== null && worst.severity === ATTRIBUTION_SEVERITY.BLOCKING),
    limitMinutes: constraint.limitMinutes,
    slackMinutes: constraint.slackMinutes,
    computed,
    detail: worst ? worst.message : boundSentence(constraint),
    entities: entitiesOf(
      { gameId: ctx.gameId, surfaceId: ctx.surfaceId, venueId: ctx.venueId, date: ctx.date },
      counterparts
    ),
  });
}

/**
 * The sentence for a bound nobody has broken.
 *
 * Written from the constraint's own numbers rather than from a template per
 * kind: the kind, the limit and the slack are the whole content, and a
 * per-kind sentence here would be a second vocabulary to keep in step with
 * `availability/reasonCodes.js`.
 *
 * @param {import('../availability/types.js').AvailabilityConstraint} constraint
 * @returns {string}
 */
function boundSentence(constraint) {
  const source = constraint.source === null ? '' : ` (${constraint.source})`;
  if (constraint.limitMinutes === null) {
    return `the ${constraint.kind} bound${source} applies here and states no limit at all`;
  }
  const slack =
    constraint.slackMinutes === null
      ? 'and the slack against it is unknown'
      : `with ${constraint.slackMinutes} min of slack`;
  return `the ${constraint.kind} bound${source} is minute ${constraint.limitMinutes}, ${slack}`;
}

/**
 * A finding that belongs to no one of the four edges — field size, lining,
 * equipment, an undeclared permit — as a claim in its own right.
 *
 * @param {import('./types.js').AttributionFinding} finding
 * @param {{ registry: Object, source: string, gameId: string|null, surfaceId: string|null, venueId: string|null, date: string|null }} ctx
 * @returns {import('./types.js').ConstraintClaim}
 */
export function claimFromFinding(finding, ctx) {
  const details = /** @type {Record<string, unknown>} */ (finding.details ?? {});
  // Whatever identifies the record the finding is about, most specific first.
  // `format` is in the list because a timing row that does not exist is still a
  // named thing — "the format Scrimmage has no timing row" is an instance, and
  // the alternative is a claim this module refuses as a category label.
  const instanceId = /** @type {string|null} */ (
    [
      details.permitId,
      details.recordId,
      details.bookingId,
      details.otherBookingId,
      details.transitionId,
      details.waiverId,
      details.surfaceId,
      details.venueId,
      details.format,
      details.teamId,
      details.personId,
      details.date,
    ].find((value) => typeof value === 'string' && value.length > 0) ?? null
  );
  return makeClaim({
    source: ctx.source,
    kind: finding.code,
    instanceId,
    constraintIds: registryConstraintIdsFor(ctx.registry, [finding.code]),
    codes: [finding.code],
    severity: finding.severity,
    binding: finding.severity === ATTRIBUTION_SEVERITY.BLOCKING,
    computed: numbersIn(details),
    detail: finding.message,
    entities: entitiesOf({
      gameId: ctx.gameId,
      surfaceId:
        ctx.surfaceId ?? (typeof details.surfaceId === 'string' ? details.surfaceId : null),
      venueId: ctx.venueId,
      date: ctx.date,
    }),
  });
}

/**
 * One structured `RuleViolation` as a claim.
 *
 * Everything on it — the constraint ids, the computed values, the rendered
 * summary, the entities, whether a waiver applies — was assembled by
 * `runRuleEngine()`. This is a rename, not a derivation.
 *
 * @param {Object} violation - a `RuleViolation`
 * @returns {import('./types.js').ConstraintClaim}
 */
export function claimFromViolation(violation) {
  const computed = /** @type {Record<string, number>} */ (violation.computed ?? {});
  const slack =
    typeof computed.shortfallMinutes === 'number'
      ? -computed.shortfallMinutes
      : typeof computed.slackMinutes === 'number'
        ? computed.slackMinutes
        : null;
  return makeClaim({
    source: ATTRIBUTION_SOURCE.RULE_ENGINE,
    kind: violation.code,
    instanceId: violation.subjectId ?? null,
    constraintId: violation.constraintId ?? null,
    constraintIds: violation.constraintIds ?? [],
    codes: [violation.code],
    severity: violation.severity,
    binding: violation.severity === ATTRIBUTION_SEVERITY.BLOCKING,
    slackMinutes: slack,
    computed,
    detail: violation.message,
    entities: violation.entities ?? [],
  });
}

/**
 * One coach-travel transition as a claim.
 *
 * The transition is `waivers/coachTravel.js`'s record and carries the gap, the
 * minimum, the policy it was judged under and the constraint record that set it.
 * The counterpart game and team come off the two commitments the transition
 * already holds — which is what turns *"a conflict"* into *"the other team's
 * game, ten minutes earlier, at a different site"*.
 *
 * @param {Object} transition - one entry of `evaluateCoachTravel().transitions`
 * @param {import('./types.js').AttributionFinding} finding - one of its findings
 * @returns {import('./types.js').ConstraintClaim}
 */
export function claimFromTravelTransition(transition, finding) {
  const details = /** @type {Record<string, unknown>} */ (finding.details ?? {});
  const computed = {
    ...numbersIn(details),
    ...(typeof transition.gapMinutes === 'number' ? { gapMinutes: transition.gapMinutes } : {}),
    ...(typeof transition.minimumGapMinutes === 'number'
      ? { minimumGapMinutes: transition.minimumGapMinutes }
      : {}),
    fromStartMinutes: transition.from.startMinutes,
    toStartMinutes: transition.to.startMinutes,
  };
  // The shortfall is the evaluator's own number, carried on the finding it
  // raised; negating it is a sign convention, not a second subtraction. Two
  // commitments that overlap have no shortfall against a floor — no floor makes
  // a person able to be in two places at once — so their slack is the overlap
  // itself, which the evaluator reports as a negative gap.
  const slack =
    typeof details.shortfallMinutes === 'number'
      ? -details.shortfallMinutes
      : typeof transition.gapMinutes === 'number' && transition.gapMinutes < 0
        ? transition.gapMinutes
        : null;

  /** @type {Array<{ kind: string, id: string }>} */
  const entities = [{ kind: RULE_IDENTIFIER_KIND.PERSON, id: transition.personId }];
  entities.push({ kind: RULE_IDENTIFIER_KIND.DATE, id: transition.date });
  for (const commitment of [transition.from, transition.to]) {
    if (commitment.teamId) {
      entities.push({ kind: RULE_IDENTIFIER_KIND.TEAM, id: commitment.teamId });
    }
    if (commitment.gameId) {
      entities.push({ kind: RULE_IDENTIFIER_KIND.GAME, id: commitment.gameId });
    }
    entities.push({ kind: RULE_IDENTIFIER_KIND.VENUE, id: commitment.venueId });
  }

  return makeClaim({
    source: ATTRIBUTION_SOURCE.COACH_TRAVEL,
    kind: finding.code,
    instanceId: transition.id,
    constraintIds: transition.constraintId ? [transition.constraintId] : [],
    codes: [finding.code],
    severity: finding.severity,
    binding: finding.severity !== ATTRIBUTION_SEVERITY.INFO,
    slackMinutes: slack,
    computed,
    detail: finding.message,
    entities,
  });
}

/**
 * The roster's answer to *"could anybody else have covered?"*, as a claim.
 *
 * `people/roster.js` decides it; this carries it. A travel conflict on a team
 * with two coaches and one on a team with one are different problems, and an
 * attribution that cannot tell them apart sends somebody to argue with the wrong
 * schedule.
 *
 * @param {import('./types.js').AttributionFinding} finding - from `soleCoachRiskRegister()`
 * @param {{ teamId: string|null, personId: string|null }} ctx
 * @returns {import('./types.js').ConstraintClaim}
 */
export function claimFromRosterFinding(finding, ctx) {
  const details = /** @type {Record<string, unknown>} */ (finding.details ?? {});
  // The register names the other teams two different ways depending on which of
  // its two findings this is: `alsoCoaches` on a sole-coached team, `teamIds` on
  // a person who is the only coach of several. Both are read, neither is
  // required.
  const otherTeamIds = /** @type {string[]} */ (
    Array.isArray(details.alsoCoaches)
      ? details.alsoCoaches
      : Array.isArray(details.teamIds)
        ? details.teamIds
        : []
  );
  /** @type {Array<{ kind: string, id: string }>} */
  const entities = [];
  if (ctx.personId) entities.push({ kind: RULE_IDENTIFIER_KIND.PERSON, id: ctx.personId });
  if (ctx.teamId) entities.push({ kind: RULE_IDENTIFIER_KIND.TEAM, id: ctx.teamId });
  for (const teamId of otherTeamIds) {
    entities.push({ kind: RULE_IDENTIFIER_KIND.TEAM, id: teamId });
  }
  return makeClaim({
    source: ATTRIBUTION_SOURCE.ROSTER,
    kind: finding.code,
    instanceId: ctx.teamId ?? ctx.personId,
    codes: [finding.code],
    severity: finding.severity,
    binding: false,
    computed: {
      ...numbersIn(details),
      // How many teams this person is the only coach of, counting this one.
      coversTeams: otherTeamIds.length + 1,
    },
    detail: finding.message,
    entities,
  });
}

/**
 * The booking that set a warm-up boundary, as a claim.
 *
 * `timing/warmup.js` answers *"what kickoff yields a full warm-up?"* and reports
 * which booking bounded it and on which surface. Incident 8's whole point is
 * that the surface is usually **not** the one being played on, so the claim
 * carries both.
 *
 * @param {Object} result - an `earliestKickoffWithWarmup()` result
 * @param {{ registry: Object, surfaceId: string, date: string }} ctx
 * @returns {import('./types.js').ConstraintClaim|null}
 */
export function claimFromWarmupBound(result, ctx) {
  if (result.boundBy === null) return null;
  const bound = result.boundBy;
  return makeClaim({
    source: ATTRIBUTION_SOURCE.WARMUP,
    kind: 'warmup-occupancy',
    instanceId: bound.bookingIds[0] ?? null,
    constraintIds: constraintIdsForKind(ctx.registry, AVAILABILITY_CONSTRAINT.OCCUPANCY),
    severity: ATTRIBUTION_SEVERITY.INFO,
    binding: true,
    limitMinutes: bound.endMinutes,
    slackMinutes: 0,
    computed: {
      warmupStartMinutes: /** @type {number} */ (result.warmupStartMinutes),
      warmupMinutes: /** @type {number} */ (result.warmupMinutes),
      kickoffMinutes: /** @type {number} */ (result.kickoffMinutes),
      boundEndMinutes: bound.endMinutes,
    },
    detail: `the warm-up may not start before minute ${bound.endMinutes}, when ${bound.bookingIds.join(', ')} clears ${bound.surfaceIds.join(', ')}${
      bound.sameSurfaceOnly ? '' : ' — ground that overlaps this pitch rather than the pitch itself'
    }`,
    entities: entitiesOf({ surfaceId: ctx.surfaceId, date: ctx.date }, bound.bookingIds),
  });
}

/**
 * Where a claim sits in the tightness order.
 *
 * A claim whose owner reported a slack is ranked by it, tightest first. One
 * whose owner could **not** measure a slack cannot be ranked by tightness at all
 * — a bound nobody could measure is not a bound anybody can compare — so it is
 * reported after those that can be, blocking ones first among them.
 *
 * @param {import('./types.js').ConstraintClaim} claim
 * @returns {[number, number, number, string, string]}
 */
function tightnessKey(claim) {
  const severityRank =
    claim.severity === ATTRIBUTION_SEVERITY.BLOCKING
      ? 0
      : claim.severity === ATTRIBUTION_SEVERITY.COMPROMISE
        ? 1
        : 2;
  const sourceRank = ATTRIBUTION_SOURCE_ORDER.indexOf(claim.source);
  return [
    claim.slackMinutes === null ? 1 : 0,
    claim.slackMinutes === null ? severityRank : claim.slackMinutes,
    sourceRank < 0 ? ATTRIBUTION_SOURCE_ORDER.length : sourceRank,
    claim.kind,
    claim.instanceId ?? '',
  ];
}

/**
 * Interleave claims from several sources, tightest first, **without disturbing
 * any source's own ordering**.
 *
 * This is the only ordering decision this module makes, and it is deliberately
 * the smallest one available. Each group arrives already ordered by whoever owns
 * it — the four availability edges arrive in `orderByTightness()`'s order, and
 * re-sorting them here would be a second answer to the question that function
 * exists to answer. So the groups are *merged*: the comparison only ever runs
 * between the heads of two different groups, and two claims from one group can
 * never swap places.
 *
 * @param {ReadonlyArray<ReadonlyArray<import('./types.js').ConstraintClaim>>} groups
 * @returns {import('./types.js').ConstraintClaim[]}
 */
export function mergeClaimsByTightness(groups) {
  const queues = groups.map((group) => [...group]).filter((group) => group.length > 0);
  /** @type {import('./types.js').ConstraintClaim[]} */
  const out = [];

  while (queues.length > 0) {
    let pick = 0;
    for (let index = 1; index < queues.length; index += 1) {
      if (compareKeys(tightnessKey(queues[index][0]), tightnessKey(queues[pick][0])) < 0) {
        pick = index;
      }
    }
    out.push(/** @type {import('./types.js').ConstraintClaim} */ (queues[pick].shift()));
    if (queues[pick].length === 0) queues.splice(pick, 1);
  }

  return out;
}

/**
 * Lexicographic comparison of two tightness keys.
 *
 * @param {ReadonlyArray<number|string>} a
 * @param {ReadonlyArray<number|string>} b
 * @returns {number}
 */
function compareKeys(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
    return String(left).localeCompare(String(right));
  }
  return 0;
}
