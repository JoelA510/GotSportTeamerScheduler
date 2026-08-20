/**
 * **Requirements 1 and 2.** A person's commitments across *all* their teams, in
 * one sorted timeline — plus the record of which sources that timeline was
 * built from, and a seal that makes "appended after the solve" a `blocking`
 * finding rather than an invisible fact.
 *
 * ## Why a timeline and not pairwise team comparison
 *
 * The model this replaces compares a person's teams *pairwise*: for a coach of
 * teams A and B, take A's games and B's games and judge every cross pair. That
 * is wrong in two directions at once, and both of them arrive the moment one
 * team plays twice in a day:
 *
 * - **False negatives.** A pairwise scan only ever looks at pairs from
 *   *different* teams, so the transition between A's two games — the person
 *   driving from A's 09:00 kickoff at one venue to A's 10:20 kickoff at
 *   another — is never judged at all. Same team, therefore not a pair.
 * - **False positives.** It judges pairs that are not neighbours. With A at
 *   09:00-10:00, A again at 10:30-11:30 and B at 10:45, a pairwise scan
 *   measures the 45 minutes from A's *first* game to B and calls it a travel
 *   shortfall — a journey nobody makes, because the second A game sits between
 *   them. The real problem, that A's second game and B overlap, is a different
 *   finding about a different pair.
 *
 * A timeline has neither failure mode because it asks one question — *what did
 * this person do next?* — and asks it of neighbours in a single sorted list.
 * `tests/people.test.js` runs both models over one constructed day and asserts
 * both answers, because "the timeline is better" is a claim, and a claim with
 * no counter-example is decoration.
 *
 * On the season-2026 corpus the two models cannot disagree, and that is a fact
 * about the corpus rather than a defence of pairwise: no team plays twice on
 * any date, and no person coaches more than two teams, so every person-day
 * holds at most two commitments and "consecutive" and "cross-team" name the
 * same pair. The test asserts that precondition explicitly, so the day a
 * fixture gains a double-header the claim fails loudly instead of quietly
 * ceasing to be true.
 *
 * ## Why a source list and a seal
 *
 * Incident 5 is not "a scrimmage was missing". It is *"scrimmages were appended
 * after solving, so the optimizer never saw one coach's evening commitment and
 * left him a 6.5-hour gap"*. The distinguishing fact is **when**, and a plain
 * array of commitments cannot carry it: a timeline missing its evening looks
 * exactly like a timeline whose evening is genuinely free.
 *
 * So a {@link import('./types.js').TimelineSet} records the sources it was
 * built from, {@link sealTimelines} refuses to seal one whose *required*
 * sources were never ingested, and {@link ingestCommitments} refuses to add to
 * a sealed set. A solver calls {@link requireSealedTimelines} and gets a
 * `blocking` finding instead of a plausible answer.
 *
 * @module people/timeline
 */

import { resolvePolicy } from '../constraints/registry.js';

import {
  COMMITMENT_SOURCES,
  PEOPLE_REASON,
  createPeopleMeta,
  derivePeopleStatus,
  makePeopleFinding,
  mergePeopleMeta,
} from './reasonCodes.js';
import { PersonCommitmentSchema } from './schemas.js';

/** The policy {@link evaluatePersonDays} reads its number from. */
export const MAXIMUM_GAP_POLICY = 'coach-maximum-gap';

/**
 * Order two commitments deterministically: by start, then by end (a known end
 * before an unknown one), then by id.
 *
 * The unknown-end tie-break matters: a commitment whose footprint is unknown
 * cannot be shown to finish before anything, so it sorts last among equals
 * rather than being silently treated as instantaneous.
 *
 * @param {import('./types.js').PersonCommitment} a
 * @param {import('./types.js').PersonCommitment} b
 * @returns {number}
 */
function compareCommitments(a, b) {
  if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
  const aEnd = a.endMinutes === null ? Number.POSITIVE_INFINITY : a.endMinutes;
  const bEnd = b.endMinutes === null ? Number.POSITIVE_INFINITY : b.endMinutes;
  if (aEnd !== bEnd) return aEnd - bEnd;
  return a.id.localeCompare(b.id);
}

/**
 * An empty, unsealed timeline set.
 *
 * @returns {import('./types.js').TimelineSet}
 */
export function createTimelineSet() {
  return {
    byPerson: new Map(),
    sources: Object.freeze([]),
    requiredSources: Object.freeze([]),
    sealed: false,
    findings: [],
    meta: createPeopleMeta(),
    status: derivePeopleStatus([]),
  };
}

/**
 * Ingest one batch of commitments from one named source.
 *
 * Returns a **new** set; the input is never mutated. Two refusals:
 *
 * - a sealed set reports {@link PEOPLE_REASON.TIMELINE_SEALED_APPEND} and
 *   ingests nothing — this is incident 5's sentence, made a `blocking` finding;
 * - a batch that carries a different `source` than the one declared throws,
 *   because a mislabelled batch is a producer bug and silently believing the
 *   label would put a scrimmage on the timeline as a club fixture.
 *
 * An **empty** batch is not an error, but it is reported:
 * {@link PEOPLE_REASON.TIMELINE_SOURCE_EMPTY} is the difference between "we
 * read the scrimmage file" and "the scrimmage file had rows in it", which is
 * incident 4 at the ingestion seam.
 *
 * @param {import('./types.js').TimelineSet} set
 * @param {ReadonlyArray<Object>} commitments
 * @param {{ source: string }} options
 * @returns {import('./types.js').TimelineSet}
 */
export function ingestCommitments(set, commitments, options) {
  const { source } = options;
  if (!(/** @type {string[]} */ (COMMITMENT_SOURCES).includes(source))) {
    throw new Error(
      `people: "${source}" is not a commitment source; expected one of ${COMMITMENT_SOURCES.join(', ')}`
    );
  }

  const meta = mergePeopleMeta(createPeopleMeta(), set.meta);
  const findings = [...set.findings];

  if (set.sealed) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.TIMELINE_SEALED_APPEND,
        `${commitments.length} commitment(s) from source "${source}" were offered to a sealed timeline set; this is the shape of incident 5 — a commitment that arrives after the schedule is decided is a commitment the schedule never saw`,
        { source, offered: commitments.length, sources: [...set.sources] }
      )
    );
    return {
      ...set,
      findings,
      status: derivePeopleStatus(findings),
    };
  }

  /** @type {Map<string, import('./types.js').PersonCommitment[]>} */
  const byPerson = new Map();
  for (const [personId, entries] of set.byPerson) byPerson.set(personId, [...entries]);

  let ingested = 0;
  for (const raw of commitments) {
    const declared = /** @type {{ source?: string }} */ (raw).source;
    if (declared !== undefined && declared !== source) {
      throw new Error(
        `people: commitment "${/** @type {{ id?: string }} */ (raw).id}" declares source "${declared}" but was ingested as "${source}"`
      );
    }
    const parsed = /** @type {import('./types.js').PersonCommitment} */ (
      PersonCommitmentSchema.parse({ ...raw, source })
    );
    if (!byPerson.has(parsed.personId)) byPerson.set(parsed.personId, []);
    /** @type {import('./types.js').PersonCommitment[]} */ (byPerson.get(parsed.personId)).push(
      Object.freeze(parsed)
    );
    ingested += 1;
  }

  if (ingested === 0) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.TIMELINE_SOURCE_EMPTY,
        `source "${source}" was ingested and contributed zero commitments; "we read it" and "it had rows" are different claims`,
        { source }
      )
    );
  }

  /** @type {Map<string, ReadonlyArray<import('./types.js').PersonCommitment>>} */
  const sorted = new Map();
  for (const [personId, entries] of [...byPerson.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    sorted.set(
      personId,
      Object.freeze(
        [...entries].sort((a, b) =>
          a.date === b.date ? compareCommitments(a, b) : a.date.localeCompare(b.date)
        )
      )
    );
  }

  const sources = [...new Set([...set.sources, source])].sort();
  meta.commitmentsIngested += ingested;
  meta.sourcesDeclared = sources.length;
  meta.timelinesBuilt = sorted.size;

  return {
    byPerson: sorted,
    sources: Object.freeze(sources),
    requiredSources: set.requiredSources,
    sealed: false,
    findings,
    meta,
    status: derivePeopleStatus(findings),
  };
}

/**
 * Seal the set: no more commitments, and state what it was required to hold.
 *
 * A required source that was never ingested is
 * {@link PEOPLE_REASON.TIMELINE_SOURCE_NOT_INGESTED} — `blocking`, and the
 * whole point of requirement 2. The set is still sealed, because sealing is
 * what makes the omission permanent and therefore visible; a caller that
 * refused to seal would leave the same partial timeline in circulation with
 * nothing recorded about it.
 *
 * @param {import('./types.js').TimelineSet} set
 * @param {{ requiredSources?: ReadonlyArray<string> }} [options]
 * @returns {import('./types.js').TimelineSet}
 */
export function sealTimelines(set, options = {}) {
  const requiredSources = [...new Set(options.requiredSources ?? [])].sort();
  for (const source of requiredSources) {
    if (!(/** @type {string[]} */ (COMMITMENT_SOURCES).includes(source))) {
      throw new Error(
        `people: "${source}" is not a commitment source; expected one of ${COMMITMENT_SOURCES.join(', ')}`
      );
    }
  }

  const findings = [...set.findings];
  const meta = mergePeopleMeta(createPeopleMeta(), set.meta);
  meta.sourcesRequired = requiredSources.length;

  for (const source of requiredSources) {
    if (set.sources.includes(source)) continue;
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.TIMELINE_SOURCE_NOT_INGESTED,
        `source "${source}" was required and never ingested; the timelines below are missing every commitment it carries, and a schedule built on them cannot have taken those commitments into account`,
        { source, ingestedSources: [...set.sources], requiredSources }
      )
    );
  }

  return {
    ...set,
    requiredSources: Object.freeze(requiredSources),
    sealed: true,
    findings,
    meta,
    status: derivePeopleStatus(findings),
  };
}

/**
 * The findings a consumer that requires a complete timeline should refuse on.
 *
 * Returns a list rather than throwing, so a caller can report the reason
 * alongside everything else it found instead of losing the run.
 *
 * @param {import('./types.js').TimelineSet} set
 * @returns {import('./types.js').PeopleFinding[]}
 */
export function requireSealedTimelines(set) {
  if (set.sealed) {
    // Both refusals, not just the missing source: a set that was sealed and
    // then had commitments offered to it is a set somebody tried to complete
    // after the fact, and a consumer must see that as clearly as one that was
    // never completed at all.
    /** @type {Set<string>} */
    const refusals = new Set([
      PEOPLE_REASON.TIMELINE_SOURCE_NOT_INGESTED,
      PEOPLE_REASON.TIMELINE_SEALED_APPEND,
    ]);
    return set.findings.filter((finding) => refusals.has(finding.code));
  }
  return [
    makePeopleFinding(
      PEOPLE_REASON.TIMELINE_NOT_SEALED,
      `these timelines were built from ${set.sources.length} source(s) and never sealed, so nothing states what they were required to contain`,
      { sources: [...set.sources] }
    ),
  ];
}

/**
 * One person's whole timeline, sorted, across every team and every source.
 *
 * @param {import('./types.js').TimelineSet} set
 * @param {string} personId
 * @returns {ReadonlyArray<import('./types.js').PersonCommitment>}
 */
export function personTimeline(set, personId) {
  return set.byPerson.get(personId) ?? Object.freeze([]);
}

/**
 * Split a set into person-days, each with its **consecutive** transitions.
 *
 * @param {import('./types.js').TimelineSet} set
 * @returns {Array<import('./types.js').PersonDay>}
 */
export function buildPersonDays(set) {
  /** @type {Array<import('./types.js').PersonDay>} */
  const days = [];
  for (const [personId, entries] of [...set.byPerson.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    /** @type {Map<string, import('./types.js').PersonCommitment[]>} */
    const byDate = new Map();
    for (const commitment of entries) {
      if (!byDate.has(commitment.date)) byDate.set(commitment.date, []);
      /** @type {import('./types.js').PersonCommitment[]} */ (byDate.get(commitment.date)).push(
        commitment
      );
    }

    for (const [date, sameDay] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const commitments = [...sameDay].sort(compareCommitments);
      /** @type {import('./types.js').PersonTransition[]} */
      const transitions = [];
      for (let index = 0; index < commitments.length - 1; index += 1) {
        const from = commitments[index];
        const to = commitments[index + 1];
        transitions.push(
          Object.freeze({
            id: `${personId}|${date}|${from.id}->${to.id}`,
            personId,
            date,
            from,
            to,
            gapMinutes: from.endMinutes === null ? null : to.startMinutes - from.endMinutes,
            sameTeam: from.teamId !== null && from.teamId === to.teamId,
          })
        );
      }

      const last = commitments[commitments.length - 1];
      const lastEndMinutes = last.endMinutes;
      const measurableGaps = transitions
        .map((transition) => transition.gapMinutes)
        .filter((gap) => gap !== null && gap > 0);

      days.push({
        id: `${personId}|${date}`,
        personId,
        date,
        commitments: Object.freeze(commitments),
        firstStartMinutes: commitments[0].startMinutes,
        lastEndMinutes,
        spanMinutes: lastEndMinutes === null ? null : lastEndMinutes - commitments[0].startMinutes,
        transitions: Object.freeze(transitions),
        idleMinutes: transitions.some((transition) => transition.gapMinutes === null)
          ? null
          : measurableGaps.reduce((sum, gap) => sum + /** @type {number} */ (gap), 0),
        findings: [],
        status: derivePeopleStatus([]),
      });
    }
  }
  return days;
}

/**
 * Judge every person-day: unknown footprints, and gaps against the
 * maximum-gap policy the registry carries.
 *
 * The number comes from the constraint record through `resolvePolicy()`, and
 * the severity comes from that record's `type` — so the seeded
 * `preference`-typed `coach-maximum-gap` makes a long hole an `info` the
 * optimiser should shorten, and retyping the record to `soft` makes the
 * identical hole a `compromise`, with no edit here. That is GAP-12 doing its
 * job, and it is why this module registers no severity of its own for the code.
 *
 * @param {import('./types.js').TimelineSet} set
 * @param {{ registry: import('../constraints/types.js').ConstraintRegistry }} options
 * @returns {{ days: Array<import('./types.js').PersonDay>, findings: import('./types.js').PeopleFinding[], meta: import('./types.js').PeopleMeta, status: string }}
 */
export function evaluatePersonDays(set, options) {
  const { registry } = options;
  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const scanFindings = [];
  const days = buildPersonDays(set);

  /** @type {Map<string, import('../constraints/types.js').ResolvedPolicy>} */
  const cache = new Map();
  /**
   * @param {string} date
   * @param {string} personId
   * @returns {import('../constraints/types.js').ResolvedPolicy}
   */
  const resolve = (date, personId) => {
    const key = `${date}|${personId}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const resolved = resolvePolicy(registry, MAXIMUM_GAP_POLICY, { date, personId });
    meta.gapPoliciesResolved += 1;
    scanFindings.push(...resolved.findings);
    cache.set(key, resolved);
    return resolved;
  };

  for (const day of days) {
    meta.personDaysExamined += 1;
    meta.commitmentsExamined += day.commitments.length;
    /** @type {import('./types.js').PeopleFinding[]} */
    const findings = [];

    for (const commitment of day.commitments) {
      if (commitment.endMinutes !== null) continue;
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.COMMITMENT_FOOTPRINT_UNKNOWN,
          `commitment "${commitment.id}" has no known end, so the shape of "${day.personId}"'s day on ${day.date} cannot be measured past it`,
          {
            personDayId: day.id,
            personId: day.personId,
            date: day.date,
            commitmentId: commitment.id,
            source: commitment.source,
          }
        )
      );
    }

    const judged = day.transitions.filter((transition) => transition.gapMinutes !== null);
    meta.transitionsExamined += day.transitions.length;
    meta.transitionsJudged += judged.length;

    if (judged.length > 0) {
      const resolved = resolve(day.date, day.personId);
      const record = resolved.effective;
      const maximum =
        record && typeof record.parameters.maximumGapMinutes === 'number'
          ? record.parameters.maximumGapMinutes
          : null;

      if (maximum === null) {
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.PERSON_DAY_GAP_UNGOVERNED,
            `no constraint record gives policy "${MAXIMUM_GAP_POLICY}" a maximum here, so the ${judged.length} measurable gap(s) in "${day.personId}"'s day on ${day.date} cannot be judged`,
            {
              personDayId: day.id,
              personId: day.personId,
              date: day.date,
              policy: MAXIMUM_GAP_POLICY,
              transitionsJudged: judged.length,
            }
          )
        );
      } else {
        for (const transition of judged) {
          const gapMinutes = /** @type {number} */ (transition.gapMinutes);
          if (gapMinutes <= maximum) continue;
          findings.push(
            makePeopleFinding(
              PEOPLE_REASON.PERSON_DAY_GAP_EXCEEDED,
              `"${day.personId}" waits ${gapMinutes} minutes on ${day.date} between "${transition.from.id}" and "${transition.to.id}"; policy "${MAXIMUM_GAP_POLICY}" allows ${maximum}`,
              {
                personDayId: day.id,
                transitionId: transition.id,
                personId: day.personId,
                date: day.date,
                policy: MAXIMUM_GAP_POLICY,
                constraintId: record.id,
                constraintType: record.type,
                gapMinutes,
                maximumGapMinutes: maximum,
                excessMinutes: gapMinutes - maximum,
                fromId: transition.from.id,
                toId: transition.to.id,
                fromSource: transition.from.source,
                toSource: transition.to.source,
              },
              record
            )
          );
        }
      }
    }

    day.findings = findings;
    day.status = derivePeopleStatus(findings);
  }

  if (meta.personDaysExamined === 0) {
    scanFindings.push(
      makePeopleFinding(
        PEOPLE_REASON.TIMELINE_SCAN_VACUOUS,
        `the timeline scan examined zero person-days across ${set.byPerson.size} timeline(s), so it has said nothing about anybody's day`,
        { timelines: set.byPerson.size, sources: [...set.sources] }
      )
    );
  }

  const findings = [...scanFindings, ...days.flatMap((day) => day.findings)];
  return { days, findings, meta, status: derivePeopleStatus(findings) };
}

/**
 * Every pair of commitments one person cannot both keep.
 *
 * **Not** a consecutive-pair scan, and deliberately so. Gaps are a question
 * about neighbours; overlap is a question about intervals, and a
 * neighbours-only sweep misses a long commitment that straddles two short ones
 * — the same shape of blind spot as pairwise team comparison, one level down.
 * Person-days are small (this corpus's largest holds two commitments), so the
 * within-day all-pairs comparison costs nothing and cannot be wrong.
 *
 * A commitment of unknown footprint cannot be shown to overlap anything and is
 * skipped here; {@link evaluatePersonDays} reports it as
 * {@link PEOPLE_REASON.COMMITMENT_FOOTPRINT_UNKNOWN} rather than letting it
 * pass silently.
 *
 * @param {import('./types.js').TimelineSet} set
 * @returns {Array<import('./types.js').AttendanceClash>}
 */
export function findAttendanceClashes(set) {
  /** @type {Array<import('./types.js').AttendanceClash>} */
  const clashes = [];
  for (const day of buildPersonDays(set)) {
    const commitments = day.commitments;
    for (let i = 0; i < commitments.length; i += 1) {
      const from = commitments[i];
      if (from.endMinutes === null) continue;
      for (let j = i + 1; j < commitments.length; j += 1) {
        const to = commitments[j];
        if (to.startMinutes >= from.endMinutes) continue;
        const toEnd = to.endMinutes === null ? to.startMinutes : to.endMinutes;
        clashes.push(
          Object.freeze({
            id: `${day.personId}|${day.date}|${from.id}><${to.id}`,
            personId: day.personId,
            date: day.date,
            from,
            to,
            overlapMinutes: Math.min(from.endMinutes, toEnd) - to.startMinutes,
          })
        );
      }
    }
  }
  return clashes;
}

/**
 * The same commitments in the shape `evaluateCoachTravel()` accepts.
 *
 * `source` is dropped because `CoachCommitmentSchema` is `.strict()` and knows
 * nothing about sources — which is correct: whether a gap is long enough to
 * drive is not a question about where the row came from. This is the seam that
 * lets Prompt 2.2's travel evaluator judge a *complete* timeline without being
 * rewritten: it was already person-centric and already consecutive-pair, and
 * what it lacked was somebody to build the list.
 *
 * @param {import('./types.js').TimelineSet} set
 * @returns {Array<Object>}
 */
export function toTravelCommitments(set) {
  /** @type {Array<Object>} */
  const out = [];
  for (const entries of set.byPerson.values()) {
    for (const commitment of entries) {
      const { source, ...rest } = commitment;
      void source;
      out.push(rest);
    }
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
