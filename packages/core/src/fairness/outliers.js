/**
 * **Judging a subject against a population, and publishing what decided it.**
 *
 * ## The rule this file exists to keep
 *
 * *Every flag carries its evidence and its comparison basis.* A flag that says
 * "this team is an outlier" and nothing else is unusable — it cannot be checked,
 * argued with, or acted on, and the reader has no way to tell a real inequity
 * from a property of how the fixture list is written. So a
 * {@link FairnessJudgement} carries, always: the metric and its unit, the
 * cohort it was judged in and that cohort's size, the value, the cohort's centre
 * and scale, the deviation in the metric's own units, the score, the threshold
 * that score was compared against, and the fixture counts behind the value.
 * {@link assertFlagEvidence} enforces it on every flag before the report is
 * sealed, and raises a **blocking** finding rather than shipping a flag that
 * cannot be checked.
 *
 * This is the direct sibling of the feasibility layer's binding-constraint rule,
 * and it is here for the same reason: 7.1's two worst defects were both answers
 * that sealed a verdict on evidence they did not publish.
 *
 * ## The comparison basis, and why the widest one is a trap
 *
 * A team is judged in three cohorts, from narrowest to widest: its **division**,
 * its **age group**, and the whole **season**. They are not interchangeable, and
 * the season-2026 corpus demonstrates the failure precisely.
 *
 * Ask *"which teams have an unusual mean kickoff?"* against the whole season and
 * eight teams are flagged. All eight are U09, U10 or U12 sides, and the reason
 * they average a later kickoff than the season median is that the club schedules
 * its five-year-olds in the morning and its twelve-year-olds in the afternoon.
 * That is the age structure of the day, not inequity, and a report that presents
 * it as inequity is worse than no report. Ask the same question against each
 * team's own division and **one** flag survives.
 *
 * The module does not hard-code which metrics are confounded by which cohort,
 * because that table would be wrong the first time a club schedules differently.
 * It detects it: a flag records
 * {@link FairnessJudgement.heldOnNarrowerBasis}, and a flag that does **not**
 * hold on a strictly narrower cohort raises `FAIRNESS_BASIS_WIDER_ONLY`. Seven
 * of the eight season-wide flags carry it; the eighth, `09G7v706`, also flags
 * inside U09G and does not.
 *
 * `heldOnNarrowerBasis` is three-valued for the reason everything in this
 * package is: `null` means no narrower cohort reached a judgement about this
 * subject at all, which is not the same as one that reached "typical".
 *
 * ## Divisions and age groups are measured and mostly not judged
 *
 * A division is judged against the other divisions of its own age group, and an
 * age group against the season's age groups. On this corpus every one of those
 * division cohorts has **two** members, so all of them come back
 * `FAIRNESS_POPULATION_TOO_SMALL` and no division is judged. That is the honest
 * answer and it is reported as one: the module says "these seven cohorts could
 * not be judged, and here is why", rather than "no division outliers found".
 *
 * @module fairness/outliers
 */

import { describeDispersion, modifiedZScore } from './dispersion.js';
import { FAIRNESS_SUBJECT_KIND } from './metrics.js';
import {
  FAIRNESS_DIRECTION,
  FAIRNESS_DISPERSION,
  FAIRNESS_JUDGEMENT,
  FAIRNESS_MEASURABILITY,
  FAIRNESS_REASON,
  deriveFairnessJudgement,
  dispersionFinding,
  makeFairnessFinding,
} from './reasonCodes.js';

/**
 * The cohorts a subject can be judged in.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_BASIS = Object.freeze({
  /** Peers sharing the subject's division label. */
  DIVISION: 'division',
  /** Peers sharing the subject's age group. */
  AGE_GROUP: 'age-group',
  /** Every peer of the same kind in the scope. */
  SEASON: 'season',
});

/**
 * How wide each cohort is. Lower is narrower, and narrower is more trustworthy:
 * the members of a division are scheduled under one set of rules, and the
 * members of a season are not.
 *
 * A frozen table with one row per member, read by {@link narrowerBases}, for the
 * reason every other table in this repository is one — the alternative is an
 * ordering re-derived at each call site, which is free to disagree with itself.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const FAIRNESS_BASIS_WIDTH = Object.freeze({
  [FAIRNESS_BASIS.DIVISION]: 0,
  [FAIRNESS_BASIS.AGE_GROUP]: 1,
  [FAIRNESS_BASIS.SEASON]: 2,
});

/** Declared order, narrowest first, for deterministic rendering. */
export const FAIRNESS_BASIS_ORDER = Object.freeze(
  Object.keys(FAIRNESS_BASIS_WIDTH).sort(
    (a, b) => FAIRNESS_BASIS_WIDTH[a] - FAIRNESS_BASIS_WIDTH[b]
  )
);

/**
 * Which cohorts apply to a subject kind.
 *
 * A division is not judged among all divisions of the season: division sizes and
 * age brackets differ, so that cohort measures enrolment and the calendar rather
 * than equity. It is judged among the divisions of its own age group — the
 * comparison a club actually means when it asks whether one division is getting
 * the worse end of the day.
 *
 * @param {string} subjectKind - a {@link FAIRNESS_SUBJECT_KIND} value
 * @returns {ReadonlyArray<string>}
 */
export function basesFor(subjectKind) {
  switch (subjectKind) {
    case FAIRNESS_SUBJECT_KIND.TEAM:
      return FAIRNESS_BASIS_ORDER;
    case FAIRNESS_SUBJECT_KIND.DIVISION:
      return Object.freeze([FAIRNESS_BASIS.AGE_GROUP]);
    case FAIRNESS_SUBJECT_KIND.AGE_GROUP:
      return Object.freeze([FAIRNESS_BASIS.SEASON]);
    default:
      throw new Error(
        `fairness: subject kind ${JSON.stringify(subjectKind)} has no declared comparison bases`
      );
  }
}

/**
 * The bases strictly narrower than this one.
 *
 * @param {string} basisKind
 * @returns {ReadonlyArray<string>}
 */
export function narrowerBases(basisKind) {
  const width = FAIRNESS_BASIS_WIDTH[basisKind];
  if (width === undefined) {
    throw new Error(`fairness: basis ${JSON.stringify(basisKind)} has no declared width`);
  }
  return FAIRNESS_BASIS_ORDER.filter((basis) => FAIRNESS_BASIS_WIDTH[basis] < width);
}

/**
 * **Build every population for one metric and one basis, and judge its members.**
 *
 * Subjects with no key for this basis are not quietly dropped: each gets a
 * judgement of `undecided` carrying `groupKeyOf()`'s own reason, which is how
 * the report can say *"the four Minis sides were not judged by age group,
 * because division `BB` parses to no age group"* instead of showing 118 rows
 * where 122 were expected and leaving the reader to notice.
 *
 * @param {{
 *   metricId: string,
 *   unit: string,
 *   subjectKind: string,
 *   basisKind: string,
 *   measurements: ReadonlyArray<import('./types.js').FairnessMeasurement>,
 *   groupKeyOf: (subjectId: string) => { key: string|null, reasonCode: string|null },
 * }} input
 * @returns {{ populations: import('./types.js').FairnessPopulation[], judgements: import('./types.js').FairnessJudgement[], findings: import('./types.js').FairnessFinding[] }}
 */
export function buildPopulations(input) {
  const { metricId, unit, subjectKind, basisKind, measurements } = input;

  /** @type {Map<string, import('./types.js').FairnessMeasurement[]>} */
  const groups = new Map();
  /** @type {import('./types.js').FairnessJudgement[]} */
  const judgements = [];
  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [];

  for (const measurement of measurements) {
    const group =
      basisKind === FAIRNESS_BASIS.SEASON
        ? { key: FAIRNESS_BASIS.SEASON, reasonCode: null }
        : input.groupKeyOf(measurement.subjectId);
    if (group.key === null) {
      if (group.reasonCode === null) {
        // `groupKeyOf()` returns a key or a reason, never neither. A silent
        // third arrangement here would be an unjudged subject with nothing
        // saying why, which is the shape this module exists to make impossible.
        throw new Error(
          `fairness: ${measurement.subjectKind} ${JSON.stringify(measurement.subjectId)} has no ${basisKind} key and no reason for it`
        );
      }
      judgements.push(
        undecided(
          measurement,
          unit,
          { kind: basisKind, groupKey: null, populationSize: 0 },
          group.reasonCode,
          null
        )
      );
      continue;
    }
    if (!groups.has(group.key)) groups.set(group.key, []);
    /** @type {import('./types.js').FairnessMeasurement[]} */ (groups.get(group.key)).push(
      measurement
    );
  }

  /** @type {import('./types.js').FairnessPopulation[]} */
  const populations = [];

  for (const groupKey of [...groups.keys()].sort()) {
    const members = /** @type {import('./types.js').FairnessMeasurement[]} */ (
      groups.get(groupKey)
    );
    const measured = members.filter(
      (member) => member.measurability === FAIRNESS_MEASURABILITY.MEASURED
    );
    const dispersion = describeDispersion(
      metricId,
      measured.map((member) => ({
        subjectId: member.subjectId,
        value: /** @type {number} */ (member.value),
      }))
    );
    const basis = { kind: basisKind, groupKey, populationSize: measured.length };

    const finding = dispersionFinding(dispersion, {
      kind: basisKind,
      groupKind: basisKind,
      groupKey,
    });
    if (finding !== null) findings.push(finding);

    populations.push({
      metricId,
      unit,
      subjectKind,
      basisKind,
      groupKey,
      dispersion,
      memberIds: Object.freeze(measured.map((member) => member.subjectId).sort()),
      undecidedMemberIds: Object.freeze(
        members
          .filter((member) => member.measurability !== FAIRNESS_MEASURABILITY.MEASURED)
          .map((member) => member.subjectId)
          .sort()
      ),
    });

    for (const member of members) {
      if (member.measurability !== FAIRNESS_MEASURABILITY.MEASURED) {
        judgements.push(
          undecided(member, unit, basis, /** @type {string} */ (member.reasonCode), dispersion)
        );
        continue;
      }
      const value = /** @type {number} */ (member.value);
      const score = modifiedZScore(value, dispersion);
      const judgement = deriveFairnessJudgement({
        measurability: member.measurability,
        dispersion: dispersion.state,
        score,
        threshold: dispersion.threshold,
      });
      judgements.push({
        metricId,
        unit,
        subjectKind,
        subjectId: member.subjectId,
        basis,
        judgement,
        dispersionState: dispersion.state,
        value,
        centre: dispersion.centre,
        scale: dispersion.scale,
        deviation: dispersion.centre === null ? null : value - dispersion.centre,
        score,
        threshold: dispersion.threshold,
        direction:
          dispersion.centre === null || value === dispersion.centre
            ? null
            : value > dispersion.centre
              ? FAIRNESS_DIRECTION.ABOVE
              : FAIRNESS_DIRECTION.BELOW,
        reasonCode:
          judgement === FAIRNESS_JUDGEMENT.UNDECIDED
            ? (dispersionReasonOf(dispersion) ?? FAIRNESS_REASON.FAIRNESS_POPULATION_TOO_SMALL)
            : null,
        heldOnNarrowerBasis: null,
        evidence: member.evidence,
      });
    }
  }

  return { populations, judgements, findings };
}

/**
 * The reason code a non-usable dispersion state leaves on a judgement.
 *
 * @param {import('./types.js').FairnessDispersion} dispersion
 * @returns {string|null}
 */
function dispersionReasonOf(dispersion) {
  if (dispersion.state === FAIRNESS_DISPERSION.DEGENERATE) {
    return FAIRNESS_REASON.FAIRNESS_DISPERSION_DEGENERATE;
  }
  if (dispersion.state === FAIRNESS_DISPERSION.INSUFFICIENT) {
    return FAIRNESS_REASON.FAIRNESS_POPULATION_TOO_SMALL;
  }
  return null;
}

/**
 * An `undecided` judgement, built once so no call site can forget the reason.
 *
 * @param {import('./types.js').FairnessMeasurement} measurement
 * @param {string} unit
 * @param {{ kind: string, groupKey: string|null, populationSize: number }} basis
 * @param {string} reasonCode
 * @param {import('./types.js').FairnessDispersion|null} dispersion
 * @returns {import('./types.js').FairnessJudgement}
 */
function undecided(measurement, unit, basis, reasonCode, dispersion) {
  return {
    metricId: measurement.metricId,
    unit,
    subjectKind: measurement.subjectKind,
    subjectId: measurement.subjectId,
    basis,
    judgement: FAIRNESS_JUDGEMENT.UNDECIDED,
    dispersionState: dispersion === null ? null : dispersion.state,
    value: measurement.value,
    centre: dispersion === null ? null : dispersion.centre,
    scale: dispersion === null ? null : dispersion.scale,
    deviation: null,
    score: null,
    threshold: dispersion === null ? null : dispersion.threshold,
    direction: null,
    reasonCode,
    heldOnNarrowerBasis: null,
    evidence: measurement.evidence,
  };
}

/**
 * **Corroborate every flag against the narrower cohorts, in place.**
 *
 * For each `outlier`, look for a judgement about the same subject and metric on
 * a strictly narrower basis. Three outcomes, and the third is not the second:
 *
 * - `true` — a narrower cohort agrees. The flag stands on its own.
 * - `false` — a narrower cohort judged this subject `typical`. The deviation is
 *   at least partly a property of the wider cohort's mix, and
 *   `FAIRNESS_BASIS_WIDER_ONLY` says so.
 * - `null` — no narrower cohort reached a judgement, so nothing corroborates or
 *   contradicts it. Reported as `null` and never as `false`.
 *
 * @param {import('./types.js').FairnessJudgement[]} judgements - mutated in place
 * @returns {{ flags: import('./types.js').FairnessJudgement[], findings: import('./types.js').FairnessFinding[] }}
 */
export function corroborateFlags(judgements) {
  /** @type {Map<string, import('./types.js').FairnessJudgement>} */
  const byKey = new Map();
  for (const judgement of judgements) {
    byKey.set(
      `${judgement.metricId}|${judgement.subjectKind}|${judgement.subjectId}|${judgement.basis.kind}`,
      judgement
    );
  }

  /** @type {import('./types.js').FairnessJudgement[]} */
  const flags = [];
  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [];

  for (const judgement of judgements) {
    if (judgement.judgement !== FAIRNESS_JUDGEMENT.OUTLIER) continue;
    /** @type {boolean|null} */
    let held = null;
    for (const basis of narrowerBases(judgement.basis.kind)) {
      const narrower = byKey.get(
        `${judgement.metricId}|${judgement.subjectKind}|${judgement.subjectId}|${basis}`
      );
      if (!narrower || narrower.judgement === FAIRNESS_JUDGEMENT.UNDECIDED) continue;
      held = narrower.judgement === FAIRNESS_JUDGEMENT.OUTLIER;
      if (held) break;
    }
    judgement.heldOnNarrowerBasis = held;
    flags.push(judgement);

    findings.push(
      makeFairnessFinding(
        judgement.direction === FAIRNESS_DIRECTION.ABOVE
          ? FAIRNESS_REASON.FAIRNESS_OUTLIER_HIGH
          : FAIRNESS_REASON.FAIRNESS_OUTLIER_LOW,
        `${judgement.subjectKind} ${judgement.subjectId}: ${judgement.metricId} is ${round(judgement.value)} ${judgement.unit} against a ${judgement.basis.kind} cohort of ${judgement.basis.populationSize} centred on ${round(judgement.centre)} (typical spread ${round(judgement.scale)}); that is ${round(judgement.deviation)} ${judgement.unit} ${judgement.direction} the centre, a modified z-score of ${round(judgement.score)} against a threshold of ${judgement.threshold}`,
        {
          metricId: judgement.metricId,
          unit: judgement.unit,
          subjectKind: judgement.subjectKind,
          subjectId: judgement.subjectId,
          basisKind: judgement.basis.kind,
          groupKey: judgement.basis.groupKey,
          populationSize: judgement.basis.populationSize,
          value: judgement.value,
          centre: judgement.centre,
          scale: judgement.scale,
          deviation: judgement.deviation,
          score: judgement.score,
          threshold: judgement.threshold,
          fixturesCounted: judgement.evidence.fixturesCounted,
          fixturesExcluded: judgement.evidence.fixturesExcluded,
        }
      )
    );

    if (held === false) {
      findings.push(
        makeFairnessFinding(
          FAIRNESS_REASON.FAIRNESS_BASIS_WIDER_ONLY,
          `${judgement.subjectKind} ${judgement.subjectId} is an outlier on ${judgement.metricId} against the ${judgement.basis.kind} cohort but is typical inside a narrower one, so the deviation may be a property of the wider cohort's mix rather than of this subject; the narrower cohort is the one whose members are scheduled under one set of rules`,
          {
            metricId: judgement.metricId,
            subjectKind: judgement.subjectKind,
            subjectId: judgement.subjectId,
            basisKind: judgement.basis.kind,
            narrowerBases: [...narrowerBases(judgement.basis.kind)],
          }
        )
      );
    }
  }

  return { flags, findings };
}

/**
 * **The guard: no flag leaves this module without the evidence a flag owes.**
 *
 * Returns a **blocking** finding per offending flag rather than throwing,
 * because the report is the place a reader will look and a thrown error at the
 * call site tells them nothing. The list of required fields is spelled out here
 * rather than implied by whatever the builder happened to set, so a future
 * builder that stops setting one fails this check instead of shipping a flag
 * that cannot be checked.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessJudgement>} flags
 * @returns {import('./types.js').FairnessFinding[]}
 */
export function assertFlagEvidence(flags) {
  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [];
  const required = ['value', 'centre', 'scale', 'deviation', 'score', 'threshold', 'direction'];
  for (const flag of flags) {
    const missing = required.filter((field) => flag[field] === null || flag[field] === undefined);
    if (flag.basis.groupKey === null) missing.push('basis.groupKey');
    if (!(flag.basis.populationSize > 0)) missing.push('basis.populationSize');
    if (!flag.evidence || !(flag.evidence.fixturesCounted > 0))
      missing.push('evidence.fixturesCounted');
    if (missing.length === 0) continue;
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_FLAG_EVIDENCE_MISSING,
        `${flag.subjectKind} ${flag.subjectId} is flagged on ${flag.metricId} without ${missing.join(', ')}; a flag that does not publish what it was measured against cannot be checked and must not be reported`,
        {
          metricId: flag.metricId,
          subjectKind: flag.subjectKind,
          subjectId: flag.subjectId,
          basisKind: flag.basis.kind,
          missing,
        }
      )
    );
  }
  return findings;
}

/**
 * Six significant figures, for message text only. Never used in a comparison.
 *
 * @param {number|null} value
 * @returns {string}
 */
function round(value) {
  if (value === null) return 'null';
  return String(Math.round(value * 1e4) / 1e4);
}
