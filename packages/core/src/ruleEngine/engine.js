/**
 * The standing rule engine: run the whole constraint registry against a whole
 * schedule and return structured violations.
 *
 * > *Build a standing rule engine that runs the full constraint registry
 * > against a schedule and returns structured violations. Each violation
 * > reports: constraint id, severity, the entities involved, the computed
 * > values (e.g. "gap 50 min, minimum 60"), and whether a waiver applies.*
 *
 * ## What the engine does, in order
 *
 * 1. **Refuses a bad rule at build time.** `buildRuleEngine()` parses every
 *    definition through `RuleDefinitionSchema`, which requires a non-empty
 *    exercise expectation. A rule that promises nothing about what it examined
 *    cannot be registered, let alone run.
 * 2. **Reconciles rules against the registry.** Every constraint a rule claims
 *    must exist; every constraint the registry holds is either covered by a
 *    rule or reported `RULE_CONSTRAINT_UNENFORCED`. Ten of the fourteen
 *    season-2026 constraints are `declared-only`, and an engine that let them
 *    sit silently in a clean report would be incident 4 at the scale of the
 *    whole system.
 * 3. **Runs each rule**, catching a throw as a `blocking` `RULE_THREW` rather
 *    than letting one broken rule take the run down.
 * 4. **Judges each rule's exercise expectation** (`exercise.js`). A rule that
 *    fails is marked `exercised: false` and its findings are still reported —
 *    but the report says loudly that its numbers are unattributable.
 * 5. **Re-severities Phase 1 findings through the registry**
 *    (`constraints/severity.js`), so hardness is data rather than control flow.
 * 6. **Applies the waiver ledger** (`waivers/apply.js`) across every subject
 *    from every rule at once, and runs the dormancy scan. A waived violation is
 *    reported distinctly from a clean pass, never in place of one.
 * 7. **Builds structured violations** from what survives.
 *
 * ## Waivers integrate; they do not bypass
 *
 * `applyWaivers()` keeps a waived finding in the list, demotes `blocking` to
 * `compromise`, stamps it with the waiver id and the approver, and emits
 * `WAIVER_APPLIED` at `compromise` — which is why a waived subject can never
 * derive `allowed`. The engine adds nothing to that machinery and takes nothing
 * away; it only makes sure every rule's subjects reach it, and that the
 * `constraintIdByCode` map the applier needs is **derived from the rule
 * definitions** rather than hand-maintained. A rule that stops claiming a code
 * stops linking it, which is the correct behaviour and the one nobody has to
 * remember.
 *
 * @module ruleEngine/engine
 */

import { getConstraint } from '../constraints/registry.js';
import { CONSTRAINT_ENFORCEMENT } from '../constraints/reasonCodes.js';
import { applyRegistrySeverity, effectiveSeverityTable } from '../constraints/severity.js';
import { applyWaivers } from '../waivers/apply.js';
import { detectDormantWaivers } from '../waivers/dormancy.js';
import { deriveWaiverDisposition } from '../waivers/reasonCodes.js';

import { judgeExercise } from './exercise.js';
import {
  RULE_REASON,
  createRuleEngineMeta,
  deriveRuleStatus,
  isRuleViolation,
  makeRuleFinding,
} from './reasonCodes.js';
import { RuleEngineInputSchema, ScheduleSchema } from './schemas.js';
import { STANDING_RULES } from './rules.js';

/**
 * Build an engine from rule definitions.
 *
 * @param {{ name?: string|null, rules?: ReadonlyArray<Object> }} [input]
 * @returns {{ name: string|null, rules: import('./types.js').RuleDefinition[], ruleIds: string[], byId: Record<string, import('./types.js').RuleDefinition>, findings: import('./types.js').RuleFinding[], status: string, meta: import('./types.js').RuleEngineMeta }}
 */
export function buildRuleEngine(input = {}) {
  const parsed = RuleEngineInputSchema.parse(input);
  const meta = createRuleEngineMeta();
  /** @type {import('./types.js').RuleFinding[]} */
  const findings = [];
  /** @type {Record<string, import('./types.js').RuleDefinition>} */
  const byId = {};

  const rules = [...parsed.rules].sort((a, b) => a.id.localeCompare(b.id));
  for (const rule of rules) {
    meta.rulesRegistered += 1;
    if (byId[rule.id]) {
      findings.push(
        makeRuleFinding(RULE_REASON.RULE_ID_DUPLICATE, `two rules claim the id "${rule.id}"`, {
          ruleId: rule.id,
        })
      );
      continue;
    }
    byId[rule.id] = /** @type {import('./types.js').RuleDefinition} */ (rule);
  }

  const kept = Object.values(byId);
  if (kept.length === 0) {
    findings.push(
      makeRuleFinding(
        RULE_REASON.RULE_SET_EMPTY,
        'the rule engine holds no rules; it would answer "no violations" to every schedule ever put in front of it',
        { name: parsed.name }
      )
    );
  }

  return Object.freeze({
    name: parsed.name,
    rules: /** @type {import('./types.js').RuleDefinition[]} */ (Object.freeze(kept)),
    ruleIds: /** @type {string[]} */ (Object.freeze(kept.map((rule) => rule.id))),
    byId: Object.freeze(byId),
    findings: /** @type {import('./types.js').RuleFinding[]} */ (Object.freeze(findings)),
    status: deriveRuleStatus(findings),
    meta,
  });
}

/**
 * The engine carrying the standing rule set.
 *
 * @param {{ extraRules?: ReadonlyArray<Object> }} [options]
 * @returns {ReturnType<typeof buildRuleEngine>}
 */
export function buildStandingRuleEngine(options = {}) {
  return buildRuleEngine({
    name: 'standing',
    rules: [...STANDING_RULES, ...(options.extraRules ?? [])],
  });
}

/**
 * Which registry constraints the rules cover, and which nothing covers.
 *
 * @param {ReturnType<typeof buildRuleEngine>} engine
 * @param {import('../constraints/types.js').ConstraintRegistry} registry
 * @returns {import('./types.js').RuleCoverage}
 */
export function ruleCoverage(engine, registry) {
  /** @type {import('./types.js').RuleFinding[]} */
  const findings = [];
  /** @type {Record<string, string[]>} */
  const ruleIdsByConstraintId = {};
  /** @type {string[]} */
  const rulesEnforcingNothing = [];

  for (const rule of engine.rules) {
    if (rule.constraintIds.length === 0) {
      rulesEnforcingNothing.push(rule.id);
      findings.push(
        makeRuleFinding(
          RULE_REASON.RULE_ENFORCES_NO_CONSTRAINT,
          `rule "${rule.id}" enforces no constraint in the registry; it reports Phase 1 findings the club never wrote a rule about`,
          { ruleId: rule.id, reasonCodes: [...rule.reasonCodes].sort() }
        )
      );
      continue;
    }
    for (const constraintId of rule.constraintIds) {
      const record = getConstraint(registry, constraintId);
      if (!record) {
        findings.push(
          makeRuleFinding(
            RULE_REASON.RULE_CONSTRAINT_UNKNOWN,
            `rule "${rule.id}" claims to enforce "${constraintId}", which the registry does not hold`,
            {
              ruleId: rule.id,
              constraintId,
              registryConstraintCount: registry.constraintIds.length,
            }
          )
        );
        continue;
      }
      if (!ruleIdsByConstraintId[constraintId]) ruleIdsByConstraintId[constraintId] = [];
      ruleIdsByConstraintId[constraintId].push(rule.id);
      if (record.enforcement === CONSTRAINT_ENFORCEMENT.DECLARED_ONLY) {
        findings.push(
          makeRuleFinding(
            RULE_REASON.RULE_ENFORCES_DECLARED_ONLY,
            `rule "${rule.id}" enforces "${constraintId}", which the registry records as declared-only; the registry's field means "claims Phase 1 reason codes", and the rule engine is a second enforcement path`,
            { ruleId: rule.id, constraintId, policy: record.policy, type: record.type }
          )
        );
      }
    }
  }

  const enforcedConstraintIds = Object.keys(ruleIdsByConstraintId).sort();
  const unenforcedConstraintIds = registry.constraintIds.filter((id) => !ruleIdsByConstraintId[id]);

  for (const constraintId of unenforcedConstraintIds) {
    const record = /** @type {import('../constraints/types.js').ConstraintRecord} */ (
      getConstraint(registry, constraintId)
    );
    findings.push(
      makeRuleFinding(
        RULE_REASON.RULE_CONSTRAINT_UNENFORCED,
        `constraint "${constraintId}" (${record.type}, policy "${record.policy}") has no rule enforcing it; nothing in this run checked it, which is not the same as it being satisfied`,
        {
          constraintId,
          policy: record.policy,
          type: record.type,
          enforcement: record.enforcement,
          ruleCount: engine.ruleIds.length,
        }
      )
    );
  }

  for (const ids of Object.values(ruleIdsByConstraintId)) ids.sort();

  return {
    constraintIds: [...registry.constraintIds],
    enforcedConstraintIds,
    unenforcedConstraintIds,
    ruleIdsByConstraintId,
    rulesEnforcingNothing,
    findings,
  };
}

/**
 * The `constraintIdByCode` map `applyWaivers()` needs, derived from the rules.
 *
 * The registry answers this for every `reason-codes` constraint on its own;
 * this fills the gap for the `declared-only` ones a rule enforces — coach
 * travel, turnover, round robin — which have no reason codes of their own by
 * definition. Derived rather than spelled out, so a rule that stops claiming a
 * code stops linking it.
 *
 * @param {ReturnType<typeof buildRuleEngine>} engine
 * @param {import('../constraints/types.js').ConstraintRegistry} registry
 * @returns {Record<string, string[]>}
 */
export function constraintIdsByReasonCode(engine, registry) {
  /** @type {Record<string, Set<string>>} */
  const map = {};
  for (const rule of engine.rules) {
    for (const code of rule.reasonCodes) {
      if (!map[code]) map[code] = new Set(registry.idsByReasonCode[code] ?? []);
      // A rule may narrow a code to a subset of the constraints it enforces;
      // without that, a waiver against the inter-venue travel floor would be
      // consulted for a within-venue gap it never covered.
      const narrowed = rule.constraintIdByCode?.[code];
      for (const constraintId of narrowed ?? rule.constraintIds) {
        if (getConstraint(registry, constraintId)) map[code].add(constraintId);
      }
    }
  }
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [code, ids] of Object.entries(map)) {
    if (ids.size > 0) out[code] = [...ids].sort();
  }
  return out;
}

/**
 * Render the computed values of a violation into the one line the prompt asks
 * for — `"gap 50 min, minimum 60 min"`.
 *
 * Rendered once, here, from the finding's own numeric details. Nothing parses
 * it back: `computed` carries the same numbers as data.
 *
 * @param {Record<string, number|string|boolean|null>} computed
 * @returns {string}
 */
export function summariseComputed(computed) {
  const parts = [];
  for (const [key, value] of Object.entries(computed)) {
    if (value === null || value === undefined) continue;
    const label = key
      .replace(/Minutes$/, '')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
    const unit = key.endsWith('Minutes') ? ' min' : '';
    parts.push(`${label} ${value}${unit}`);
  }
  return parts.join(', ');
}

/**
 * The fields of a subject's own context that a constraint scope can be judged
 * against — every key `ScopeContextSchema` accepts, and nothing else. A
 * subject's `venueIds` (a coach's transition touches two) is deliberately not
 * mapped onto `venueId`: a venue-scoped record judged against a subject that
 * spans two venues is unjudged, and says so.
 *
 * @type {ReadonlyArray<string>}
 */
const SUBJECT_SCOPE_FIELDS = Object.freeze([
  'date',
  'venueId',
  'surfaceId',
  'surfaceLineage',
  'divisionLabel',
  'teamId',
  'teamIds',
  'personId',
  'personIds',
]);

/**
 * Where one subject stands, for the registry to judge scope against: the run's
 * context, narrowed by whatever the subject itself names.
 *
 * @param {import('../constraints/types.js').ScopeContext} runContext
 * @param {Record<string, unknown>} [subjectContext]
 * @returns {import('../constraints/types.js').ScopeContext}
 */
function subjectScopeContext(runContext, subjectContext = {}) {
  /** @type {Record<string, unknown>} */
  const context = { ...runContext };
  for (const field of SUBJECT_SCOPE_FIELDS) {
    const value = subjectContext[field];
    if (value !== undefined && value !== null) context[field] = value;
  }
  return /** @type {import('../constraints/types.js').ScopeContext} */ (context);
}

/** Detail keys that are computed values rather than identifiers or provenance. */
const IDENTIFIER_KEYS = new Set([
  'ruleId',
  'constraintId',
  'constraintIds',
  'constraintType',
  'subjectId',
  'waiverId',
  'waivedConstraintId',
  'waived',
  'waivedBy',
  'waivedAt',
  'severityBeforeWaiver',
  'baseSeverity',
  'severityBy',
  'code',
  'codes',
]);

/**
 * The computed values on a finding: every flat primitive detail that is not an
 * identifier, a date or provenance.
 *
 * @param {Record<string, unknown>} details
 * @returns {Record<string, number|string|boolean|null>}
 */
function computedOf(details) {
  /** @type {Record<string, number|string|boolean|null>} */
  const computed = {};
  for (const [key, value] of Object.entries(details)) {
    if (IDENTIFIER_KEYS.has(key)) continue;
    if (typeof value !== 'number') continue;
    computed[key] = value;
  }
  return computed;
}

/**
 * Turn one waived subject into structured violations.
 *
 * @param {{ id: string, findings: ReadonlyArray<import('./types.js').RuleFinding>, details?: Record<string, unknown> }} subject
 * @param {import('./types.js').RuleResult} ruleResult
 * @param {Record<string, string[]>} constraintIdByCode
 * @returns {import('./types.js').RuleViolation[]}
 */
function violationsOf(subject, ruleResult, constraintIdByCode) {
  /** @type {import('./types.js').RuleViolation[]} */
  const violations = [];
  const declaredEntities = subject.details?.entities;
  const entities = Array.isArray(declaredEntities)
    ? /** @type {Array<{ kind: string, id: string }>} */ (declaredEntities)
    : [];

  for (const finding of subject.findings) {
    if (!isRuleViolation(finding)) continue;
    // The waiver module's own provenance findings are reported through
    // `result.waivers`, not duplicated as violations of a rule.
    if (finding.code.startsWith('WAIVER_')) continue;

    const details = finding.details ?? {};
    const declared = /** @type {string|undefined} */ (details.constraintId);
    const linked = constraintIdByCode[finding.code] ?? [];
    const constraintIds = declared ? [declared] : [...linked];
    const computed = computedOf(details);

    violations.push({
      ruleId: ruleResult.ruleId,
      code: finding.code,
      severity: finding.severity,
      baseSeverity: /** @type {string} */ (
        details.severityBeforeWaiver ?? details.baseSeverity ?? finding.severity
      ),
      constraintId: constraintIds[0] ?? null,
      constraintIds,
      subjectId: subject.id,
      entities,
      computed,
      summary: summariseComputed(computed),
      message: finding.message,
      waived: details.waived === true,
      waiverId: /** @type {string|null} */ (details.waiverId ?? null),
      waivedBy: /** @type {string|null} */ (details.waivedBy ?? null),
      details,
    });
  }

  return violations;
}

/**
 * Run the engine over a schedule.
 *
 * @param {Object} rawSchedule - see `ScheduleSchema`
 * @param {{ engine?: ReturnType<typeof buildRuleEngine>, registry: import('../constraints/types.js').ConstraintRegistry, ledger?: import('../waivers/types.js').WaiverLedger|null, resources?: Record<string, unknown>, context?: import('../constraints/types.js').ScopeContext }} options
 * @returns {import('./types.js').RuleEngineResult}
 */
export function runRuleEngine(rawSchedule, options) {
  const schedule = /** @type {import('./types.js').Schedule} */ (ScheduleSchema.parse(rawSchedule));
  const engine = options.engine ?? buildStandingRuleEngine();
  const { registry, ledger = null, resources = {}, context = {} } = options;
  const meta = createRuleEngineMeta();
  /** @type {import('./types.js').RuleFinding[]} */
  const engineFindings = [...engine.findings];
  meta.rulesRegistered = engine.ruleIds.length;

  if (schedule.games.length === 0) {
    engineFindings.push(
      makeRuleFinding(
        RULE_REASON.RULE_SCHEDULE_EMPTY,
        'the schedule handed to the rule engine holds no games; every rule would pass and none of them would mean anything',
        { scheduleName: schedule.name, commitmentCount: schedule.commitments.length }
      )
    );
  }

  const coverage = ruleCoverage(engine, registry);
  engineFindings.push(...coverage.findings);
  meta.constraintsCovered = coverage.enforcedConstraintIds.length;
  meta.constraintsUnenforced = coverage.unenforcedConstraintIds.length;

  // One table per distinct scope context, not one per run. Built once for the
  // caller's context and then again wherever a subject narrows it: a table
  // computed only from a context that defaults to naming nothing can never let
  // a venue-scoped or division-scoped record decide a severity, which made the
  // registry's scoping inert for every wired constraint.
  /** @type {Map<string, import('../constraints/types.js').EffectiveSeverityTable>} */
  const severityTables = new Map();
  /**
   * @param {import('../constraints/types.js').ScopeContext} scopeContext
   * @returns {import('../constraints/types.js').EffectiveSeverityTable}
   */
  const severityTableFor = (scopeContext) => {
    const key = JSON.stringify(
      SUBJECT_SCOPE_FIELDS.map(
        (field) => /** @type {Record<string, unknown>} */ (scopeContext)[field] ?? null
      )
    );
    const cached = severityTables.get(key);
    if (cached) return cached;
    const table = effectiveSeverityTable(registry, scopeContext);
    severityTables.set(key, table);
    return table;
  };
  const severityTable = severityTableFor(subjectScopeContext(context));
  const constraintIdByCode = constraintIdsByReasonCode(engine, registry);

  /** @type {import('./types.js').RuleResult[]} */
  const results = [];
  /** @type {Array<import('../waivers/types.js').WaiverSubject>} */
  const allSubjects = [];

  for (const rule of engine.rules) {
    /** @type {import('./types.js').RuleOutput} */
    let output = { subjects: [], findings: [], counters: {}, matched: {} };
    let ran = true;
    /** @type {import('./types.js').RuleFinding[]} */
    const ruleFindings = [];

    /** @type {import('./types.js').RuleExerciseVerdict|null} */
    let judged = null;

    // The judge is inside the guard with the evaluator, because a rule that
    // returns *half* an output does not throw in its own evaluator — it throws
    // in `judgeExercise`, and a throw there took the whole run down instead of
    // costing that one rule its verdict.
    try {
      output = rule.evaluate(schedule, { registry, severityTable, resources, rule });
      meta.rulesRun += 1;
      judged = judgeExercise(rule, output, schedule);
    } catch (error) {
      ran = false;
      meta.rulesThrew += 1;
      output = { subjects: [], findings: [], counters: {}, matched: {} };
      ruleFindings.push(
        makeRuleFinding(
          RULE_REASON.RULE_THREW,
          `rule "${rule.id}" threw while evaluating: ${error instanceof Error ? error.message : String(error)}`,
          { ruleId: rule.id, error: error instanceof Error ? error.message : String(error) }
        )
      );
    }

    // A rule that threw is still judged against its own expectation, over the
    // empty output: "it examined nothing" is part of what went wrong.
    const verdict = judged ?? judgeExercise(rule, output, schedule);
    meta.exerciseChecksRun += 1;
    meta.identifiersChecked += verdict.identifiersChecked;
    if (ran && verdict.satisfied) meta.rulesExercised += 1;
    else meta.rulesUnderExercised += 1;

    // Phase 1 severities are the registry's to set (GAP-12). A rule's own
    // findings already took their severity from a constraint record's type, so
    // re-severitying is a no-op for them and decisive for the facility,
    // timing and availability codes.
    const reseverified = output.subjects.map((subject) => ({
      ...subject,
      findings: applyRegistrySeverity(
        subject.findings,
        severityTableFor(subjectScopeContext(context, subject.context))
      ).findings,
    }));
    for (const subject of reseverified) allSubjects.push(subject);

    ruleFindings.push(...verdict.findings, ...output.findings);
    const subjectFindings = reseverified.flatMap((subject) => subject.findings);
    const violationCount = subjectFindings.filter(isRuleViolation).length;

    results.push({
      ruleId: rule.id,
      title: rule.title,
      constraintIds: [...rule.constraintIds],
      ran,
      exercised: ran && verdict.satisfied,
      exercise: verdict,
      subjects: reseverified,
      findings: ruleFindings,
      subjectCount: reseverified.length,
      violationCount,
      status: deriveRuleStatus([...ruleFindings, ...subjectFindings]),
    });
  }

  meta.subjectsExamined = allSubjects.length;

  // The tables' own findings are the registry saying which record it applied
  // and which it could not judge here; discarding them threw away the
  // provenance of every severity this run reports, and its status with it. One
  // per record and code — a table per subject would otherwise repeat each of
  // them once for every subject that stands in the same place.
  /** @type {Set<string>} */
  const severityFindingKeys = new Set();
  for (const table of severityTables.values()) {
    for (const finding of table.findings) {
      const details = /** @type {Record<string, unknown>} */ (finding.details);
      const key = `${finding.code}\u0000${details.constraintId ?? ''}\u0000${details.code ?? ''}`;
      if (severityFindingKeys.has(key)) continue;
      severityFindingKeys.add(key);
      engineFindings.push(/** @type {import('./types.js').RuleFinding} */ (finding));
    }
  }

  const waivers =
    ledger === null ? null : applyWaivers(allSubjects, { ledger, registry, constraintIdByCode });
  const dormancy =
    ledger === null
      ? null
      : detectDormantWaivers(allSubjects, { ledger, registry, constraintIdByCode });

  /** @type {import('./types.js').RuleViolation[]} */
  const violations = [];
  /** @type {import('./types.js').RuleFinding[]} */
  const findings = [...engineFindings];
  /** @type {Record<string, import('./types.js').RuleResult>} */
  const byRuleId = {};

  for (const result of results) {
    byRuleId[result.ruleId] = result;
    findings.push(...result.findings);
    for (const subject of result.subjects) {
      const judged = waivers ? (waivers.byId[subject.id] ?? subject) : subject;
      const subjectFindings = /** @type {ReadonlyArray<import('./types.js').RuleFinding>} */ (
        judged.findings
      );
      meta.findingsExamined += subjectFindings.length;
      findings.push(...subjectFindings);
      violations.push(
        ...violationsOf(
          { id: subject.id, findings: subjectFindings, details: subject.details },
          result,
          constraintIdByCode
        )
      );
    }
  }

  // Ledger-level findings only, taken from the list the applier keeps for the
  // purpose. Every subject-level waiver finding is already on the subject it
  // belongs to, and pushing it twice would double-count it in anything that
  // tallies the flat list — which is what filtering on `details.subjectId` did,
  // because the applicability findings (`WAIVER_EXPIRED` and friends) never
  // carry one.
  if (waivers) findings.push(...waivers.ledgerFindings);
  if (dormancy) findings.push(...dormancy.findings);

  meta.violationsReported = violations.length;
  meta.violationsWaived = violations.filter((violation) => violation.waived).length;

  const disposition = waivers
    ? waivers.disposition
    : deriveWaiverDisposition({
        waivedCount: 0,
        uncoveredViolationCount: violations.length > 0 ? 1 : 0,
      });

  return {
    rules: results,
    byRuleId,
    violations,
    findings,
    coverage,
    waivers,
    dormancy,
    status: deriveRuleStatus(findings),
    disposition,
    meta,
  };
}
