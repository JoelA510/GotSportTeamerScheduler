/**
 * Where the registry meets the Phase 1 severity tables.
 *
 * This is the *whole* mechanism by which hardness became data. There is no
 * branch anywhere in `facility/`, `timing/` or `availability/` that asks "is
 * adjacency hard right now?" — those modules emit a reason code and look its
 * severity up in a frozen table, and this module builds the table that a given
 * registry says should be used instead.
 *
 * The alternative — adding `if (registry.isHard('adjacency'))` at every call
 * site — was rejected in Prompt 1.1, before this module existed, and its
 * docstrings say so out loud. Honouring that is the difference between a
 * registry and a settings object.
 *
 * Two constraints claiming one code is resolved with the same precedence rule
 * as everything else: narrower scope first, then harder type, with a
 * `CONSTRAINT_SEVERITY_AMBIGUOUS` finding whenever the tie had to be broken.
 *
 * @module constraints/severity
 */

import { BASE_REASON_SEVERITY, baseSeverityOf } from './baseSeverity.js';
import {
  CONSTRAINT_REASON,
  createConstraintMeta,
  deriveConstraintStatus,
  makeConstraintFinding,
  severityForType,
  specificityOf,
  typeRankOf,
} from './reasonCodes.js';
import { ScopeContextSchema } from './schemas.js';
import { judgeApplicability, normaliseContext } from './scope.js';

/**
 * The effective severity of every reason code the registry governs, in one
 * context.
 *
 * Codes nobody governs are **absent** from `severityByCode` rather than copied
 * in at their base value: the caller is meant to fall back to the frozen table,
 * and a full copy would hide the difference between "the registry says info" and
 * "the registry says nothing".
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @param {import('./types.js').ScopeContext} [rawContext]
 * @returns {import('./types.js').EffectiveSeverityTable}
 */
export function effectiveSeverityTable(registry, rawContext = {}) {
  const context = normaliseContext(ScopeContextSchema.parse(rawContext));
  const meta = createConstraintMeta();
  /** @type {import('./types.js').ConstraintFinding[]} */
  const findings = [];
  /** @type {Record<string, string>} */
  const severityByCode = {};
  /** @type {import('./types.js').SeverityOverride[]} */
  const overrides = [];

  for (const [code, ids] of Object.entries(registry.idsByReasonCode)) {
    meta.reasonCodesGoverned += 1;
    /** @type {import('./types.js').ConstraintRecord[]} */
    const applicable = [];

    for (const id of ids) {
      const record = registry.byId[id];
      meta.constraintsConsidered += 1;
      const judged = judgeApplicability(record, context);
      meta.scopeDimensionsTested += judged.dimensionsTested;
      findings.push(...judged.findings);
      if (judged.applicability.applicable) {
        meta.constraintsApplicable += 1;
        applicable.push(record);
      } else if (!judged.applicability.inWindow) {
        meta.constraintsInactive += 1;
      } else {
        meta.constraintsOutOfScope += 1;
      }
    }

    if (applicable.length === 0) continue;

    // Narrowest scope first, then hardest type. Both are needed: a
    // venue-scoped preference must beat a global hard rule *at that venue*,
    // which is the whole point of scoping, while two global records of
    // different hardness are a genuine tie broken toward the harder one.
    const ranked = [...applicable].sort((a, b) => {
      const scopeDelta = specificityOf(b.scope.kind) - specificityOf(a.scope.kind);
      if (scopeDelta !== 0) return scopeDelta;
      const typeDelta = typeRankOf(b.type) - typeRankOf(a.type);
      if (typeDelta !== 0) return typeDelta;
      return a.id.localeCompare(b.id);
    });
    const winner = ranked[0];
    const rivals = ranked
      .slice(1)
      .filter(
        (record) =>
          specificityOf(record.scope.kind) === specificityOf(winner.scope.kind) &&
          record.type !== winner.type
      );

    if (rivals.length > 0) {
      meta.ambiguitiesReported += rivals.length;
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_SEVERITY_AMBIGUOUS,
          `reason code "${code}" is claimed by constraints of different hardness at the same specificity; the harder one ("${winner.id}", ${winner.type}) is applied`,
          {
            code,
            appliedConstraintId: winner.id,
            appliedType: winner.type,
            ambiguousWith: rivals.map((record) => record.id).sort(),
          }
        )
      );
    }

    const severity = severityForType(winner.type);
    const base = baseSeverityOf(code);
    severityByCode[code] = severity;
    const changed = severity !== base;
    overrides.push({
      code,
      baseSeverity: base,
      severity,
      constraintId: winner.id,
      constraintType: winner.type,
      changed,
    });

    if (changed) {
      meta.reasonCodesOverridden += 1;
      findings.push(
        makeConstraintFinding(
          CONSTRAINT_REASON.CONSTRAINT_SEVERITY_OVERRIDDEN,
          `constraint "${winner.id}" is ${winner.type} here, so "${code}" counts as ${severity} rather than its registered ${base}`,
          { code, constraintId: winner.id, constraintType: winner.type, from: base, to: severity }
        )
      );
    }
  }

  overrides.sort((a, b) => a.code.localeCompare(b.code));

  return {
    severityByCode,
    overrides,
    findings,
    meta,
    status: deriveConstraintStatus(findings),
  };
}

/**
 * Re-severity a list of findings through a registry's table, and re-derive the
 * status from the result.
 *
 * The original severity is kept on the finding as `details.baseSeverity`, and
 * the constraint that changed it as `details.severityBy`. A schedule that is
 * legal only because adjacency is currently a preference has to be able to say
 * so; silently rewriting the severity and dropping the provenance would make
 * that unanswerable.
 *
 * Findings are **not** dropped when demoted. An `info` overlap finding is still
 * an overlap, still visible, and still the thing an operator wants to see before
 * publishing.
 *
 * @param {ReadonlyArray<import('./types.js').ConstraintFinding>} findings
 * @param {import('./types.js').EffectiveSeverityTable} table
 * @returns {{ findings: import('./types.js').ConstraintFinding[], status: string, meta: import('./types.js').ConstraintMeta }}
 */
export function applyRegistrySeverity(findings, table) {
  const meta = createConstraintMeta();
  const out = findings.map((finding) => {
    meta.findingsExamined += 1;
    const severity = table.severityByCode[finding.code];
    if (severity === undefined || severity === finding.severity) return finding;
    meta.findingsReseverified += 1;
    return {
      ...finding,
      severity,
      details: {
        ...finding.details,
        baseSeverity: finding.severity,
        severityBy:
          table.overrides.find((override) => override.code === finding.code)?.constraintId ?? null,
      },
    };
  });
  return { findings: out, status: deriveConstraintStatus(out), meta };
}

/**
 * The severity a code has under a registry table, falling back to the frozen
 * base.
 *
 * @param {string} code
 * @param {import('./types.js').EffectiveSeverityTable} table
 * @returns {string}
 */
export function severityUnder(code, table) {
  return table.severityByCode[code] ?? baseSeverityOf(code);
}

/**
 * Which reason codes a registry governs at all, sorted. Useful as a
 * meta-assertion: a registry that governs nothing cannot change any outcome.
 *
 * @param {import('./types.js').ConstraintRegistry} registry
 * @returns {string[]}
 */
export function governedReasonCodes(registry) {
  return Object.keys(registry.idsByReasonCode).sort();
}

/**
 * Every registered reason code and its base severity, for callers that want to
 * show the whole table next to the registry's view of it.
 *
 * @returns {Readonly<Record<string, string>>}
 */
export function baseSeverityTable() {
  return BASE_REASON_SEVERITY;
}
