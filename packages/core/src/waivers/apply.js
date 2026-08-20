/**
 * Applying the ledger: the part that must never be silent.
 *
 * The requirement this module exists to meet, from the build plan:
 *
 * > The rule engine consults waivers and reports a waived violation distinctly
 * > from a clean pass — never silently.
 *
 * Three mechanisms enforce "never silently", and none of them is a convention
 * somebody has to remember:
 *
 * 1. **A waived finding is kept, not deleted.** It is re-severitied from
 *    `blocking` to `compromise` and stamped with `details.waived`,
 *    `details.waiverId`, `details.waivedBy` and `details.severityBeforeWaiver`.
 *    The violation is still in the list, still says what it was, and now says
 *    who signed it off. (`constraints/severity.js` demotes findings the same
 *    way and for the same reason — "an `info` overlap finding is still an
 *    overlap".)
 * 2. **`WAIVER_APPLIED` is a `compromise`, not an `info`.** Because
 *    `deriveWaiverStatus()` reads severities and nothing else, a subject
 *    carrying that finding *cannot* derive `allowed`. "Waived" and "clean" are
 *    separated by the status machinery itself rather than by anybody's
 *    diligence.
 * 3. **The disposition is a four-value enum**, derived from the 2×2 of *did a
 *    waiver fire* and *is a violation still uncovered*. An ordinary
 *    `compromised` row and a waived one both report status `compromised`; only
 *    one of them reports disposition `waived`.
 *
 * ## Linking a finding to a constraint
 *
 * A waiver excepts a *constraint*; a finding carries a *reason code*. The
 * registry knows the mapping for every constraint whose `enforcement` is
 * `reason-codes`, and `applyWaivers()` uses `registry.idsByReasonCode` for
 * those. For a `declared-only` constraint there is nothing to look up — that is
 * what declared-only means — so the caller may supply `constraintIdByCode`
 * explicitly. Coach travel is exactly this case today (see `coachTravel.js`),
 * and when Prompt 3.1 gives the coach-travel constraint real reason codes the
 * explicit map becomes unnecessary and this parameter goes unused.
 *
 * @module waivers/apply
 */

import { getConstraint } from '../constraints/registry.js';

import { reconcileWaiverLedger, waiversForConstraint } from './ledger.js';
import {
  WAIVER_DISPOSITION,
  WAIVER_REASON,
  WAIVER_SEVERITY,
  createWaiverMeta,
  deriveWaiverDisposition,
  deriveWaiverStatus,
  isViolationFinding,
  makeWaiverFinding,
  mergeWaiverMeta,
} from './reasonCodes.js';
import { WaiverSubjectSchema } from './schemas.js';
import { judgeWaiverApplicability, normaliseWaiverContext } from './scope.js';

/**
 * The constraint ids a reason code belongs to, explicit map first.
 *
 * @param {string} code
 * @param {import('../constraints/types.js').ConstraintRegistry} registry
 * @param {Record<string, string|string[]>} constraintIdByCode
 * @returns {string[]}
 */
function constraintIdsForCode(code, registry, constraintIdByCode) {
  const explicit = constraintIdByCode[code];
  if (explicit !== undefined) return Array.isArray(explicit) ? [...explicit] : [explicit];
  return [...(registry.idsByReasonCode[code] ?? [])];
}

/**
 * Does this waiver cover this reason code?
 *
 * An empty `reasonCodes` means "everything the constraint governs", which is
 * the common case: the board waived *the travel rule*, not one of its codes.
 *
 * @param {import('./types.js').WaiverRecord} record
 * @param {string} code
 * @returns {boolean}
 */
function waiverCoversCode(record, code) {
  return record.reasonCodes.length === 0 || record.reasonCodes.includes(code);
}

/**
 * Render the one-line note a published row carries.
 *
 * @param {import('./types.js').WaiverRecord} record
 * @param {string[]} codes
 * @returns {string}
 */
function annotationNote(record, codes) {
  const approvedOn = record.approval.approvedAt ? ` on ${record.approval.approvedAt}` : '';
  const expiry = record.effectiveTo ? `, expires ${record.effectiveTo}` : '';
  return `Waived (${codes.join(', ')}): ${record.reason} — approved by ${record.approval.approvedBy}${approvedOn}${expiry} [${record.id}]`;
}

/**
 * Apply a ledger to a set of subjects.
 *
 * A *subject* is whatever the caller is judging one row at a time: a game, a
 * candidate placement, a coach's transition between two commitments. It carries
 * an `id`, the `findings` some evaluator produced for it, and the `context`
 * against which waiver scope is judged.
 *
 * @param {ReadonlyArray<import('./types.js').WaiverSubject>} subjects
 * @param {{ ledger: import('./types.js').WaiverLedger, registry: import('../constraints/types.js').ConstraintRegistry, constraintIdByCode?: Record<string, string|string[]> }} options
 * @returns {import('./types.js').WaiverApplication}
 */
export function applyWaivers(subjects, options) {
  const { ledger, registry, constraintIdByCode = {} } = options;
  const meta = createWaiverMeta();

  // The ledger-level audit runs once per application rather than once per
  // subject: a waiver whose constraint has vanished, or whose constraint may
  // not be waived at all, must be refused whether or not anybody remembered to
  // call `reconcileWaiverLedger()` first.
  const reconciliation = reconcileWaiverLedger(ledger, registry);
  const barred = new Set([
    ...reconciliation.unknownConstraintIds,
    ...reconciliation.notWaivableIds,
  ]);

  /** @type {import('./types.js').WaiverFinding[]} */
  const ledgerFindings = [...reconciliation.findings];
  /** @type {import('./types.js').WaivedSubject[]} */
  const results = [];
  /** @type {import('./types.js').WaiverAnnotation[]} */
  const annotations = [];
  /** @type {Set<string>} */
  const appliedWaiverIds = new Set();
  let linkedFindings = 0;

  for (const raw of subjects) {
    const subject = WaiverSubjectSchema.parse(raw);
    meta.subjectsExamined += 1;
    const context = normaliseWaiverContext(subject.context);

    /** @type {import('./types.js').WaiverFinding[]} */
    const subjectFindings = [];
    /** @type {import('./types.js').WaiverApplicability[]} */
    const applicability = [];
    /** @type {Map<string, import('./types.js').WaiverRecord>} */
    const applicableByWaiverId = new Map();
    /** @type {Set<string>} */
    const judgedConstraintIds = new Set();

    /**
     * Judge every waiver excepting one constraint, once per subject.
     *
     * @param {string} constraintId
     */
    const judgeConstraint = (constraintId) => {
      if (judgedConstraintIds.has(constraintId)) return;
      judgedConstraintIds.add(constraintId);
      const constraint = getConstraint(registry, constraintId);
      for (const record of waiversForConstraint(ledger, constraintId)) {
        if (barred.has(record.id)) continue;
        meta.waiversConsidered += 1;
        const judged = judgeWaiverApplicability(record, context, constraint);
        meta.scopeDimensionsTested += judged.dimensionsTested;
        subjectFindings.push(...judged.findings);
        applicability.push(judged.applicability);
        if (judged.applicability.applicable) {
          meta.waiversApplicable += 1;
          applicableByWaiverId.set(record.id, record);
        } else if (!judged.applicability.judged) {
          meta.waiversUnjudged += 1;
        } else if (!judged.applicability.inWindow) {
          meta.waiversInactive += 1;
        } else {
          meta.waiversOutOfScope += 1;
        }
      }
    };

    /** @type {Map<string, string[]>} - waiver id -> codes it covered here */
    const codesByWaiver = new Map();
    /** @type {import('./types.js').WaiverFinding[]} */
    const rewritten = [];
    let waivedCount = 0;
    let uncoveredViolationCount = 0;

    for (const finding of subject.findings) {
      meta.findingsExamined += 1;
      const constraintIds = constraintIdsForCode(finding.code, registry, constraintIdByCode);
      if (constraintIds.length > 0) linkedFindings += 1;

      /** @type {import('./types.js').WaiverRecord|null} */
      let cover = null;
      /** @type {string|null} */
      let coveringConstraintId = null;
      let waivableConstraintSeen = false;

      for (const constraintId of constraintIds) {
        const constraint = getConstraint(registry, constraintId);
        if (!constraint || !constraint.waivable) continue;
        waivableConstraintSeen = true;
        meta.constraintsLinked += 1;
        judgeConstraint(constraintId);
        for (const record of waiversForConstraint(ledger, constraintId)) {
          if (!applicableByWaiverId.has(record.id)) continue;
          if (!waiverCoversCode(record, finding.code)) continue;
          cover = record;
          coveringConstraintId = constraintId;
          break;
        }
        if (cover) break;
      }

      if (cover) {
        waivedCount += 1;
        meta.findingsWaived += 1;
        appliedWaiverIds.add(cover.id);
        const codes = codesByWaiver.get(cover.id) ?? [];
        codes.push(finding.code);
        codesByWaiver.set(cover.id, codes);
        rewritten.push({
          ...finding,
          // A waived violation is never illegal and never clean: `compromise`
          // is the only honest severity for "this is wrong and somebody with
          // the authority to say so accepted it".
          severity:
            finding.severity === WAIVER_SEVERITY.BLOCKING
              ? WAIVER_SEVERITY.COMPROMISE
              : finding.severity,
          details: {
            ...finding.details,
            waived: true,
            waiverId: cover.id,
            waivedConstraintId: coveringConstraintId,
            waivedBy: cover.approval.approvedBy,
            waivedAt: cover.approval.approvedAt,
            severityBeforeWaiver: finding.severity,
          },
        });
        continue;
      }

      rewritten.push(finding);
      if (isViolationFinding(finding)) {
        uncoveredViolationCount += 1;
        if (waivableConstraintSeen) {
          subjectFindings.push(
            makeWaiverFinding(
              WAIVER_REASON.WAIVER_ABSENT,
              `"${finding.code}" violates a waivable constraint here and no waiver in the ledger covers it`,
              {
                subjectId: subject.id,
                code: finding.code,
                constraintIds: [...constraintIds].sort(),
                ledgerWaiverCount: ledger.waiverIds.length,
              }
            )
          );
        }
      }
    }

    for (const [waiverId, codes] of codesByWaiver) {
      const record = /** @type {import('./types.js').WaiverRecord} */ (
        applicableByWaiverId.get(waiverId)
      );
      const sorted = [...new Set(codes)].sort();
      subjectFindings.push(
        makeWaiverFinding(
          WAIVER_REASON.WAIVER_APPLIED,
          `waiver "${waiverId}" excuses ${sorted.join(', ')} here: ${record.reason} (approved by ${record.approval.approvedBy})`,
          {
            subjectId: subject.id,
            waiverId,
            constraintId: record.constraintId,
            codes: sorted,
            approvedBy: record.approval.approvedBy,
            approvedAt: record.approval.approvedAt,
            expiresOn: record.effectiveTo,
          }
        )
      );
      annotations.push({
        subjectId: subject.id,
        waiverId,
        constraintId: record.constraintId,
        reasonCodes: sorted,
        reason: record.reason,
        approvedBy: record.approval.approvedBy,
        approvedAt: record.approval.approvedAt,
        expiresOn: record.effectiveTo,
        note: annotationNote(record, sorted),
        details: subject.details,
      });
    }

    if (codesByWaiver.size > 0) meta.waiversApplied += codesByWaiver.size;

    const allFindings = [...rewritten, ...subjectFindings];
    results.push({
      id: subject.id,
      findings: allFindings,
      status: deriveWaiverStatus(allFindings),
      statusWithoutWaivers: deriveWaiverStatus(subject.findings),
      disposition: deriveWaiverDisposition({ waivedCount, uncoveredViolationCount }),
      appliedWaiverIds: [...codesByWaiver.keys()].sort(),
      applicability,
      waivedCount,
      uncoveredViolationCount,
    });
  }

  // Incident 4: an applier that could not have applied anything must not look
  // like an applier that found nothing to apply.
  if (meta.findingsExamined > 0 && ledger.waiverIds.length > 0 && linkedFindings === 0) {
    ledgerFindings.push(
      makeWaiverFinding(
        WAIVER_REASON.WAIVER_APPLY_UNLINKED,
        `${meta.findingsExamined} finding(s) were examined against a ledger of ${ledger.waiverIds.length} waiver(s) and not one reason code links to any constraint, so no waiver could have applied`,
        {
          findingsExamined: meta.findingsExamined,
          waiverCount: ledger.waiverIds.length,
          governedCodeCount: Object.keys(registry.idsByReasonCode).length,
        }
      )
    );
  }

  mergeWaiverMeta(meta, reconciliation.meta);

  /** @type {Record<string, import('./types.js').WaivedSubject>} */
  const byId = {};
  for (const result of results) byId[result.id] = result;

  const findings = [...ledgerFindings, ...results.flatMap((result) => result.findings)];
  const anyWaived = results.some((result) => result.waivedCount > 0);
  const anyUncovered = results.some((result) => result.uncoveredViolationCount > 0);

  return {
    subjects: results,
    byId,
    findings,
    status: deriveWaiverStatus(findings),
    disposition: deriveWaiverDisposition({
      waivedCount: anyWaived ? 1 : 0,
      uncoveredViolationCount: anyUncovered ? 1 : 0,
    }),
    annotations,
    appliedWaiverIds: [...appliedWaiverIds].sort(),
    meta,
  };
}

/**
 * Is this subject's result a waived one rather than a clean one?
 *
 * A one-line helper so no call site has to spell the comparison and get it
 * subtly wrong.
 *
 * @param {import('./types.js').WaivedSubject} subject
 * @returns {boolean}
 */
export function isWaived(subject) {
  return (
    subject.disposition === WAIVER_DISPOSITION.WAIVED ||
    subject.disposition === WAIVER_DISPOSITION.WAIVED_PARTIAL
  );
}
