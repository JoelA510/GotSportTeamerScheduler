/**
 * "What would change if this went back to being a preference?"
 *
 * The prompt asks for two different things and it is easy to deliver only the
 * first: the registry must *support* a hardness change, and it must be able to
 * *answer a question about* one without performing it. `retypeConstraint()` is
 * the edit. This module is the query.
 *
 * The answer has three layers, deepest last:
 *
 * 1. **Severity deltas** — which reason codes would change severity. Pure
 *    registry arithmetic; needs nothing but the registry.
 * 2. **Finding deltas** — given findings from a real evaluation, how many of
 *    them carry each affected code, and what their severity becomes.
 * 3. **Status deltas** — given those findings grouped by subject (a game, a
 *    candidate placement), which subjects change verdict. This is the layer that
 *    turns "adjacency would be advisory" into "these four games become legal".
 *
 * Layer 3 is where the honest failure mode lives, and it is incident 4's shape:
 * a projection handed evaluations that mention none of the affected codes will
 * report an empty delta that looks like a confident "nothing would change". That
 * emits `CONSTRAINT_PROJECTION_VACUOUS` at `compromise` instead.
 *
 * @module constraints/whatIf
 */

import { baseSeverityOf } from './baseSeverity.js';
import {
  CONSTRAINT_REASON,
  CONSTRAINT_TYPE,
  createConstraintMeta,
  deriveConstraintStatus,
  makeConstraintFinding,
  mergeConstraintMeta,
} from './reasonCodes.js';
import { requireConstraint, retypeConstraint } from './registry.js';
import { effectiveSeverityTable, severityUnder } from './severity.js';

/** The note stamped on a projected registry's history entry. */
export const PROJECTION_NOTE =
  'projected by whatIfConstraintType(); this registry answers a question and was never adopted';

/** The author stamped on a projected registry's history entry. */
export const PROJECTION_AUTHOR = 'constraint-registry-projection';

/**
 * The default magnitude given to a projected `soft` or `preference` record.
 *
 * A weight is required by the schema and nobody has chosen one for a hypothesis,
 * so `1` is used and named here rather than buried. It does not affect any
 * result this module reports: severities come from the *type*, not the weight.
 */
export const PROJECTION_DEFAULT_WEIGHT = 1;

/**
 * Project a hardness change and report the delta.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} constraintId
 * @param {string} proposedType - a `CONSTRAINT_TYPE` value
 * @param {{ context?: import('./types.js').ScopeContext, evaluations?: ReadonlyArray<{ id: string, findings: ReadonlyArray<import('./types.js').ConstraintFinding> }>, weight?: number|null }} [options]
 * @returns {import('./types.js').ConstraintTypeProjection}
 */
export function whatIfConstraintType(registry, constraintId, proposedType, options = {}) {
  const record = requireConstraint(registry, constraintId);
  const meta = createConstraintMeta();
  /** @type {import('./types.js').ConstraintFinding[]} */
  const findings = [];
  const context = options.context ?? {};

  const changed = record.type !== proposedType;
  if (!changed) {
    findings.push(
      makeConstraintFinding(
        CONSTRAINT_REASON.CONSTRAINT_PROJECTION_NO_OP,
        `constraint "${constraintId}" is already "${proposedType}", so the projection changes nothing`,
        { constraintId, currentType: record.type, proposedType }
      )
    );
  }

  const weight =
    options.weight !== undefined
      ? options.weight
      : proposedType === CONSTRAINT_TYPE.HARD
        ? null
        : (record.weight ?? PROJECTION_DEFAULT_WEIGHT);

  const projectedRegistry = changed
    ? retypeConstraint(registry, constraintId, {
        type: proposedType,
        by: PROJECTION_AUTHOR,
        at: null,
        note: PROJECTION_NOTE,
        weight,
      })
    : registry;

  const before = effectiveSeverityTable(registry, context);
  const after = effectiveSeverityTable(projectedRegistry, context);
  mergeConstraintMeta(meta, before.meta);

  /** @type {Array<{ code: string, from: string, to: string }>} */
  const severityDeltas = [];
  for (const code of record.reasonCodes) {
    const from = severityUnder(code, before);
    const to = severityUnder(code, after);
    if (from !== to) severityDeltas.push({ code, from, to });
  }
  severityDeltas.sort((a, b) => a.code.localeCompare(b.code));
  const affected = new Set(severityDeltas.map((delta) => delta.code));

  /** @type {Array<{ code: string, from: string, to: string, findingCount: number }>} */
  const findingDeltas = [];
  /** @type {Array<{ id: string, statusBefore: string, statusAfter: string }>} */
  const statusDeltas = [];
  /** @type {Record<string, number>} */
  const countByCode = {};
  let matched = 0;

  if (options.evaluations) {
    for (const evaluation of options.evaluations) {
      meta.evaluationsExamined += 1;
      /** @type {import('./types.js').ConstraintFinding[]} */
      const reseverified = [];
      let touched = false;
      for (const finding of evaluation.findings) {
        meta.findingsExamined += 1;
        if (affected.has(finding.code)) {
          touched = true;
          matched += 1;
          countByCode[finding.code] = (countByCode[finding.code] ?? 0) + 1;
          reseverified.push({ ...finding, severity: severityUnder(finding.code, after) });
        } else {
          reseverified.push(finding);
        }
      }
      if (!touched) continue;
      meta.findingsReseverified += 1;
      const statusBefore = deriveConstraintStatus(evaluation.findings);
      const statusAfter = deriveConstraintStatus(reseverified);
      if (statusBefore !== statusAfter) {
        statusDeltas.push({ id: evaluation.id, statusBefore, statusAfter });
      }
    }

    for (const delta of severityDeltas) {
      findingDeltas.push({ ...delta, findingCount: countByCode[delta.code] ?? 0 });
    }

    if (matched === 0) {
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_PROJECTION_VACUOUS,
          `${options.evaluations.length} evaluation(s) were examined and none carries a finding for any code "${constraintId}" governs, so the reported delta is empty for a reason unrelated to the constraint`,
          {
            constraintId,
            evaluationCount: options.evaluations.length,
            governedCodes: [...record.reasonCodes].sort(),
          }
        )
      );
    }
  }

  statusDeltas.sort((a, b) => a.id.localeCompare(b.id));

  return {
    constraintId,
    currentType: record.type,
    proposedType,
    changed,
    projectedRegistry,
    severityDeltas,
    findingDeltas,
    statusDeltas,
    findings,
    meta,
    status: deriveConstraintStatus(findings),
  };
}

/**
 * Every reason code a constraint governs, with its base severity, its severity
 * under the registry today, and its severity under each of the three types.
 *
 * The table an operator wants when asking "what are my options here?" rather
 * than "what if I pick this one?".
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {string} constraintId
 * @param {import('./types.js').ScopeContext} [context]
 * @returns {Array<{ code: string, baseSeverity: string, current: string, hard: string, soft: string, preference: string }>}
 */
export function severityMatrixFor(registry, constraintId, context = {}) {
  const record = requireConstraint(registry, constraintId);
  const table = effectiveSeverityTable(registry, context);
  return [...record.reasonCodes].sort().map((code) => {
    const row = { code, baseSeverity: baseSeverityOf(code), current: severityUnder(code, table) };
    for (const type of Object.values(CONSTRAINT_TYPE)) {
      const projected = whatIfConstraintType(registry, constraintId, type, { context });
      row[type] = severityUnder(code, effectiveSeverityTable(projected.projectedRegistry, context));
    }
    return /** @type {{ code: string, baseSeverity: string, current: string, hard: string, soft: string, preference: string }} */ (
      row
    );
  });
}
