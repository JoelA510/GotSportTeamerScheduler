/**
 * **Requirement 5.** Fuzzy identity resolution that **proposes and never
 * merges**.
 *
 * ## What went wrong, and what the fix has to be
 *
 * Incident 6: across two roster revisions one person's given name appears once
 * in full and once in its shortened form, `Person Key` is a lower-cased name
 * string derived from it, and so the earlier revision carries 197 identities
 * where there are 196 people. The split identity hid a real two-team coaching
 * link — and that person is the sole coach of both teams, so the link that was
 * hidden had no fallback behind it.
 *
 * No name from that incident appears anywhere in this file, and
 * `tests/people.test.js` asserts it: it greps every source file under
 * `packages/core/src/people/` for all 329 person keys, display names and team
 * codes in the two roster revisions and requires zero hits. A matcher that
 * knows the answer is not a matcher.
 *
 * The obvious fix is the wrong one. Auto-merging on a name heuristic is how two
 * genuinely different people with one surname become one person, and this
 * corpus has 53 shared surnames and 205 same-surname pairs to do it with. So
 * this module **scores and queues**. A merge exists only because a human moved
 * a queue entry to `accepted`, and {@link applyIdentityDecisions} is the only
 * function here that produces one.
 *
 * ## The mechanism is general; the corpus pair falls out of it
 *
 * Nothing here mentions a given name, a nickname table, or a person. The
 * signals are statements about two strings and two assignment sets:
 *
 * - the family names are identical once normalised (the blocking key);
 * - the shorter given name is a **subsequence** of the longer, shares its first
 *   letter and is strictly shorter — the general shape of a hypocorism formed
 *   by deletion, the family that contains Tom/Thomas, Kate/Katherine,
 *   Dan/Daniel and Ben/Benjamin;
 * - the given names share a prefix of at least three characters;
 * - Jaro-Winkler similarity of the given names, as a strength rather than a
 *   gate;
 * - the two identities coach no team in common.
 *
 * On `coach_roster.csv` that machinery proposes **nothing**: not one of the 205
 * same-surname pairs is a contraction, has a three-character shared prefix, or
 * reaches the 0.85 similarity gate (the highest is 0.783). On
 * `coach_roster_v1.csv` it proposes exactly one pair. That is the mechanism
 * discriminating, not a threshold fitted to a known answer — and
 * `tests/people.test.js` asserts both the one hit and the zero, because a
 * matcher that proposes everything is as useless as one that proposes nothing.
 *
 * ## The veto
 *
 * Two identities assigned to the **same team** are two people: a team's slot 1
 * and slot 2 are, by construction, not one person wearing two spellings. That
 * pair is refused before it is scored, and the refusal is reported as
 * {@link PEOPLE_REASON.IDENTITY_MATCH_VETOED} rather than dropped, so a
 * surprising absence from the queue has an explanation.
 *
 * @module people/identity
 */

import {
  IDENTITY_REVIEW_STATE,
  IDENTITY_SIGNAL,
  IDENTITY_SIGNAL_WEIGHT,
  PEOPLE_REASON,
  createPeopleMeta,
  derivePeopleStatus,
  makePeopleFinding,
} from './reasonCodes.js';
import { IdentityDecisionSchema } from './schemas.js';

/**
 * Default gates. Each is a **parameter**, and each is a statement about strings
 * rather than about this corpus:
 *
 * - `similarityThreshold` 0.85 is "near-identical" — the typo band. It is
 *   deliberately far above the 0.55-0.79 range that ordinary distinct given
 *   names with a shared surname occupy, because a gate inside that range would
 *   queue dozens of unrelated pairs and a review queue nobody can read is a
 *   review queue nobody reads.
 * - `prefixLength` 3 is the shortest shared prefix that is not simply a common
 *   English name opening.
 * - `minimumConfidence` 0.6 keeps a pair that clears candidacy on one weak
 *   signal alone out of the queue.
 */
export const IDENTITY_DEFAULTS = Object.freeze({
  similarityThreshold: 0.85,
  prefixLength: 3,
  minimumConfidence: 0.6,
});

/**
 * Lower-case, strip accents and anything that is not a letter.
 *
 * Deliberately **not** a phonetic key. Soundex and its relatives merge names
 * that merely sound alike, which is a stronger claim than this module is
 * willing to make without a human.
 *
 * @param {string} value
 * @returns {string}
 */
export function normaliseNamePart(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Jaro similarity of two strings, in [0,1].
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function jaro(left, right) {
  if (left === right) return left.length === 0 ? 0 : 1;
  const leftLength = left.length;
  const rightLength = right.length;
  if (leftLength === 0 || rightLength === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(leftLength, rightLength) / 2) - 1);
  const leftMatched = new Array(leftLength).fill(false);
  const rightMatched = new Array(rightLength).fill(false);
  let matches = 0;

  for (let i = 0; i < leftLength; i += 1) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(rightLength - 1, i + window);
    for (let j = lo; j <= hi; j += 1) {
      if (rightMatched[j] || left[i] !== right[j]) continue;
      leftMatched[i] = true;
      rightMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < leftLength; i += 1) {
    if (!leftMatched[i]) continue;
    while (!rightMatched[k]) k += 1;
    if (left[i] !== right[k]) transpositions += 1;
    k += 1;
  }

  return (
    (matches / leftLength + matches / rightLength + (matches - transpositions / 2) / matches) / 3
  );
}

/**
 * Jaro-Winkler similarity: Jaro, boosted for a shared prefix of up to four.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function jaroWinkler(left, right) {
  const base = jaro(left, right);
  let prefix = 0;
  while (
    prefix < 4 &&
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  ) {
    prefix += 1;
  }
  return base + prefix * 0.1 * (1 - base);
}

/**
 * The length of the shared prefix of two strings.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function sharedPrefixLength(left, right) {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }
  return length;
}

/**
 * Is `short` a contraction of `long` — a subsequence, sharing the first letter,
 * strictly shorter, and at least three characters?
 *
 * The three-character floor keeps initials out: "J" is a subsequence of every
 * name beginning with J, and proposing that "J Smith" and "James Smith" are one
 * person is a guess, not evidence.
 *
 * @param {string} short
 * @param {string} long
 * @returns {boolean}
 */
export function isContraction(short, long) {
  if (short.length < 3 || short.length >= long.length) return false;
  if (short[0] !== long[0]) return false;
  let index = 0;
  for (const character of long) {
    if (character === short[index]) index += 1;
    if (index === short.length) return true;
  }
  return false;
}

/**
 * Score one candidate pair, returning the evidence as well as the number.
 *
 * The confidence is a weighted mean over {@link IDENTITY_SIGNAL_WEIGHT}, whose
 * weights sum to 1, so it is always in [0,1] and adding a signal cannot inflate
 * every existing proposal.
 *
 * @param {{ givenName: string, familyName: string, teamIds: ReadonlyArray<string> }} left
 * @param {{ givenName: string, familyName: string, teamIds: ReadonlyArray<string> }} right
 * @param {{ prefixLength?: number }} [options]
 * @returns {{ confidence: number, evidence: Array<import('./types.js').IdentityEvidence> }}
 */
export function scoreIdentityPair(left, right, options = {}) {
  const prefixLength = options.prefixLength ?? IDENTITY_DEFAULTS.prefixLength;
  const leftGiven = normaliseNamePart(left.givenName);
  const rightGiven = normaliseNamePart(right.givenName);
  const leftFamily = normaliseNamePart(left.familyName);
  const rightFamily = normaliseNamePart(right.familyName);
  const [shorter, longer] =
    leftGiven.length <= rightGiven.length ? [leftGiven, rightGiven] : [rightGiven, leftGiven];
  const prefix = sharedPrefixLength(leftGiven, rightGiven);
  const similarity = jaroWinkler(leftGiven, rightGiven);
  const sharedTeams = left.teamIds.filter((teamId) => right.teamIds.includes(teamId));

  /** @type {Array<[string, number, string]>} */
  const observations = [
    [
      IDENTITY_SIGNAL.SURNAME_EXACT,
      leftFamily === rightFamily && leftFamily.length > 0 ? 1 : 0,
      `family names "${leftFamily}" and "${rightFamily}"`,
    ],
    [
      IDENTITY_SIGNAL.GIVEN_NAME_CONTRACTION,
      isContraction(shorter, longer) ? 1 : 0,
      `"${shorter}" ${isContraction(shorter, longer) ? 'is' : 'is not'} a contraction of "${longer}"`,
    ],
    [
      IDENTITY_SIGNAL.GIVEN_NAME_PREFIX,
      prefix >= prefixLength ? 1 : 0,
      `shared given-name prefix of ${prefix} character(s)`,
    ],
    [
      IDENTITY_SIGNAL.GIVEN_NAME_SIMILARITY,
      similarity,
      `Jaro-Winkler similarity ${similarity.toFixed(3)} between "${leftGiven}" and "${rightGiven}"`,
    ],
    [
      IDENTITY_SIGNAL.GIVEN_NAME_INITIAL,
      leftGiven.length > 0 && leftGiven[0] === rightGiven[0] ? 1 : 0,
      `given-name initials "${leftGiven[0] ?? ''}" and "${rightGiven[0] ?? ''}"`,
    ],
    [
      IDENTITY_SIGNAL.TEAM_DISJOINT,
      sharedTeams.length === 0 ? 1 : 0,
      sharedTeams.length === 0
        ? 'no team in common'
        : `${sharedTeams.length} team(s) in common: ${sharedTeams.sort().join(', ')}`,
    ],
  ];

  /** @type {Array<import('./types.js').IdentityEvidence>} */
  const evidence = [];
  let confidence = 0;
  for (const [signal, strength, note] of observations) {
    const weight = IDENTITY_SIGNAL_WEIGHT[signal];
    confidence += weight * strength;
    evidence.push(Object.freeze({ signal, weight, strength, note }));
  }

  return { confidence, evidence: evidence.sort((a, b) => a.signal.localeCompare(b.signal)) };
}

/**
 * Build the review queue over a set of identities.
 *
 * Nothing is merged. Every entry comes back in
 * {@link IDENTITY_REVIEW_STATE.PENDING} and every entry raises a
 * {@link PEOPLE_REASON.IDENTITY_REVIEW_PENDING} finding, so a caller that
 * ignores the queue still sees a `compromise` in its status.
 *
 * @param {ReadonlyArray<{ id: string, givenName: string, familyName: string }>} people
 * @param {{ assignmentsByPerson?: ReadonlyMap<string, ReadonlyArray<{ teamId: string }>>, similarityThreshold?: number, prefixLength?: number, minimumConfidence?: number }} [options]
 * @returns {import('./types.js').IdentityReviewQueue}
 */
export function buildIdentityReviewQueue(people, options = {}) {
  const similarityThreshold = options.similarityThreshold ?? IDENTITY_DEFAULTS.similarityThreshold;
  const prefixLength = options.prefixLength ?? IDENTITY_DEFAULTS.prefixLength;
  const minimumConfidence = options.minimumConfidence ?? IDENTITY_DEFAULTS.minimumConfidence;
  const assignmentsByPerson = options.assignmentsByPerson ?? new Map();

  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const findings = [];
  /** @type {Array<import('./types.js').IdentityProposal>} */
  const entries = [];

  const indexed = [...people]
    .map((person) => ({
      id: String(person.id),
      givenName: String(person.givenName),
      familyName: String(person.familyName),
      teamIds: [
        ...new Set((assignmentsByPerson.get(String(person.id)) ?? []).map((a) => a.teamId)),
      ].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  meta.peopleExamined = indexed.length;

  /** @type {Map<string, Array<typeof indexed[number]>>} */
  const blocks = new Map();
  for (const person of indexed) {
    const key = normaliseNamePart(person.familyName);
    if (!blocks.has(key)) blocks.set(key, []);
    /** @type {Array<typeof indexed[number]>} */ (blocks.get(key)).push(person);
  }

  for (const [key, block] of [...blocks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (block.length < 2) continue;
    meta.identityBlocksExamined += 1;
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        const left = block[i];
        const right = block[j];
        meta.identityPairsCompared += 1;

        const sharedTeams = left.teamIds.filter((teamId) => right.teamIds.includes(teamId));
        if (sharedTeams.length > 0) {
          meta.identityVetoed += 1;
          findings.push(
            makePeopleFinding(
              PEOPLE_REASON.IDENTITY_MATCH_VETOED,
              `"${left.id}" and "${right.id}" share family name "${key}" but are both assigned to ${sharedTeams.length} team(s) in common (${sharedTeams.sort().join(', ')}); one person does not hold two slots on one team, so this pair is two people`,
              {
                leftPersonId: left.id,
                rightPersonId: right.id,
                familyName: key,
                sharedTeamIds: sharedTeams.sort(),
              }
            )
          );
          continue;
        }

        const leftGiven = normaliseNamePart(left.givenName);
        const rightGiven = normaliseNamePart(right.givenName);
        const [shorter, longer] =
          leftGiven.length <= rightGiven.length ? [leftGiven, rightGiven] : [rightGiven, leftGiven];
        const candidate =
          isContraction(shorter, longer) ||
          sharedPrefixLength(leftGiven, rightGiven) >= prefixLength ||
          jaroWinkler(leftGiven, rightGiven) >= similarityThreshold;
        if (!candidate) continue;
        meta.identityCandidates += 1;

        const scored = scoreIdentityPair(left, right, { prefixLength });
        if (scored.confidence < minimumConfidence) continue;
        meta.identityProposals += 1;

        const [leftId, rightId] = [left.id, right.id].sort();
        const entry = Object.freeze({
          id: `${leftId}::${rightId}`,
          leftPersonId: leftId,
          rightPersonId: rightId,
          confidence: scored.confidence,
          evidence: Object.freeze(scored.evidence),
          state: IDENTITY_REVIEW_STATE.PENDING,
        });
        entries.push(entry);
        findings.push(
          makePeopleFinding(
            PEOPLE_REASON.IDENTITY_REVIEW_PENDING,
            `"${leftId}" and "${rightId}" are probably one person (confidence ${scored.confidence.toFixed(3)}); queued for review and deliberately not merged`,
            {
              entryId: entry.id,
              leftPersonId: leftId,
              rightPersonId: rightId,
              confidence: scored.confidence,
              signals: scored.evidence
                .filter((item) => item.strength > 0)
                .map((item) => item.signal),
            }
          )
        );
      }
    }
  }

  if (meta.identityPairsCompared === 0) {
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.IDENTITY_SCAN_VACUOUS,
        `the identity scan compared zero pairs across ${meta.peopleExamined} identity(ies), so an empty queue says nothing about whether this roster holds a duplicate`,
        { peopleExamined: meta.peopleExamined, blocksExamined: meta.identityBlocksExamined }
      )
    );
  }

  return {
    entries: Object.freeze(entries.sort((a, b) => a.id.localeCompare(b.id))),
    personIds: Object.freeze(indexed.map((person) => person.id)),
    findings,
    meta,
    status: derivePeopleStatus(findings),
  };
}

/**
 * Apply human decisions to a queue.
 *
 * The **only** function in this module that produces a merge, and it produces
 * one only for an entry a named human moved to `accepted`. An entry with no
 * decision stays pending and its `IDENTITY_REVIEW_PENDING` finding stays in the
 * result, so "we ignored the queue" and "we reviewed the queue" cannot look
 * alike.
 *
 * The surviving id is the lexicographically smaller of the pair, and the other
 * becomes an alias. Which one survives is arbitrary and stated to be arbitrary;
 * what matters is that the mapping is total and deterministic.
 *
 * @param {import('./types.js').IdentityReviewQueue} queue
 * @param {ReadonlyArray<Object>} decisions
 * @returns {{ queue: import('./types.js').IdentityReviewQueue, canonicalIdByPersonId: Map<string, string>, aliasesByCanonicalId: Map<string, string[]>, findings: import('./types.js').PeopleFinding[], meta: import('./types.js').PeopleMeta, status: string }}
 */
export function applyIdentityDecisions(queue, decisions) {
  const meta = createPeopleMeta();
  /** @type {import('./types.js').PeopleFinding[]} */
  const findings = [];
  const byId = new Map(queue.entries.map((entry) => [entry.id, entry]));
  /** @type {Map<string, Object>} */
  const decided = new Map();

  for (const raw of decisions) {
    const decision = IdentityDecisionSchema.parse(raw);
    if (!byId.has(decision.entryId)) {
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.IDENTITY_DECISION_UNKNOWN_ENTRY,
          `decision by "${decision.decidedBy}" names review entry "${decision.entryId}", which this queue does not hold`,
          { entryId: decision.entryId, decidedBy: decision.decidedBy }
        )
      );
      continue;
    }
    decided.set(decision.entryId, decision);
  }

  /** @type {Map<string, string>} */
  const canonicalIdByPersonId = new Map(queue.personIds.map((id) => [id, id]));
  /** @type {Map<string, string[]>} */
  const aliasesByCanonicalId = new Map();

  /** @type {Array<import('./types.js').IdentityProposal>} */
  const entries = [];
  for (const entry of queue.entries) {
    const decision = decided.get(entry.id);
    if (!decision) {
      entries.push(entry);
      findings.push(
        makePeopleFinding(
          PEOPLE_REASON.IDENTITY_REVIEW_PENDING,
          `review entry "${entry.id}" is still pending (confidence ${entry.confidence.toFixed(3)}); no merge has been made`,
          {
            entryId: entry.id,
            leftPersonId: entry.leftPersonId,
            rightPersonId: entry.rightPersonId,
            confidence: entry.confidence,
          }
        )
      );
      continue;
    }
    entries.push(Object.freeze({ ...entry, state: decision.state }));
    if (decision.state !== 'accepted') continue;

    const [survivor, absorbed] = [entry.leftPersonId, entry.rightPersonId].sort();
    canonicalIdByPersonId.set(absorbed, survivor);
    if (!aliasesByCanonicalId.has(survivor)) aliasesByCanonicalId.set(survivor, []);
    /** @type {string[]} */ (aliasesByCanonicalId.get(survivor)).push(absorbed);
    meta.identityMergesApplied += 1;
    findings.push(
      makePeopleFinding(
        PEOPLE_REASON.IDENTITY_MERGE_APPLIED,
        `"${absorbed}" was merged into "${survivor}" by "${decision.decidedBy}"`,
        {
          entryId: entry.id,
          survivorPersonId: survivor,
          absorbedPersonId: absorbed,
          decidedBy: decision.decidedBy,
          decidedAt: decision.decidedAt,
          confidence: entry.confidence,
        }
      )
    );
  }

  // Chase transitive merges so the mapping is idempotent: a -> b and b -> c
  // must leave a pointing at c, or two "same person" answers disagree.
  for (const personId of canonicalIdByPersonId.keys()) {
    const seen = new Set([personId]);
    let current = /** @type {string} */ (canonicalIdByPersonId.get(personId));
    while (canonicalIdByPersonId.get(current) !== current) {
      if (seen.has(current)) break;
      seen.add(current);
      current = /** @type {string} */ (canonicalIdByPersonId.get(current));
    }
    canonicalIdByPersonId.set(personId, current);
  }
  for (const [survivor, aliases] of aliasesByCanonicalId) {
    aliasesByCanonicalId.set(survivor, [...new Set(aliases)].sort());
  }

  return {
    queue: {
      ...queue,
      entries: Object.freeze(entries),
      findings,
      meta,
      status: derivePeopleStatus(findings),
    },
    canonicalIdByPersonId,
    aliasesByCanonicalId,
    findings,
    meta,
    status: derivePeopleStatus(findings),
  };
}

/**
 * How many distinct people a queue currently says there are.
 *
 * Before any decision this equals the number of identities scanned — which is
 * the assertion that proves nothing auto-merged.
 *
 * @param {ReadonlyMap<string, string>} canonicalIdByPersonId
 * @returns {number}
 */
export function distinctIdentityCount(canonicalIdByPersonId) {
  return new Set(canonicalIdByPersonId.values()).size;
}
