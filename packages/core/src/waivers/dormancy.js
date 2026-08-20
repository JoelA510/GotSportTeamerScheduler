/**
 * Dormancy detection: which waivers are no longer doing anything.
 *
 * The requirement, from the build plan:
 *
 * > **DORMANCY DETECTION**: after any solve, report waivers that are no longer
 * > load-bearing, i.e. the schedule would pass without them. These are
 * > candidates for retirement and should not quietly accumulate.
 *
 * ## It is a counterfactual, and it reuses the 2.1 shape
 *
 * "Would the schedule pass without this waiver?" is answered the only way it
 * can honestly be answered: by evaluating twice, once with the ledger and once
 * with the ledger minus one record, and diffing. That is exactly the shape
 * `whatIfConstraintType()` uses in Prompt 2.1 — build the alternative, run the
 * same evaluation through it, report the delta — and it is reused rather than
 * reinvented on purpose. There should be one way in this codebase to ask a
 * counterfactual question.
 *
 * ## Two verdicts, not one
 *
 * A single boolean would hide a real distinction, so the report carries both:
 *
 * - **`dormant`** — the waiver covered *nothing*. There is no violation for it
 *   to excuse. This is incident 9's middle act, where the fixture times moved
 *   and the exception silently stopped mattering while staying on the books.
 * - **`changesStatus`** — some subject's three-state verdict depends on it.
 *   A waiver can fire (so it is not dormant) and still change no verdict, when
 *   the violation it covers is a `compromise` either way. That is weaker than
 *   dormant and is still worth an operator's attention, so it gets its own
 *   code rather than being rounded to one of the other two answers.
 *
 * `retirementCandidate` is `!changesStatus`, which covers both.
 *
 * ## It is computed, never stored
 *
 * Nothing in `WaiverRecord` says whether a waiver is dormant, and
 * `WaiverRecordSchema` is `.strict()` so nothing can smuggle it in. Dormancy is
 * a property of a waiver *and a schedule together*: incident 9's waiver was
 * unnecessary and then necessary again without a character of it changing. A
 * stored flag would have been wrong twice.
 *
 * @module waivers/dormancy
 */

import { applyWaivers } from './apply.js';
import { withoutWaiver } from './ledger.js';
import {
  WAIVER_REASON,
  createWaiverMeta,
  deriveWaiverStatus,
  makeWaiverFinding,
  mergeWaiverMeta,
} from './reasonCodes.js';

/** Why a waiver is or is not a retirement candidate. */
export const DORMANCY_REASON = Object.freeze({
  /** It covered nothing at all. */
  NEVER_MATCHED: 'never-matched',
  /** It covered something, but no verdict depends on it. */
  NOT_STATUS_BEARING: 'not-status-bearing',
  /** A verdict depends on it. Keep it. */
  LOAD_BEARING: 'load-bearing',
});

/**
 * How many findings on this subject one waiver covered.
 *
 * @param {import('./types.js').WaivedSubject} subject
 * @param {string} waiverId
 * @returns {number}
 */
function coveredCount(subject, waiverId) {
  let count = 0;
  for (const finding of subject.findings) {
    if (
      finding.details &&
      finding.details.waived === true &&
      finding.details.waiverId === waiverId
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Report, for every waiver in the ledger, whether this solve still needs it.
 *
 * @param {ReadonlyArray<import('./types.js').WaiverSubject>} subjects - the whole
 *   solve, one entry per judged row. Passing a filtered slice will report
 *   waivers dormant that are load-bearing elsewhere, which is why the vacuity
 *   check below is not optional.
 * @param {{ ledger: import('./types.js').WaiverLedger, registry: import('../constraints/types.js').ConstraintRegistry, constraintIdByCode?: Record<string, string|string[]> }} options
 * @returns {import('./types.js').WaiverDormancyReport}
 */
export function detectDormantWaivers(subjects, options) {
  const { ledger, registry, constraintIdByCode = {} } = options;
  const meta = createWaiverMeta();
  /** @type {import('./types.js').WaiverFinding[]} */
  const findings = [];

  const baseline = applyWaivers(subjects, { ledger, registry, constraintIdByCode });
  mergeWaiverMeta(meta, baseline.meta);

  // Incident 4. A scan over **no subjects** reports every waiver dormant, and
  // that answer is indistinguishable from the same answer about a healthy
  // schedule, so the empty case says so out loud.
  //
  // Note what is deliberately *not* vacuous: subjects that carry no findings.
  // A clean schedule is the normal reason a waiver goes dormant — it is
  // incident 9's middle act — and crying incident 4 over it would make the
  // real signal unreadable. `meta.findingsExamined` is returned so a caller
  // that wants to assert on the evidence base still can, and every
  // `WAIVER_DORMANT` finding carries it.
  if (baseline.meta.subjectsExamined === 0) {
    findings.push(
      makeWaiverFinding(
        WAIVER_REASON.WAIVER_SCAN_VACUOUS,
        `the dormancy scan examined no subjects at all, so "every waiver is dormant" would be a fact about the input rather than about the schedule`,
        {
          subjectsExamined: baseline.meta.subjectsExamined,
          findingsExamined: baseline.meta.findingsExamined,
          waiverCount: ledger.waiverIds.length,
        }
      )
    );
  }

  /** @type {import('./types.js').WaiverDormancy[]} */
  const waivers = [];

  for (const record of ledger.waivers) {
    meta.dormancyProbes += 1;
    const counterfactual = applyWaivers(subjects, {
      ledger: withoutWaiver(ledger, record.id),
      registry,
      constraintIdByCode,
    });

    let appliedCount = 0;
    /** @type {string[]} */
    const subjectIds = [];
    /** @type {Array<{ id: string, statusWith: string, statusWithout: string }>} */
    const statusDeltas = [];

    for (const subject of baseline.subjects) {
      const covered = coveredCount(subject, record.id);
      if (covered > 0) {
        appliedCount += covered;
        subjectIds.push(subject.id);
      }
      const without = counterfactual.byId[subject.id];
      if (without && without.status !== subject.status) {
        statusDeltas.push({
          id: subject.id,
          statusWith: subject.status,
          statusWithout: without.status,
        });
      }
    }

    const dormant = appliedCount === 0;
    const changesStatus = statusDeltas.length > 0;
    const reason = dormant
      ? DORMANCY_REASON.NEVER_MATCHED
      : changesStatus
        ? DORMANCY_REASON.LOAD_BEARING
        : DORMANCY_REASON.NOT_STATUS_BEARING;

    if (dormant) {
      findings.push(
        makeWaiverFinding(
          WAIVER_REASON.WAIVER_DORMANT,
          `waiver "${record.id}" covered nothing in this solve: the schedule presents no violation of "${record.constraintId}" for it to excuse, so it is a candidate for retirement`,
          {
            waiverId: record.id,
            constraintId: record.constraintId,
            approvedBy: record.approval.approvedBy,
            subjectsExamined: baseline.meta.subjectsExamined,
            findingsExamined: baseline.meta.findingsExamined,
            reason,
          }
        )
      );
    } else if (!changesStatus) {
      findings.push(
        makeWaiverFinding(
          WAIVER_REASON.WAIVER_NOT_STATUS_BEARING,
          `waiver "${record.id}" covered ${appliedCount} finding(s) but no subject's status depends on it; without it the schedule reaches the same verdict everywhere`,
          {
            waiverId: record.id,
            constraintId: record.constraintId,
            appliedCount,
            subjectIds: [...subjectIds].sort(),
            reason,
          }
        )
      );
    }

    waivers.push({
      waiverId: record.id,
      constraintId: record.constraintId,
      dormant,
      loadBearing: !dormant,
      changesStatus,
      retirementCandidate: !changesStatus,
      appliedCount,
      subjectIds: [...subjectIds].sort(),
      statusDeltas: statusDeltas.sort((a, b) => a.id.localeCompare(b.id)),
      reason,
    });
  }

  return {
    waivers,
    dormantWaiverIds: waivers.filter((entry) => entry.dormant).map((entry) => entry.waiverId),
    retirementCandidateIds: waivers
      .filter((entry) => entry.retirementCandidate)
      .map((entry) => entry.waiverId),
    loadBearingWaiverIds: waivers
      .filter((entry) => entry.changesStatus)
      .map((entry) => entry.waiverId),
    findings,
    status: deriveWaiverStatus(findings),
    meta,
  };
}
