/**
 * The constraint registry: build it, query it, resolve it against a context,
 * and change a constraint's hardness without changing a line of solver code.
 *
 * `docs/ARCHITECTURE.md` §6.7 is the "before" this module is the "after" of:
 *
 * > Constraints are control flow. There is no table, type, or serialized form
 * > for "this rule, of this hardness, applies to this scope". The hard/soft
 * > split is implicit: `hasCoachConflict` is an unconditional `continue`,
 * > `computeConsistencyScore` is a ranking term. Capacity is hard. Priority is a
 * > sort key. Nothing in between, and nothing per-instance.
 *
 * A registry is **immutable**. `retypeConstraint()` returns a new registry with
 * the change appended to the record's history rather than mutating in place, so
 * "what would change if this went back to being a preference?" can be answered
 * by building the alternative and comparing — see `whatIf.js`.
 *
 * Phase 1 and Phase 2 are **in-memory only**. There is no SQL home for
 * constraint records yet and this work deliberately does not create one: the
 * schema belongs to the phase that has real persistence requirements, not to the
 * phase that is still settling the model.
 *
 * @module constraints/registry
 */

import { isKnownReasonCode } from './baseSeverity.js';
import {
  CONSTRAINT_ENFORCEMENT,
  CONSTRAINT_REASON,
  CONSTRAINT_SCOPE_KIND,
  CONSTRAINT_TYPE,
  createConstraintMeta,
  deriveConstraintStatus,
  makeConstraintFinding,
} from './reasonCodes.js';
import { ConstraintRegistryInputSchema, ScopeContextSchema } from './schemas.js';
import { judgeApplicability, judgeWindow, normaliseContext, pickByPrecedence } from './scope.js';

/**
 * Freeze a record and everything hanging off it.
 *
 * @param {import('./types.js').ConstraintRecord} record
 * @returns {import('./types.js').ConstraintRecord}
 */
function freezeRecord(record) {
  Object.freeze(record.scope);
  Object.freeze(record.source);
  Object.freeze(record.parameters);
  Object.freeze(record.reasonCodes);
  for (const change of record.history) Object.freeze(change);
  Object.freeze(record.history);
  return Object.freeze(record);
}

/**
 * Build a registry from plain records.
 *
 * Three things are checked loudly rather than trusted, all of them incident 4
 * ("the validator that checked nothing") in a different costume:
 *
 * - an **empty** registry is `blocking`, because a registry with nothing in it
 *   makes every "allowed" answer true for the wrong reason;
 * - a **duplicate id** is `blocking`, because the loser would vanish silently;
 * - an **unregistered reason code** is `blocking`, because a constraint that
 *   claims `OCCUPIED_SPATIAL_OVERLAPP` governs nothing at all while looking as
 *   though it governs overlap.
 *
 * @param {Object} input - see `ConstraintRegistryInputSchema`
 * @returns {import('./types.js').ConstraintRegistry}
 */
export function buildConstraintRegistry(input) {
  const parsed = ConstraintRegistryInputSchema.parse(input);
  const meta = createConstraintMeta();
  /** @type {import('./types.js').ConstraintFinding[]} */
  const findings = [];

  // Null-prototype throughout: with a plain object, a constraint whose id is
  // `constructor` reads as a duplicate of `Object` and never gets stored, and
  // `getConstraint(registry, 'toString')` answers with a function instead of
  // `null`. Ids are data, and data must not be able to reach `Object.prototype`.
  /** @type {Record<string, import('./types.js').ConstraintRecord>} */
  const byId = Object.create(null);
  /** @type {Record<string, string[]>} */
  const idsByPolicy = Object.create(null);
  /** @type {Record<string, string[]>} */
  const idsByReasonCode = Object.create(null);

  const constraints = [...parsed.constraints].sort((a, b) => a.id.localeCompare(b.id));

  for (const record of constraints) {
    meta.constraintsConsidered += 1;

    if (Object.hasOwn(byId, record.id)) {
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_ID_DUPLICATE,
          `two constraints claim the id "${record.id}"`,
          { constraintId: record.id, policy: record.policy }
        )
      );
      continue;
    }

    for (const code of record.reasonCodes) {
      if (!isKnownReasonCode(code)) {
        findings.push(
          makeConstraintFinding(
            CONSTRAINT_REASON.CONSTRAINT_REASON_CODE_UNKNOWN,
            `constraint "${record.id}" claims reason code "${code}", which no module registers`,
            { constraintId: record.id, code }
          )
        );
        continue;
      }
      if (!Object.hasOwn(idsByReasonCode, code)) idsByReasonCode[code] = [];
      idsByReasonCode[code].push(record.id);
      meta.reasonCodesGoverned += 1;
    }

    if (record.enforcement === CONSTRAINT_ENFORCEMENT.DECLARED_ONLY) {
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_DECLARED_ONLY,
          `constraint "${record.id}" is recorded and scoped, but no module consumes it yet`,
          { constraintId: record.id, policy: record.policy, type: record.type }
        )
      );
    }

    if (record.history.length > 0) {
      const last = record.history[record.history.length - 1];
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_TYPE_CHANGED,
          `constraint "${record.id}" has changed type ${record.history.length} time(s); it is "${record.type}" now and was "${record.history[0].from ?? record.history[0].to}" to begin with`,
          {
            constraintId: record.id,
            type: record.type,
            changeCount: record.history.length,
            firstType: record.history[0].from ?? record.history[0].to,
            lastChangeTo: last.to,
            lastChangeBy: last.by,
            lastChangeAt: last.at,
          }
        )
      );
    }

    byId[record.id] = freezeRecord(/** @type {import('./types.js').ConstraintRecord} */ (record));
    if (!Object.hasOwn(idsByPolicy, record.policy)) idsByPolicy[record.policy] = [];
    idsByPolicy[record.policy].push(record.id);
  }

  if (constraints.length === 0) {
    findings.push(
      makeConstraintFinding(
        CONSTRAINT_REASON.REGISTRY_EMPTY,
        'the constraint registry holds no constraints; every question asked of it would be answered by nothing',
        { name: parsed.name }
      )
    );
  }

  const kept = Object.values(byId);
  const stats = {
    constraintCount: kept.length,
    policyCount: Object.keys(idsByPolicy).length,
    hardCount: kept.filter((record) => record.type === CONSTRAINT_TYPE.HARD).length,
    softCount: kept.filter((record) => record.type === CONSTRAINT_TYPE.SOFT).length,
    preferenceCount: kept.filter((record) => record.type === CONSTRAINT_TYPE.PREFERENCE).length,
    wiredCount: kept.filter((record) => record.enforcement === CONSTRAINT_ENFORCEMENT.REASON_CODES)
      .length,
    declaredOnlyCount: kept.filter(
      (record) => record.enforcement === CONSTRAINT_ENFORCEMENT.DECLARED_ONLY
    ).length,
    scopedCount: kept.filter((record) => record.scope.kind !== CONSTRAINT_SCOPE_KIND.GLOBAL).length,
    governedReasonCodeCount: Object.keys(idsByReasonCode).length,
    retypedCount: kept.filter((record) => record.history.length > 0).length,
    waivableCount: kept.filter((record) => record.waivable).length,
    datedSourceCount: kept.filter((record) => record.source.setAt !== null).length,
  };

  for (const ids of Object.values(idsByPolicy)) ids.sort();
  for (const ids of Object.values(idsByReasonCode)) ids.sort();

  /** @type {import('./types.js').ConstraintRegistry} */
  const registry = {
    name: parsed.name,
    source: parsed.source,
    constraints: /** @type {import('./types.js').ConstraintRecord[]} */ (Object.freeze(kept)),
    constraintIds: /** @type {string[]} */ (Object.freeze(kept.map((record) => record.id))),
    byId: Object.freeze(byId),
    idsByPolicy: Object.freeze(idsByPolicy),
    policies: /** @type {string[]} */ (Object.freeze(Object.keys(idsByPolicy).sort())),
    idsByReasonCode: Object.freeze(idsByReasonCode),
    status: deriveConstraintStatus(findings),
    findings: /** @type {import('./types.js').ConstraintFinding[]} */ (Object.freeze(findings)),
    meta,
    stats: Object.freeze(stats),
  };
  return Object.freeze(registry);
}

/**
 * One constraint by id, or `null`.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} id
 * @returns {import('./types.js').ConstraintRecord|null}
 */
export function getConstraint(registry, id) {
  return registry.byId[id] ?? null;
}

/**
 * One constraint by id, or a thrown error naming what is actually there.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} id
 * @returns {import('./types.js').ConstraintRecord}
 */
export function requireConstraint(registry, id) {
  const record = getConstraint(registry, id);
  if (!record) {
    throw new Error(
      `constraints: no constraint "${id}" in the registry (it holds ${registry.constraintIds.length}: ${registry.constraintIds.join(', ')})`
    );
  }
  return record;
}

/**
 * Every constraint speaking to one policy, in id order.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} policy
 * @returns {import('./types.js').ConstraintRecord[]}
 */
export function constraintsForPolicy(registry, policy) {
  return (registry.idsByPolicy[policy] ?? []).map((id) => registry.byId[id]);
}

/**
 * Every constraint that claims one reason code, in id order.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} code
 * @returns {import('./types.js').ConstraintRecord[]}
 */
export function constraintsForReasonCode(registry, code) {
  return (registry.idsByReasonCode[code] ?? []).map((id) => registry.byId[id]);
}

/**
 * Resolve one policy against one context.
 *
 * The full precedence rule lives in `scope.js`'s module docstring; this is where
 * it is applied. Note what the result is *not*: it is not a single record. A
 * policy can be governed by a hard floor and aimed at by a preference at the
 * same time, and both are returned.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} policy
 * @param {import('./types.js').ScopeContext} [rawContext]
 * @returns {import('./types.js').ResolvedPolicy}
 */
export function resolvePolicy(registry, policy, rawContext = {}) {
  const context = normaliseContext(ScopeContextSchema.parse(rawContext));
  const meta = createConstraintMeta();
  /** @type {import('./types.js').ConstraintFinding[]} */
  const findings = [];
  /** @type {import('./types.js').ConstraintApplicability[]} */
  const applicability = [];
  meta.policiesResolved = 1;

  const candidates = constraintsForPolicy(registry, policy);
  /** @type {import('./types.js').ConstraintRecord[]} */
  const applicable = [];

  for (const record of candidates) {
    meta.constraintsConsidered += 1;
    const judged = judgeApplicability(record, context);
    meta.scopeDimensionsTested += judged.dimensionsTested;
    findings.push(...judged.findings);
    applicability.push(judged.applicability);
    if (judged.applicability.applicable) {
      meta.constraintsApplicable += 1;
      applicable.push(record);
    } else if (!judged.applicability.inWindow) {
      meta.constraintsInactive += 1;
    } else {
      meta.constraintsOutOfScope += 1;
    }
  }

  /** @type {Record<string, import('./types.js').ConstraintRecord|null>} */
  const byType = {
    [CONSTRAINT_TYPE.HARD]: null,
    [CONSTRAINT_TYPE.SOFT]: null,
    [CONSTRAINT_TYPE.PREFERENCE]: null,
  };

  for (const type of Object.values(CONSTRAINT_TYPE)) {
    const tier = applicable.filter((record) => record.type === type);
    const picked = pickByPrecedence(tier);
    byType[type] = picked.winner;
    if (!picked.winner) continue;

    if (picked.ambiguousWith.length > 0) {
      meta.ambiguitiesReported += picked.ambiguousWith.length;
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_PRECEDENCE_AMBIGUOUS,
          `policy "${policy}" has ${picked.ambiguousWith.length + 1} ${type} constraints at the same specificity that disagree; the more restrictive ("${picked.winner.id}") is applied`,
          {
            policy,
            type,
            appliedConstraintId: picked.winner.id,
            ambiguousWith: picked.ambiguousWith,
            scopeKind: picked.winner.scope.kind,
          }
        )
      );
    }

    const narrowed = tier.filter(
      (record) => record.id !== picked.winner.id && record.scope.kind !== picked.winner.scope.kind
    );
    if (narrowed.length > 0) {
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_SCOPE_NARROWER_APPLIED,
          `policy "${policy}" is governed here by the ${picked.winner.scope.kind}-scoped "${picked.winner.id}", which beat ${narrowed.map((record) => `"${record.id}" (${record.scope.kind})`).join(', ')}`,
          {
            policy,
            type,
            appliedConstraintId: picked.winner.id,
            appliedScopeKind: picked.winner.scope.kind,
            supersededConstraintIds: narrowed.map((record) => record.id).sort(),
          }
        )
      );
    }
  }

  if (candidates.length === 0 || applicable.length === 0) {
    findings.push(
      makeConstraintFinding(
        CONSTRAINT_REASON.CONSTRAINT_POLICY_UNGOVERNED,
        candidates.length === 0
          ? `no constraint in the registry speaks to policy "${policy}"`
          : `every constraint for policy "${policy}" was ruled out here, so nothing governs it`,
        { policy, candidateCount: candidates.length, applicableCount: applicable.length }
      )
    );
  }

  const effective =
    byType[CONSTRAINT_TYPE.HARD] ??
    byType[CONSTRAINT_TYPE.SOFT] ??
    byType[CONSTRAINT_TYPE.PREFERENCE];

  return {
    policy,
    effective,
    byType,
    applicability,
    findings,
    meta,
    status: deriveConstraintStatus(findings),
  };
}

/**
 * Resolve **every** policy in the registry against one context.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {import('./types.js').ScopeContext} [context]
 * @returns {{ policies: Record<string, import('./types.js').ResolvedPolicy>, findings: import('./types.js').ConstraintFinding[], meta: import('./types.js').ConstraintMeta, status: string }}
 */
export function resolveConstraints(registry, context = {}) {
  const meta = createConstraintMeta();
  /** @type {import('./types.js').ConstraintFinding[]} */
  const findings = [];
  /** @type {Record<string, import('./types.js').ResolvedPolicy>} */
  const policies = {};

  for (const policy of registry.policies) {
    const resolved = resolvePolicy(registry, policy, context);
    policies[policy] = resolved;
    findings.push(...resolved.findings);
    for (const key of Object.keys(meta)) meta[key] += resolved.meta[key] ?? 0;
  }

  return { policies, findings, meta, status: deriveConstraintStatus(findings) };
}

/**
 * Every constraint live on a date, and every one that is not.
 *
 * The inactive list is returned rather than filtered away because *"a constraint
 * outside its window must be reported as inactive rather than silently
 * skipped"*: an operator who cannot see that the travel waiver expired last
 * month cannot understand why the schedule changed.
 *
 * Only the **window** is judged. This entry point asks a purely temporal
 * question and names no venue, division or team; judging scope here would
 * answer it with a compromise-level `CONSTRAINT_SCOPE_UNJUDGED` for every
 * scoped record, about a narrowing nobody asked about. `resolvePolicy()` is
 * where a scoped question is asked.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} date - ISO `YYYY-MM-DD`
 * @returns {{ active: import('./types.js').ConstraintRecord[], inactive: Array<{ constraintId: string, code: string }>, findings: import('./types.js').ConstraintFinding[], meta: import('./types.js').ConstraintMeta }}
 */
export function activeConstraintsOn(registry, date) {
  const meta = createConstraintMeta();
  /** @type {import('./types.js').ConstraintRecord[]} */
  const active = [];
  /** @type {Array<{ constraintId: string, code: string }>} */
  const inactive = [];
  /** @type {import('./types.js').ConstraintFinding[]} */
  const findings = [];

  for (const record of registry.constraints) {
    meta.constraintsConsidered += 1;
    // The **window** only. "Which constraints are live on this date?" names no
    // venue, division or team and is not asking about any, so judging scope
    // here emitted a compromise-level `CONSTRAINT_SCOPE_UNJUDGED` for every
    // scoped record and made a clean temporal answer read as compromised.
    const judged = judgeWindow(record, date);
    if (judged.code) {
      findings.push(
        makeConstraintFinding(
          judged.code,
          judged.code === CONSTRAINT_REASON.CONSTRAINT_WINDOW_UNJUDGED
            ? `constraint "${record.id}" has an effective window and no date was supplied, so whether it is live cannot be decided`
            : `constraint "${record.id}" is outside its effective window on ${date}`,
          {
            constraintId: record.id,
            policy: record.policy,
            date,
            effectiveFrom: record.effectiveFrom,
            effectiveTo: record.effectiveTo,
          }
        )
      );
    }
    if (judged.active) {
      meta.constraintsApplicable += 1;
      active.push(record);
    } else {
      meta.constraintsInactive += 1;
      inactive.push({
        constraintId: record.id,
        code: /** @type {string} */ (judged.code),
      });
    }
  }

  return { active, inactive, findings, meta };
}

/**
 * Change a constraint's hardness, returning a **new** registry.
 *
 * This is incident 3's transition as an operation rather than a rewrite: field
 * adjacency arrived as a preference and was later hardened to inviolable, and
 * the system has to survive that without anybody editing `occupancy.js`. The
 * change is appended to the record's history, so the next reader can see that
 * the rule has not always been what it is now.
 *
 * `weight` is required when moving to `soft` or `preference` and forbidden when
 * moving to `hard` — the schema enforces it, and this function refuses rather
 * than inventing a magnitude nobody chose.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} id
 * @param {{ type: string, by: string, at?: string|null, note: string, weight?: number|null }} change
 * @returns {import('./types.js').ConstraintRegistry}
 */
export function retypeConstraint(registry, id, change) {
  const record = requireConstraint(registry, id);
  const nextWeight =
    change.weight !== undefined
      ? change.weight
      : change.type === CONSTRAINT_TYPE.HARD
        ? null
        : record.weight;

  if (change.type !== CONSTRAINT_TYPE.HARD && nextWeight === null) {
    throw new Error(
      `constraints: retyping "${id}" to "${change.type}" needs a weight (the cost of violating it, or the pull of the preference); none was supplied and the record carries none`
    );
  }

  const updated = {
    ...record,
    type: change.type,
    weight: nextWeight,
    history: [
      ...record.history,
      {
        from: record.type,
        to: change.type,
        at: change.at ?? null,
        by: change.by,
        note: change.note,
      },
    ],
  };

  return buildConstraintRegistry({
    name: registry.name,
    source: registry.source,
    constraints: registry.constraints.map((existing) => (existing.id === id ? updated : existing)),
  });
}
