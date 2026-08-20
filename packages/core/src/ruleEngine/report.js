/**
 * The full-schedule validation report.
 *
 * > *Also add: a full-schedule validation report (violations grouped by
 * > severity, with counts) …*
 *
 * The grouping is the easy half. The half that matters is that **the report
 * carries its own meta-assertions**, because a report is precisely where a
 * vacuous run stops looking vacuous: every count is a number, every group is
 * present, the severities all read zero, and the page looks exactly like a
 * clean season. `REPORT_VACUOUS` and `REPORT_NO_RULE_EXERCISED` are `blocking`
 * for that reason — a report nobody can attribute to any examined data is worse
 * than no report, because somebody will publish it.
 *
 * Three things the report deliberately does **not** do:
 *
 * - It does not drop waived violations. They are counted, grouped, and counted
 *   again under `waivedCount`, because "compromised with a board signature on
 *   it" is a different fact from "compromised" and the operator needs both.
 * - It does not omit a severity whose count is zero. A group that vanishes when
 *   empty makes "no blocking violations" and "blocking was never computed"
 *   render identically.
 * - It does not hide the constraints nothing checked. `unenforcedConstraintIds`
 *   is a first-class field of the report, because ten of the fourteen
 *   season-2026 constraints have no Phase 1 enforcement path and a report that
 *   said "all constraints pass" would be incident 4 with a summary table.
 *
 * @module ruleEngine/report
 */

import { WAIVER_DISPOSITION, deriveWaiverDisposition } from '../waivers/reasonCodes.js';

import {
  RULE_REASON,
  RULE_SEVERITY,
  createRuleEngineMeta,
  deriveRuleStatus,
  makeRuleFinding,
  mergeRuleEngineMeta,
} from './reasonCodes.js';

/** Every severity, in the order a reader wants them. */
export const SEVERITY_ORDER = Object.freeze([
  RULE_SEVERITY.BLOCKING,
  RULE_SEVERITY.COMPROMISE,
  RULE_SEVERITY.INFO,
]);

/**
 * Build the validation report for one run.
 *
 * @param {import('./types.js').RuleEngineResult} result
 * @param {{ scheduleName?: string|null }} [options]
 * @returns {import('./types.js').ValidationReport}
 */
export function buildValidationReport(result, options = {}) {
  const meta = createRuleEngineMeta();
  mergeRuleEngineMeta(meta, result.meta);
  /** @type {import('./types.js').RuleFinding[]} */
  const findings = [];

  /** @type {Record<string, import('./types.js').RuleViolation[]>} */
  const violationsBySeverity = {};
  /** @type {Record<string, number>} */
  const countBySeverity = {};
  for (const severity of SEVERITY_ORDER) {
    violationsBySeverity[severity] = [];
    countBySeverity[severity] = 0;
  }

  /** @type {Record<string, number>} */
  const countByCode = {};
  /** @type {Record<string, number>} */
  const countByRuleId = {};
  /** @type {Record<string, number>} */
  const countByConstraintId = {};
  let waivedCount = 0;

  for (const violation of result.violations) {
    const bucket = violationsBySeverity[violation.severity] ?? [];
    bucket.push(violation);
    violationsBySeverity[violation.severity] = bucket;
    countBySeverity[violation.severity] = (countBySeverity[violation.severity] ?? 0) + 1;
    countByCode[violation.code] = (countByCode[violation.code] ?? 0) + 1;
    countByRuleId[violation.ruleId] = (countByRuleId[violation.ruleId] ?? 0) + 1;
    for (const constraintId of violation.constraintIds) {
      countByConstraintId[constraintId] = (countByConstraintId[constraintId] ?? 0) + 1;
    }
    if (violation.waived) waivedCount += 1;
  }

  const underExercisedRuleIds = result.rules
    .filter((rule) => !rule.exercised)
    .map((rule) => rule.ruleId)
    .sort();

  // Incident 4, at the level of the whole report. A report over no subjects and
  // a report over a flawless season are the same page of zeroes, so the empty
  // case says so out loud rather than being left to the reader.
  if (result.meta.subjectsExamined === 0 && result.meta.rulesExercised === 0) {
    findings.push(
      makeRuleFinding(
        RULE_REASON.REPORT_VACUOUS,
        'this report was built over zero examined subjects and zero exercised rules, so every count in it is a fact about the input rather than about the schedule',
        {
          subjectsExamined: result.meta.subjectsExamined,
          rulesRun: result.meta.rulesRun,
          rulesExercised: result.meta.rulesExercised,
        }
      )
    );
  }

  if (result.rules.length > 0 && result.meta.rulesExercised === 0) {
    findings.push(
      makeRuleFinding(
        RULE_REASON.REPORT_NO_RULE_EXERCISED,
        `not one of the ${result.rules.length} rule(s) met its own exercise expectation, so no count in this report can be attributed to data anybody read`,
        {
          ruleCount: result.rules.length,
          underExercisedRuleIds,
          rulesThrew: result.meta.rulesThrew,
        }
      )
    );
  }

  const dormantWaiverIds = result.dormancy ? [...result.dormancy.dormantWaiverIds] : [];
  const unwaivedCount = result.violations.length - waivedCount;
  const disposition =
    result.waivers !== null
      ? result.disposition
      : deriveWaiverDisposition({
          waivedCount,
          uncoveredViolationCount: unwaivedCount > 0 ? 1 : 0,
        });

  for (const bucket of Object.values(violationsBySeverity)) {
    bucket.sort(
      (a, b) =>
        a.ruleId.localeCompare(b.ruleId) ||
        a.code.localeCompare(b.code) ||
        a.subjectId.localeCompare(b.subjectId)
    );
  }

  const allFindings = [...result.findings, ...findings];

  return {
    scheduleName: options.scheduleName ?? null,
    countBySeverity,
    violationsBySeverity,
    countByCode,
    countByRuleId,
    countByConstraintId,
    violationCount: result.violations.length,
    waivedCount,
    unwaivedCount,
    unenforcedConstraintIds: [...result.coverage.unenforcedConstraintIds],
    underExercisedRuleIds,
    dormantWaiverIds,
    findings,
    status: deriveRuleStatus(allFindings),
    disposition: disposition ?? WAIVER_DISPOSITION.CLEAN,
    meta,
  };
}

/**
 * Render the report as plain text, for an operator reading a terminal.
 *
 * Deliberately boring, and deliberately including the two sections a prettier
 * summary would leave out: the rules that could not prove they examined
 * anything, and the constraints nothing checked at all.
 *
 * @param {import('./types.js').ValidationReport} report
 * @returns {string}
 */
export function renderValidationReport(report) {
  const lines = [];
  lines.push(`Schedule: ${report.scheduleName ?? '(unnamed)'}`);
  lines.push(`Status: ${report.status} · disposition: ${report.disposition}`);
  lines.push(
    `Violations: ${report.violationCount} (${report.waivedCount} waived, ${report.unwaivedCount} not)`
  );
  for (const severity of SEVERITY_ORDER) {
    lines.push(`  ${severity}: ${report.countBySeverity[severity] ?? 0}`);
  }
  lines.push('By rule:');
  for (const ruleId of Object.keys(report.countByRuleId).sort()) {
    lines.push(`  ${ruleId}: ${report.countByRuleId[ruleId]}`);
  }
  lines.push(
    `Rules that could not prove they examined the right data: ${
      report.underExercisedRuleIds.length === 0 ? 'none' : report.underExercisedRuleIds.join(', ')
    }`
  );
  lines.push(
    `Constraints no rule enforces: ${
      report.unenforcedConstraintIds.length === 0
        ? 'none'
        : report.unenforcedConstraintIds.join(', ')
    }`
  );
  lines.push(
    `Dormant waivers: ${
      report.dormantWaiverIds.length === 0 ? 'none' : report.dormantWaiverIds.join(', ')
    }`
  );
  return lines.join('\n');
}
