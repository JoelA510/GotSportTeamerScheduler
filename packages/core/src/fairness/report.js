/**
 * **The one call, and the checks that prove it did something.**
 *
 * `fairnessReport()` is this module's public question: *"is anybody in this
 * season being treated unlike their peers, and how would I check that claim?"*
 *
 * ## The meta-assertions, and how to make each one fail
 *
 * Incident 4 in `fixtures/season-2026/README.md` is a validator whose join
 * matched zero person-pairs after a team-code format change. It reported zero
 * conflicts — a perfect score meaning *"I looked at nothing"* — and nothing in
 * the suite noticed. A fairness report is the same shape of hazard with a larger
 * blast radius, because "no outliers found" is the outcome an administrator
 * wants and will not interrogate.
 *
 * So four checks run on every report, each raising a **blocking** finding that
 * makes the report's `status` `rejected`. Each is falsifiable, and the input
 * that falsifies it is stated here rather than left to a future reader to
 * imagine:
 *
 * | check | fails when | falsified by |
 * |---|---|---|
 * | `FAIRNESS_NO_FIXTURES_READ` | `meta.fixturesRead === 0` | a fixture list the schema accepts but the classifier rejects wholesale — every row carrying an unknown `competition` |
 * | `FAIRNESS_METRIC_UNEXERCISED` | any declared metric measured zero subjects | a fixture list of `external` rows only: every league metric has nothing to read |
 * | `FAIRNESS_NOTHING_JUDGED` | `meta.judgementsMade === 0` | any list whose every cohort is below the four-member floor — three teams playing each other |
 * | `FAIRNESS_FLAG_EVIDENCE_MISSING` | a flag lacks its basis or its arithmetic | a judgement built without a centre; guarded in `outliers.js` |
 *
 * The second is the one worth dwelling on. A metric that measured *some*
 * subjects and found nothing is a real all-clear. A metric that measured **zero**
 * subjects and found nothing is incident 4, and the two are indistinguishable in
 * the output unless something asserts the difference — which is why the count is
 * a blocking finding and not a `meta` field somebody might read.
 *
 * ## What the report does not do
 *
 * It does not rank teams, score a schedule against a target, or recommend a
 * change. It measures, judges where a judgement is possible, refuses where it is
 * not, and publishes what each answer rests on.
 *
 * @module fairness/report
 */

import { classifyFairnessFixtures, membershipSplit, participationOf } from './classification.js';
import {
  FAIRNESS_METRIC_ORDER,
  FAIRNESS_METRIC_REGISTRY,
  FAIRNESS_SUBJECT_KIND,
  groupKeyOf,
  measureGroup,
  measureTeams,
} from './metrics.js';
import {
  FAIRNESS_BASIS,
  assertFlagEvidence,
  basesFor,
  buildPopulations,
  corroborateFlags,
} from './outliers.js';
import {
  FAIRNESS_DISPERSION,
  FAIRNESS_JUDGEMENT,
  FAIRNESS_MEASURABILITY,
  FAIRNESS_QUESTION,
  FAIRNESS_REASON,
  assertFairnessFindings,
  createFairnessMeta,
  deriveFairnessStatus,
  makeFairnessFinding,
} from './reasonCodes.js';
import { FairnessReportQuerySchema } from './schemas.js';

/**
 * Build the report.
 *
 * @param {unknown} query - parsed by {@link FairnessReportQuerySchema}
 * @returns {import('./types.js').FairnessReport}
 */
export function fairnessReport(query) {
  const parsed = FairnessReportQuerySchema.parse(query);
  const meta = createFairnessMeta();
  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [];

  const metricIds =
    parsed.metricIds.length > 0
      ? FAIRNESS_METRIC_ORDER.filter((id) => parsed.metricIds.includes(id))
      : FAIRNESS_METRIC_ORDER;

  const fixtures = /** @type {ReadonlyArray<import('./types.js').FairnessFixture>} */ (
    /** @type {unknown} */ (parsed.fixtures)
  );
  const classification = classifyFairnessFixtures(fixtures);
  findings.push(...classification.findings);
  meta.fixturesRead = Object.values(classification.byCompetition).reduce(
    (total, count) => total + count,
    0
  );

  const participation = participationOf(classification.usable ? fixtures : []);
  meta.subjectsConsidered = participation.size;

  const membership = membershipSplit(participation, parsed.memberSubjectIds);
  findings.push(...membership.findings);

  const teamMeasurements = measureTeams(participation);

  /** @type {Map<string, ReadonlySet<string>>} */
  const divisionsBySubject = new Map();
  /** @type {Map<string, ReadonlySet<string>>} */
  const ageGroupsBySubject = new Map();
  for (const [subjectId, entry] of participation) {
    divisionsBySubject.set(subjectId, entry.divisions);
    ageGroupsBySubject.set(subjectId, entry.ageGroups);
  }
  const divisionKeyOf = (subjectId) => groupKeyOf(divisionsBySubject.get(subjectId) ?? new Set());
  const ageGroupKeyOf = (subjectId) => groupKeyOf(ageGroupsBySubject.get(subjectId) ?? new Set());

  /** @type {import('./types.js').FairnessPopulation[]} */
  const populations = [];
  /** @type {import('./types.js').FairnessJudgement[]} */
  const judgements = [];
  /** @type {import('./types.js').FairnessMeasurement[]} */
  const measurements = [...teamMeasurements];

  const keyResolver = {
    [FAIRNESS_BASIS.DIVISION]: divisionKeyOf,
    [FAIRNESS_BASIS.AGE_GROUP]: ageGroupKeyOf,
    [FAIRNESS_BASIS.SEASON]: () => ({ key: FAIRNESS_BASIS.SEASON, reasonCode: null }),
  };

  for (const metricId of metricIds) {
    const metric = FAIRNESS_METRIC_REGISTRY[metricId];
    const forMetric = teamMeasurements.filter((measurement) => measurement.metricId === metricId);

    for (const basisKind of basesFor(FAIRNESS_SUBJECT_KIND.TEAM)) {
      const built = buildPopulations({
        metricId,
        unit: metric.unit,
        subjectKind: FAIRNESS_SUBJECT_KIND.TEAM,
        basisKind,
        measurements: forMetric,
        groupKeyOf: keyResolver[basisKind],
      });
      populations.push(...built.populations);
      judgements.push(...built.judgements);
      findings.push(...built.findings);
    }

    // Group subjects. A division's value is the median of its member teams'
    // values, so the figure published about a division is the same number a
    // team in it was judged against — see `metrics.js`.
    for (const { subjectKind, resolver } of [
      { subjectKind: FAIRNESS_SUBJECT_KIND.DIVISION, resolver: divisionKeyOf },
      { subjectKind: FAIRNESS_SUBJECT_KIND.AGE_GROUP, resolver: ageGroupKeyOf },
    ]) {
      /** @type {Map<string, import('./types.js').FairnessMeasurement[]>} */
      const byGroup = new Map();
      for (const measurement of forMetric) {
        const group = resolver(measurement.subjectId);
        if (group.key === null) continue;
        if (!byGroup.has(group.key)) byGroup.set(group.key, []);
        /** @type {import('./types.js').FairnessMeasurement[]} */ (byGroup.get(group.key)).push(
          measurement
        );
      }
      /** @type {import('./types.js').FairnessMeasurement[]} */
      const groupMeasurements = [];
      /** @type {Map<string, ReadonlySet<string>>} */
      const parentOf = new Map();
      for (const groupKey of [...byGroup.keys()].sort()) {
        const members = /** @type {import('./types.js').FairnessMeasurement[]} */ (
          byGroup.get(groupKey)
        );
        groupMeasurements.push(measureGroup(subjectKind, groupKey, metricId, members));
        // A division's parent cohort is its age group; an age group's is the
        // season, which every subject shares.
        const parents = new Set();
        if (subjectKind === FAIRNESS_SUBJECT_KIND.DIVISION) {
          for (const member of members) {
            const age = ageGroupKeyOf(member.subjectId);
            if (age.key !== null) parents.add(age.key);
          }
        }
        parentOf.set(groupKey, parents);
      }
      measurements.push(...groupMeasurements);

      for (const basisKind of basesFor(subjectKind)) {
        const built = buildPopulations({
          metricId,
          unit: metric.unit,
          subjectKind,
          basisKind,
          measurements: groupMeasurements,
          groupKeyOf: (subjectId) => groupKeyOf(parentOf.get(subjectId) ?? new Set()),
        });
        populations.push(...built.populations);
        judgements.push(...built.judgements);
        findings.push(...built.findings);
      }
    }
  }

  const { flags, findings: flagFindings } = corroborateFlags(judgements);
  findings.push(...flagFindings);
  findings.push(...assertFlagEvidence(flags));

  /* -- counters, then the checks that read them --------------------------- */

  for (const measurement of measurements) {
    if (measurement.measurability === FAIRNESS_MEASURABILITY.MEASURED) {
      meta.measurementsMeasured += 1;
    } else {
      meta.measurementsUnmeasurable += 1;
    }
  }
  meta.fixturesCounted = new Set(
    [...participation.values()].flatMap((entry) =>
      entry.fixtures.map((held) => held.fixture.fixtureId)
    )
  ).size;
  meta.fixturesPlaceholder = classification.placeholderFixtures;
  meta.populationsBuilt = populations.length;
  meta.populationsScored = populations.filter(
    (population) => population.dispersion.state === FAIRNESS_DISPERSION.USABLE
  ).length;
  for (const judgement of judgements) {
    if (judgement.judgement === FAIRNESS_JUDGEMENT.UNDECIDED) meta.judgementsUndecided += 1;
    else meta.judgementsMade += 1;
  }
  meta.flagsRaised = flags.length;
  meta.flagsHeldNarrower = flags.filter((flag) => flag.heldOnNarrowerBasis === true).length;

  findings.push(...summariseUnmeasured(measurements, judgements));
  findings.push(...assertFairnessExercised(meta, metricIds, measurements));

  const status = deriveFairnessStatus(findings);
  assertFairnessFindings(findings, 'the fairness report');

  return {
    question: FAIRNESS_QUESTION.FAIRNESS_REPORT,
    scopeId: classification.scopeId,
    status,
    fixturesByCompetition: classification.byCompetition,
    membership: {
      stated: membership.stated,
      members: membership.members,
      guests: membership.guests,
    },
    measurements,
    populations,
    judgements,
    flags,
    findings,
    meta,
  };
}

/**
 * **Publish every reason a subject went unmeasured, aggregated.**
 *
 * The per-row `reasonCode` on a measurement is the machine-readable answer, and
 * a caller that walks 672 measurements will find it. `findings` is where a human
 * looks, and a report whose findings list says nothing about the 18 teams it
 * could not measure is a report that reads as an all-clear about 140 teams while
 * having judged 122. So each `(metric, reason)` pair and each
 * `(basis, reason)` pair becomes one finding naming its count and, up to a cap,
 * its subjects.
 *
 * The subject list is capped at {@link NAMED_SUBJECT_CAP} because a finding's
 * `details` is meant to be readable; the count is never capped, and
 * `subjectsNamed` says when the list is a sample rather than the whole set.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessMeasurement>} measurements
 * @param {ReadonlyArray<import('./types.js').FairnessJudgement>} judgements
 * @returns {import('./types.js').FairnessFinding[]}
 */
export function summariseUnmeasured(measurements, judgements) {
  /** @type {Map<string, { code: string, subjects: string[], metricId: string|null, basisKind: string|null, subjectKind: string }>} */
  const groups = new Map();

  const add = (code, subjectKind, subjectId, metricId, basisKind) => {
    const key = `${code}|${subjectKind}|${metricId ?? ''}|${basisKind ?? ''}`;
    if (!groups.has(key)) groups.set(key, { code, subjects: [], metricId, basisKind, subjectKind });
    /** @type {{ subjects: string[] }} */ (groups.get(key)).subjects.push(subjectId);
  };

  for (const measurement of measurements) {
    if (measurement.measurability === FAIRNESS_MEASURABILITY.MEASURED) continue;
    add(
      /** @type {string} */ (measurement.reasonCode),
      measurement.subjectKind,
      measurement.subjectId,
      measurement.metricId,
      null
    );
  }
  for (const judgement of judgements) {
    if (judgement.judgement !== FAIRNESS_JUDGEMENT.UNDECIDED) continue;
    if (judgement.basis.groupKey !== null) continue;
    add(
      /** @type {string} */ (judgement.reasonCode),
      judgement.subjectKind,
      judgement.subjectId,
      judgement.metricId,
      judgement.basis.kind
    );
  }

  return [...groups.keys()].sort().map((key) => {
    const group =
      /** @type {{ code: string, subjects: string[], metricId: string|null, basisKind: string|null, subjectKind: string }} */ (
        groups.get(key)
      );
    const subjects = [...new Set(group.subjects)].sort();
    const where = group.metricId ? `on ${group.metricId}` : `under the ${group.basisKind} cohort`;
    return makeFairnessFinding(
      group.code,
      `${subjects.length} ${group.subjectKind} subject(s) could not be measured ${where}: ${group.code}. They carry no value and are not scored zero; a fairness report that omitted them would read as an all-clear about subjects it never looked at`,
      {
        reason: group.code,
        subjectKind: group.subjectKind,
        metricId: group.metricId,
        basisKind: group.basisKind,
        subjectCount: subjects.length,
        subjectsNamed: Math.min(subjects.length, NAMED_SUBJECT_CAP),
        subjects: subjects.slice(0, NAMED_SUBJECT_CAP),
      }
    );
  });
}

/**
 * How many subject ids a summary finding names before it starts counting only.
 *
 * @type {number}
 */
export const NAMED_SUBJECT_CAP = 25;

/**
 * **The meta-assertions.** Each returns a blocking finding, never a silent pass.
 *
 * Exported so a caller can run them over a report it did not build, and so the
 * reachability audit can drive them from public input rather than by reaching
 * inside a returned structure.
 *
 * @param {import('./types.js').FairnessMeta} meta
 * @param {ReadonlyArray<string>} metricIds
 * @param {ReadonlyArray<import('./types.js').FairnessMeasurement>} measurements
 * @returns {import('./types.js').FairnessFinding[]}
 */
export function assertFairnessExercised(meta, metricIds, measurements) {
  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [];

  if (meta.fixturesRead === 0) {
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_NO_FIXTURES_READ,
        'this report read zero fixtures, so every metric in it is a perfect score meaning "I looked at nothing" (incident 4)',
        { fixturesRead: 0 }
      )
    );
  }

  for (const metricId of metricIds) {
    const measured = measurements.filter(
      (measurement) =>
        measurement.metricId === metricId &&
        measurement.measurability === FAIRNESS_MEASURABILITY.MEASURED
    ).length;
    if (measured > 0) continue;
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_METRIC_UNEXERCISED,
        `metric ${metricId} produced a value for zero subjects; a metric that measured nobody and flagged nobody is indistinguishable in the output from one that measured everybody and found nothing wrong`,
        {
          metricId,
          subjectsMeasured: 0,
          subjectsConsidered: measurements.filter(
            (measurement) => measurement.metricId === metricId
          ).length,
        }
      )
    );
  }

  if (meta.judgementsMade === 0) {
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_NOTHING_JUDGED,
        `no subject was judged against any population: ${meta.populationsBuilt} population(s) were built and none supplied a usable scale, so this report cannot say that anybody is being treated equitably`,
        {
          populationsBuilt: meta.populationsBuilt,
          populationsScored: meta.populationsScored,
          judgementsUndecided: meta.judgementsUndecided,
        }
      )
    );
  }

  return findings;
}
