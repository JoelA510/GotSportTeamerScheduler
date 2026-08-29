/**
 * **The league / external / friendly distinction, and everything that hangs
 * off it.**
 *
 * ## Why this file is the first one in the module
 *
 * A fairness report is a comparison, and a comparison is only as good as the
 * population it is drawn over. The season-2026 corpus makes the point harder
 * than any synthetic fixture could:
 *
 * - `combined_schedule.csv` names **152** distinct labels in its `Home` and
 *   `Away` columns. Eleven of them are not teams: the `-` token (137 rows),
 *   `Select Game 1`..`Select Game 10` (100 reserved league slots whose teams
 *   were still TBD) and `Scrimmage - teams TBD` (one field reservation). The
 *   real participant count is **140**.
 * - Of those 140, **122 play exactly nine fixtures** and **18 play one or two**.
 *   A games-played metric run over all 140 flags the 18 and reports that 13% of
 *   the club's teams are being short-changed. Every one of those flags is false:
 *   the 18 hold **no league fixture at all**. Five are visiting clubs from
 *   another league's seeding round; the other thirteen are the club's own Select
 *   teams, whose league layer exists in this corpus only as the hundred
 *   `Select Game N` slots with no teams assigned to them yet.
 *
 * So the distinction is not a nicety. Without it the module's headline output is
 * eighteen accusations, and *"a fairness report that tells an administrator
 * eighteen teams are being treated inequitably when they are guests is worse
 * than no report"*.
 *
 * ## Where the line is drawn, and from what evidence
 *
 * Every fixture declares its {@link FAIRNESS_COMPETITION}. This module owns the
 * vocabulary and the consequences; the *adapter* owns the knowledge of how a
 * given corpus spells it, exactly as
 * `ruleEngine/adapters/season2026Schedule.js` owns `SEASON_2026_COUNTED_ROW_KINDS`
 * and the engine does not. For season-2026 the mapping is a straight read of
 * `SEASON_2026_ROW_KIND`, which `fixtures/season2026Parsers.js` already assigns
 * from the shape of the row itself:
 *
 * | row kind | competition | count |
 * |---|---|---|
 * | `rec_game` | `league` | 531 |
 * | `minis_session` | `league` | 36 |
 * | `external_fixture` | `external` | 8 |
 * | `scrimmage` | `friendly` | 3 |
 * | `league_placeholder` | *dropped — names no participant* | 100 |
 * | `reservation` | *dropped — names no participant* | 1 |
 *
 * A value outside the enum is a **blocking** `FAIRNESS_FIXTURE_UNCLASSIFIED`
 * rather than a default into `league`, for the reason every other table in this
 * repository throws on an unregistered key: a competition kind nobody decided
 * the meaning of must not be silently counted as the one the metrics are graded
 * on.
 *
 * ## What the distinction is *not*
 *
 * It is not membership. Thirteen of the eighteen non-league participants are the
 * club's own teams and five are guests, and no fixture-class test separates
 * them — the four Minis sides are off-roster too and are as much part of the
 * league as anybody. Membership is a separate, **optional** input
 * ({@link FairnessPopulationInput}`.memberSubjectIds`); when it is absent the
 * report says so with `FAIRNESS_MEMBERSHIP_UNSTATED` and reports no guest/member
 * split, and **no metric changes**. A metric that needed membership to be
 * correct would be a metric that silently mis-reports whenever a club has not
 * uploaded its roster.
 *
 * @module fairness/classification
 */

import { FAIRNESS_REASON, FAIRNESS_SEVERITY, makeFairnessFinding } from './reasonCodes.js';

/**
 * What kind of fixture this is, for the purpose of comparing teams.
 *
 * Three members, and the reason there are three rather than two is that
 * `external` and `friendly` fail a fairness comparison for *different* reasons.
 * An external fixture is played under another body's calendar and its times were
 * negotiated rather than solved (incident 3); a friendly is arranged by the two
 * clubs and is not part of any competition's obligations at all. Collapsing them
 * into "not league" would work for this corpus's metrics and would stop working
 * the moment a club asks *"is our external load spread evenly?"* — which is a
 * real question with a real answer, and a different one from *"is our friendly
 * load spread evenly?"*.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_COMPETITION = Object.freeze({
  /** A fixture of the competition whose equity this report is about. */
  LEAGUE: 'league',
  /** A fixture against, or under the calendar of, another body. */
  EXTERNAL: 'external',
  /** An arranged friendly or scrimmage; no competition obligation. */
  FRIENDLY: 'friendly',
});

/**
 * Declared order, for deterministic rendering only.
 *
 * @type {ReadonlyArray<string>}
 */
export const FAIRNESS_COMPETITION_ORDER = Object.freeze([
  FAIRNESS_COMPETITION.LEAGUE,
  FAIRNESS_COMPETITION.EXTERNAL,
  FAIRNESS_COMPETITION.FRIENDLY,
]);

/**
 * How a subject took part in a fixture.
 *
 * `sole` is the state that defuses the Minis trap. A Minis session names one
 * side and the `-` token; the participant is neither home nor away, because
 * there is no away. Reporting it as `home` is what produces a hosting share of
 * 9/0 and the season's four most spectacular false positives.
 *
 * @readonly
 * @enum {string}
 */
export const FAIRNESS_SIDE = Object.freeze({
  HOME: 'home',
  AWAY: 'away',
  /** The only named participant. There is no opponent and no host/guest role. */
  SOLE: 'sole',
});

/**
 * Is this fixture two-sided — does it name two participants?
 *
 * The single structural test behind every host/guest metric in this module.
 * Note what it does **not** do: it never looks at a format name, a division
 * label or the string `Minis`. A fixture is two-sided when two participants are
 * named on it, and one-sided when one is, and that is a property of the row.
 *
 * @param {import('./types.js').FairnessFixture} fixture
 * @returns {boolean}
 */
export function isTwoSided(fixture) {
  return fixture.homeSubjectId !== null && fixture.awaySubjectId !== null;
}

/**
 * The side a subject played on, or `null` if it did not appear.
 *
 * @param {import('./types.js').FairnessFixture} fixture
 * @param {string} subjectId
 * @returns {string|null} a {@link FAIRNESS_SIDE} value, or null
 */
export function sideOf(fixture, subjectId) {
  const twoSided = isTwoSided(fixture);
  if (fixture.homeSubjectId === subjectId) {
    return twoSided ? FAIRNESS_SIDE.HOME : FAIRNESS_SIDE.SOLE;
  }
  if (fixture.awaySubjectId === subjectId) {
    return twoSided ? FAIRNESS_SIDE.AWAY : FAIRNESS_SIDE.SOLE;
  }
  return null;
}

/**
 * **Classify a fixture list, and refuse one that mixes scopes.**
 *
 * ## GAP-24, stated rather than assumed
 *
 * `docs/MODEL_GAPS.md` records that a division is a **label, not a key**:
 * `grep divisionId` over this package returns nothing, `Team.division` is a
 * string, and `buildTeams()` leaves it `null` rather than guessing when the
 * corpus disagrees with itself. This module groups teams by that label, so it
 * inherits the gap and has to say what it does about it.
 *
 * **What it does:** every fixture carries a `scopeId`, and a report is computed
 * over exactly one. A fixture list spanning more than one scope is refused with
 * a **blocking** `FAIRNESS_SCOPE_MIXED` and no metric runs.
 *
 * **What breaks if two clubs use the same division label**, spelled out because
 * this is the failure the guard exists to make impossible: `U10B` at club A and
 * `U10B` at club B would form one comparison population. Their teams would be
 * ranked against each other, an outlier flag would name a "population" that
 * plays in two different competitions on two different fixture lists, and the
 * arithmetic would be impeccable. The report would be nonsense and nothing in it
 * would say so. Within one scope the label is a valid key — it is what the
 * corpus, the roster and the published schedule all agree a division is — and
 * across scopes it is not a key at all, so the module refuses to compute across
 * scopes rather than merging silently.
 *
 * One consequence is kept in view rather than fixed here: within a single scope
 * a subject may still be observed under two labels. `16GSelect02` appears as
 * division `16GS` in one row and `U16G` in another. That subject is
 * **ambiguous** for division grouping and is judged under no division cohort,
 * with `FAIRNESS_GROUP_AMBIGUOUS`; see `metrics.js`.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessFixture>} fixtures
 * @returns {import('./types.js').FairnessClassification}
 */
export function classifyFairnessFixtures(fixtures) {
  /** @type {import('./types.js').FairnessFinding[]} */
  const findings = [];
  /** @type {Record<string, number>} */
  const byCompetition = Object.fromEntries(
    FAIRNESS_COMPETITION_ORDER.map((competition) => [competition, 0])
  );

  const scopes = new Set();
  /** @type {Map<string, number>} */
  const unclassified = new Map();
  let placeholders = 0;

  for (const fixture of fixtures) {
    scopes.add(fixture.scopeId);
    if (!Object.hasOwn(byCompetition, fixture.competition)) {
      unclassified.set(fixture.competition, (unclassified.get(fixture.competition) ?? 0) + 1);
      continue;
    }
    byCompetition[fixture.competition] += 1;
    if (fixture.homeSubjectId === null && fixture.awaySubjectId === null) placeholders += 1;
  }

  if (placeholders > 0) {
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_PLACEHOLDER_EXCLUDED,
        `${placeholders} fixture(s) name no participant on either side and contribute to no subject's metrics; season-2026 has 101 such rows (100 reserved \`Select Game N\` league slots and one field reservation) and a naive read of its Home/Away columns counts eleven of their labels as teams`,
        { placeholderFixtures: placeholders, fixturesRead: fixtures.length }
      )
    );
  }

  for (const [competition, count] of [...unclassified].sort()) {
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_FIXTURE_UNCLASSIFIED,
        `${count} fixture(s) declare the competition ${JSON.stringify(competition)}, which is not a member of FAIRNESS_COMPETITION; a competition kind nobody has decided the meaning of is not counted as league by default`,
        { competition, fixtureCount: count, declared: [...FAIRNESS_COMPETITION_ORDER] }
      )
    );
  }

  const scopeList = [...scopes].sort();
  if (scopeList.length > 1) {
    findings.push(
      makeFairnessFinding(
        FAIRNESS_REASON.FAIRNESS_SCOPE_MIXED,
        `fixtures span ${scopeList.length} scopes (${scopeList.join(', ')}); a division is a label and not a key (GAP-24), so two scopes sharing a label would be compared as one population and nothing in the arithmetic would object`,
        { scopeCount: scopeList.length, scopeIds: scopeList }
      )
    );
  }

  return {
    scopeId: scopeList.length === 1 ? scopeList[0] : null,
    scopeIds: scopeList,
    byCompetition: Object.freeze(byCompetition),
    placeholderFixtures: placeholders,
    usable: !findings.some((finding) => finding.severity === FAIRNESS_SEVERITY.BLOCKING),
    findings,
  };
}

/**
 * Which competitions each subject actually appears in, and on which side.
 *
 * The answer to *"is this team in the league at all?"*, derived from the
 * fixtures and from nothing else. On season-2026 it separates 122 league
 * participants from 18 that hold no league fixture, which is the split every
 * metric's population is drawn against.
 *
 * @param {ReadonlyArray<import('./types.js').FairnessFixture>} fixtures
 * @returns {Map<string, import('./types.js').FairnessParticipation>}
 */
export function participationOf(fixtures) {
  /** @type {Map<string, import('./types.js').FairnessParticipation>} */
  const bySubject = new Map();

  const touch = (subjectId) => {
    let entry = bySubject.get(subjectId);
    if (!entry) {
      entry = {
        subjectId,
        byCompetition: Object.fromEntries(
          FAIRNESS_COMPETITION_ORDER.map((competition) => [competition, 0])
        ),
        fixtures: [],
        divisions: new Set(),
        ageGroups: new Set(),
      };
      bySubject.set(subjectId, entry);
    }
    return entry;
  };

  for (const fixture of fixtures) {
    if (!Object.hasOwn(FAIRNESS_COMPETITION, fixture.competition.toUpperCase())) {
      // Unclassified fixtures are refused by classifyFairnessFixtures() before
      // any metric runs; they contribute to no participation record either.
      continue;
    }
    for (const subjectId of [fixture.homeSubjectId, fixture.awaySubjectId]) {
      if (subjectId === null) continue;
      const entry = touch(subjectId);
      // A fixture that names the same subject on both sides is counted once.
      if (entry.fixtures.some((held) => held.fixture === fixture)) continue;
      entry.byCompetition[fixture.competition] += 1;
      entry.fixtures.push({ fixture, side: sideOf(fixture, subjectId) });
      if (fixture.division !== null) entry.divisions.add(fixture.division);
      if (fixture.ageGroup !== null) entry.ageGroups.add(fixture.ageGroup);
    }
  }

  return bySubject;
}

/**
 * The member/guest split, or a stated refusal to guess one.
 *
 * @param {Map<string, import('./types.js').FairnessParticipation>} participation
 * @param {ReadonlyArray<string>|null} memberSubjectIds
 * @returns {{ stated: boolean, members: string[], guests: string[], findings: import('./types.js').FairnessFinding[] }}
 */
export function membershipSplit(participation, memberSubjectIds) {
  if (memberSubjectIds === null) {
    return {
      stated: false,
      members: [],
      guests: [],
      findings: [
        makeFairnessFinding(
          FAIRNESS_REASON.FAIRNESS_MEMBERSHIP_UNSTATED,
          'no member-team list was supplied, so this report cannot say which participants are the organisation’s own teams and which are visiting clubs; no metric depends on the distinction and none changed because of its absence',
          { subjectsConsidered: participation.size }
        ),
      ],
    };
  }
  const members = new Set(memberSubjectIds);
  /** @type {string[]} */ const inside = [];
  /** @type {string[]} */ const outside = [];
  for (const subjectId of [...participation.keys()].sort()) {
    (members.has(subjectId) ? inside : outside).push(subjectId);
  }
  return { stated: true, members: inside, guests: outside, findings: [] };
}
