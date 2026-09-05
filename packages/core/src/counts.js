/**
 * What a published number is a number **of**.
 *
 * ## The defect this exists to prevent
 *
 * `gameMetrics.js` and `practiceMetrics.js` publish `totalTeams`,
 * `assignedTeams`, `totalAssignments` and two dozen more, and not one of them
 * says what it counts. In the season-2026 corpus the same word reaches five
 * different numbers: the roster carries **132** teams, **131** of them are named
 * by a side of `combined_schedule.csv`, **140** distinct sides are named there
 * at all, **88** teams hold a practice slot, and the practice README's own
 * anonymisation note says **136** team codes. A report that says "132" and
 * stops has already lost the argument about which of those it meant.
 *
 * `fairness/` solved this once already: every measurement carries
 * {@link import('./fairness/metrics.js').FAIRNESS_METRIC_UNIT} and a
 * three-valued `subjectKind`, and it distinguishes `fixturesRead` from
 * `fixturesCounted` from `fixturesPlaceholder` because those three are not the
 * same set. This module is the same idea for the two metric reports that carry
 * no unit label at all, and it is deliberately *enforced* rather than
 * documented: {@link assertCountsLabelled} walks a finished report and throws on
 * a numeric leaf no registry entry covers, so a count added later cannot ship
 * unlabelled. Declared is not enforced; this is the enforcement.
 *
 * ## The axis the two reports were missing
 *
 * Three kinds of subject, and they are genuinely different populations:
 *
 * - {@link COUNT_SUBJECT_KIND.ROSTERED_TEAM} — a team the roster carries,
 *   whether or not anything schedulable exists for it. 132 in this corpus.
 * - {@link COUNT_SUBJECT_KIND.SCHEDULABLE_ENTITY} — a side the scheduler can
 *   actually place. 131 rostered teams have a game; 140 sides are named.
 * - {@link COUNT_SUBJECT_KIND.SLOT_UNIT} — whatever one booking consumes. For
 *   practices that is a *team*, a *practice group* or a *field-hour*, and the
 *   three do not agree: 457 practice rows across 88 teams on a field grid that
 *   sells time by the field-hour.
 *
 * Everything else — a share, a week index, a clock reading — is
 * {@link COUNT_SUBJECT_KIND.NONE}: it is still labelled, but it is not a count
 * of subjects and saying so is the point.
 *
 * @module counts
 */

/**
 * The three populations a count can be about, plus `none` for a number that is
 * not a count of subjects at all.
 *
 * @readonly
 * @enum {string}
 */
export const COUNT_SUBJECT_KIND = Object.freeze({
  /** A team on the roster, schedulable or not. */
  ROSTERED_TEAM: 'rostered-team',
  /** A side the scheduler can place. */
  SCHEDULABLE_ENTITY: 'schedulable-entity',
  /** Whatever one booking consumes: a team, a practice group, a field-hour. */
  SLOT_UNIT: 'slot-unit',
  /** A share, an index, a clock reading. Labelled, but not a population. */
  NONE: 'none',
});

/**
 * Every unit a count in this repo may carry, singular and plural.
 *
 * Both spellings are stored rather than derived, because `share of 1` and
 * `field-hour` pluralise differently and a guessed plural in an operator-facing
 * sentence is the kind of small wrongness that makes a report look automated
 * and therefore ignorable.
 *
 * @type {Readonly<Record<string, Readonly<{ one: string, many: string, subjectKind: string }>>>}
 */
export const COUNT_UNIT = Object.freeze({
  ROSTERED_TEAM: Object.freeze({
    one: 'rostered team',
    many: 'rostered teams',
    subjectKind: COUNT_SUBJECT_KIND.ROSTERED_TEAM,
  }),
  SCHEDULABLE_ENTITY: Object.freeze({
    one: 'schedulable entity',
    many: 'schedulable entities',
    subjectKind: COUNT_SUBJECT_KIND.SCHEDULABLE_ENTITY,
  }),
  TEAM_SLOT_UNIT: Object.freeze({
    one: 'team holding a slot',
    many: 'teams holding a slot',
    subjectKind: COUNT_SUBJECT_KIND.SLOT_UNIT,
  }),
  PRACTICE_GROUP: Object.freeze({
    one: 'practice group',
    many: 'practice groups',
    subjectKind: COUNT_SUBJECT_KIND.SLOT_UNIT,
  }),
  FIELD_HOUR: Object.freeze({
    one: 'field-hour',
    many: 'field-hours',
    subjectKind: COUNT_SUBJECT_KIND.SLOT_UNIT,
  }),
  GAME: Object.freeze({
    one: 'scheduled game',
    many: 'scheduled games',
    subjectKind: COUNT_SUBJECT_KIND.NONE,
  }),
  PRACTICE_ASSIGNMENT: Object.freeze({
    one: 'practice assignment',
    many: 'practice assignments',
    subjectKind: COUNT_SUBJECT_KIND.NONE,
  }),
  BYE: Object.freeze({ one: 'bye', many: 'byes', subjectKind: COUNT_SUBJECT_KIND.NONE }),
  UNSCHEDULED_MATCHUP: Object.freeze({
    one: 'unscheduled matchup',
    many: 'unscheduled matchups',
    subjectKind: COUNT_SUBJECT_KIND.NONE,
  }),
  DAY: Object.freeze({
    one: 'distinct day',
    many: 'distinct days',
    subjectKind: COUNT_SUBJECT_KIND.NONE,
  }),
  SHARE_OF_ONE: Object.freeze({
    one: 'share of 1',
    many: 'share of 1',
    subjectKind: COUNT_SUBJECT_KIND.NONE,
  }),
  WEEK_INDEX: Object.freeze({
    one: 'week index',
    many: 'week indices',
    subjectKind: COUNT_SUBJECT_KIND.NONE,
  }),
  MINUTES_PAST_MIDNIGHT: Object.freeze({
    one: 'minute past midnight',
    many: 'minutes past midnight',
    subjectKind: COUNT_SUBJECT_KIND.NONE,
  }),
});

/** Every unit key, sorted. */
export const COUNT_UNIT_KEYS = Object.freeze(Object.keys(COUNT_UNIT).sort());

/**
 * The units that are **declared and used by no report**, each with the reason.
 *
 * Declared is not enforced, so a vocabulary entry nothing produces has to say
 * so out loud rather than reading as a capability. `tests/countUnits.test.js`
 * asserts this list is exactly the set of unit keys no registry names — in both
 * directions, so an entry that quietly comes into use, or a unit that quietly
 * falls out of use, fails rather than ageing here.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const COUNT_UNITS_DECLARED_ONLY = Object.freeze({
  PRACTICE_GROUP:
    'the practice corpus books groups of teams into one slot, but no model in this repo carries a group as an entity yet; 8.3 is where the facility layer meets it',
  FIELD_HOUR:
    'SlotSchema carries capacity, start and end but no field, so nothing here can say how much ground an assignment consumes; counting slots and calling them field-hours is the error this register exists to prevent',
});

/**
 * Render a number with its unit: `describeCount(132, 'ROSTERED_TEAM')` is
 * `'132 rostered teams'`.
 *
 * Throws on an unregistered unit key rather than falling back to a bare number,
 * for the same reason every `severityOf()` in this repo throws on an
 * unregistered code: the silent fallback is the failure mode.
 *
 * @param {number} value
 * @param {string} unitKey - a key of {@link COUNT_UNIT}
 * @returns {string}
 */
export function describeCount(value, unitKey) {
  // `Object.hasOwn`, not a bare lookup: `COUNT_UNIT['toString']` is a function
  // and would sail past an `undefined` check, so `describeCount(5, 'toString')`
  // returned "5 undefined" instead of throwing. The same prototype-key hole was
  // found in the 8.0 loader; it is closed here in all three lookups.
  const unit = Object.hasOwn(COUNT_UNIT, unitKey) ? COUNT_UNIT[unitKey] : undefined;
  if (unit === undefined) {
    throw new Error(`counts: no unit is registered under "${unitKey}"`);
  }
  return `${value} ${value === 1 ? unit.one : unit.many}`;
}

/**
 * The subject kind of a unit. One producer, so no call site decides.
 *
 * @param {string} unitKey - a key of {@link COUNT_UNIT}
 * @returns {string} a {@link COUNT_SUBJECT_KIND} value
 */
export function subjectKindOf(unitKey) {
  const unit = Object.hasOwn(COUNT_UNIT, unitKey) ? COUNT_UNIT[unitKey] : undefined;
  if (unit === undefined) {
    throw new Error(`counts: no unit is registered under "${unitKey}"`);
  }
  return unit.subjectKind;
}

/**
 * Freeze a `{ path pattern -> unit key }` table into the published shape, with
 * each entry's singular, plural and subject kind resolved once.
 *
 * A pattern is a dot path through the report. `*` matches any object key and
 * `[]` matches an array element, so `coachLoad.*.assignedTeams` covers every
 * coach and `slotUtilization[].capacity` every slot.
 *
 * @param {Readonly<Record<string, string>>} table - pattern -> {@link COUNT_UNIT} key
 * @returns {Readonly<Record<string, Readonly<{ unit: string, one: string, many: string, subjectKind: string }>>>}
 */
export function buildCountUnitRegistry(table) {
  /** @type {Record<string, Object>} */
  const registry = {};
  for (const [pattern, unitKey] of Object.entries(table)) {
    const unit = Object.hasOwn(COUNT_UNIT, unitKey) ? COUNT_UNIT[unitKey] : undefined;
    if (unit === undefined) {
      throw new Error(`counts: pattern "${pattern}" names unregistered unit "${unitKey}"`);
    }
    registry[pattern] = Object.freeze({
      unit: unitKey,
      one: unit.one,
      many: unit.many,
      subjectKind: unit.subjectKind,
    });
  }
  return Object.freeze(registry);
}

/**
 * One object key as one path segment, with the separator escaped.
 *
 * **This is load-bearing, not tidiness.** Paths are built from live map keys —
 * a division name, a field id, a coach id — and a GotSport division called
 * `Div. A` or a field called `Field 1.5` would otherwise split into two
 * segments, match no pattern, and make {@link assertCountsLabelled} throw on a
 * report that is perfectly well formed. A count guard that a dot in the input
 * data can turn into a crash is worse than no guard.
 *
 * `%` is escaped first so the encoding stays injective, and `[`/`]` are escaped
 * so no key can impersonate the array marker.
 *
 * @param {string|number} key
 * @returns {string}
 */
export function encodeCountSegment(key) {
  return String(key)
    .replace(/%/g, '%25')
    .replace(/\./g, '%2E')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D');
}

/**
 * The inverse of {@link encodeCountSegment}, for messages a human reads.
 *
 * @param {string} path
 * @returns {string}
 */
export function decodeCountPath(path) {
  return path.replace(/%5D/g, ']').replace(/%5B/g, '[').replace(/%2E/g, '.').replace(/%25/g, '%');
}

/**
 * Does a registry pattern cover a concrete path?
 *
 * @param {string} pattern
 * @param {string} path
 * @returns {boolean}
 */
export function countPatternMatches(pattern, path) {
  const patternSegments = pattern.split('.');
  const pathSegments = path.split('.');
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((segment, index) => {
    const actual = pathSegments[index];
    if (segment === '[]') return actual === '[]';
    if (segment === '*') return actual !== '[]';
    return segment === actual;
  });
}

/**
 * The registry entry covering a path, or `null`.
 *
 * A literal pattern wins over a wildcard one, so a report can label
 * `summary.totalTeams` specifically while `summary.*` covers the rest — without
 * the answer depending on the insertion order of the table.
 *
 * @param {Readonly<Record<string, Object>>} registry
 * @param {string} path
 * @returns {Object|null}
 */
export function countUnitFor(registry, path) {
  /** @type {[string, Object]|null} */
  let best = null;
  let bestWildcards = Number.POSITIVE_INFINITY;
  for (const [pattern, entry] of Object.entries(registry)) {
    if (!countPatternMatches(pattern, path)) continue;
    const wildcards = pattern.split('.').filter((segment) => segment === '*').length;
    if (wildcards < bestWildcards) {
      best = [pattern, entry];
      bestWildcards = wildcards;
    }
  }
  return best === null ? null : best[1];
}

/**
 * Every numeric leaf of a value, as `path -> number`.
 *
 * `Date` instances are not leaves: they are not counts, they are not walked,
 * and a report that leans on one has a different problem than this module
 * solves. Arrays contribute the segment `[]`, so one pattern covers a list
 * however long it is.
 *
 * @param {unknown} value
 * @param {string} [prefix]
 * @param {Map<string, number>} [into]
 * @returns {Map<string, number>}
 */
export function numericLeaves(value, prefix = '', into = new Map()) {
  if (typeof value === 'number') {
    into.set(prefix, value);
    return into;
  }
  if (value === null || typeof value !== 'object') return into;
  if (value instanceof Date) return into;
  if (Array.isArray(value)) {
    for (const entry of value) {
      numericLeaves(entry, prefix === '' ? '[]' : `${prefix}.[]`, into);
    }
    return into;
  }
  for (const [key, entry] of Object.entries(value)) {
    const segment = encodeCountSegment(key);
    numericLeaves(entry, prefix === '' ? segment : `${prefix}.${segment}`, into);
  }
  return into;
}

/**
 * Every numeric leaf path of a report that no registry pattern covers, sorted.
 *
 * @param {unknown} report
 * @param {Readonly<Record<string, Object>>} registry
 * @returns {string[]}
 */
export function unlabelledCountPaths(report, registry) {
  const paths = new Set();
  for (const path of numericLeaves(report).keys()) {
    if (countUnitFor(registry, path) === null) paths.add(path);
  }
  return [...paths].sort();
}

/**
 * Every registry pattern that matched nothing in a report, sorted.
 *
 * The other half of the check, and the half that makes it a meta-assertion
 * rather than a rubber stamp: a registry that has drifted away from its report
 * still labels everything the report happens to publish, and would pass
 * {@link unlabelledCountPaths} for ever while naming fields that no longer
 * exist. Reported, not thrown — a report that legitimately publishes no coaches
 * this run leaves `coachLoad.*` unmatched, and that is data, not a defect.
 *
 * @param {unknown} report
 * @param {Readonly<Record<string, Object>>} registry
 * @returns {string[]}
 */
export function unmatchedCountPatterns(report, registry) {
  const paths = [...numericLeaves(report).keys()];
  return Object.keys(registry)
    .filter((pattern) => !paths.some((path) => countPatternMatches(pattern, path)))
    .sort();
}

/**
 * Refuse to publish a report carrying a number that does not say what it counts.
 *
 * Called by the producer, on the finished report, immediately before it is
 * returned — so the guarantee is "this report's numbers are labelled", not
 * "somebody wrote a registry once".
 *
 * @param {unknown} report
 * @param {Readonly<Record<string, Object>>} registry
 * @param {string} reportName - for the message only
 * @returns {void}
 */
export function assertCountsLabelled(report, registry, reportName) {
  const unlabelled = unlabelledCountPaths(report, registry);
  if (unlabelled.length === 0) return;
  throw new Error(
    `counts: ${reportName} publishes ${unlabelled.length} number(s) that do not say what they count: ${unlabelled
      .map(decodeCountPath)
      .join(', ')}; add each to the report's count-unit registry`
  );
}
