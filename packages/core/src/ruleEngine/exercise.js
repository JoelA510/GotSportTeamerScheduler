/**
 * Meta-assertions: the part that makes a rule's verdict worth reading.
 *
 * The requirement, from the build plan, quoted in full because every line of
 * this module answers one clause of it:
 *
 * > **CRITICAL REQUIREMENT — META-ASSERTIONS.** In the source project I wrote
 * > validators that silently checked nothing and reported a falsely perfect
 * > result. Two real cases: a team-name format change made the coach validator
 * > match zero person-pairs and report zero conflicts; and a checker misread
 * > placeholder labels as team codes and reported violations that didn't exist.
 * > So every rule must declare its expected exercise level, and the engine must
 * > fail loudly when a rule matches suspiciously little data.
 *
 * ## Three checks, two failure modes
 *
 * **Matched too little** is a question about *counts* and is answered twice:
 *
 * 1. {@link checkMinimums} — every counter the rule declared a floor for is at
 *    or above it. *"The coach rule must assert it evaluated > 0 person-pairs"*
 *    and *"the adjacency rule must assert it compared > 0 concurrent field
 *    pairs"* are both this.
 * 2. {@link checkCoverage} — a counter that must equal the **whole** size of a
 *    named universe, not merely exceed zero. *"The round-robin rule must assert
 *    it examined every division"* is this, and it is a genuinely different
 *    claim: a round-robin rule that examined one division of fourteen passes
 *    every minimum anybody would think to write and is still broken.
 *
 * **Matched the wrong thing** is not a question about counts at all, and that
 * is why it needs its own check:
 *
 * 3. {@link checkIdentifiers} — every identifier the rule claims to have
 *    matched is a member of the schedule's universe for the kind the rule
 *    declared, and is not one of the schedule's placeholder labels.
 *
 * The distinction is the whole reason (3) exists. The second half of incident 4
 * — *"a checker misread placeholder labels as team codes and reported
 * violations that didn't exist"* — makes a rule match **more** data, not less.
 * `Away === '-'`, `Select Game 7`, `Scrimmage - teams TBD`, `MinisA` and
 * `Visiting Club A - U14B South` are all real cells in
 * `fixtures/season-2026/combined_schedule.csv`, and a rule that treats any of
 * them as a team code sails past every minimum and every coverage expectation
 * while reporting phantom violations at a higher rate than the correct rule
 * reports real ones. Only a claim about the *shape* of the match catches it.
 *
 * ## Why every one of these is `blocking`
 *
 * Because the alternative is a schedule that reports `compromised` for reasons
 * an operator will read past. A rule that cannot prove it examined the right
 * data has not produced a weak verdict; it has produced no verdict, and the
 * engine must not let its silence be counted as a pass.
 *
 * @module ruleEngine/exercise
 */

import {
  RULE_IDENTIFIER_KIND,
  RULE_REASON,
  createRuleEngineMeta,
  makeRuleFinding,
} from './reasonCodes.js';

/**
 * The `Schedule` field holding the universe of each identifier kind.
 *
 * `game` and `date` are derived from the rows rather than declared, because
 * unlike a team or a person they cannot be anything other than what the
 * schedule contains: a game id that is not in `games` names a row that is not
 * in this schedule.
 *
 * @type {Readonly<Record<string, string|null>>}
 */
const UNIVERSE_FIELD = Object.freeze({
  [RULE_IDENTIFIER_KIND.TEAM]: 'teamUniverse',
  [RULE_IDENTIFIER_KIND.PERSON]: 'personUniverse',
  [RULE_IDENTIFIER_KIND.DIVISION]: 'divisionUniverse',
  [RULE_IDENTIFIER_KIND.SURFACE]: 'surfaceUniverse',
  [RULE_IDENTIFIER_KIND.VENUE]: 'venueUniverse',
  [RULE_IDENTIFIER_KIND.GAME]: null,
  [RULE_IDENTIFIER_KIND.DATE]: null,
});

/**
 * The universe of one identifier kind in one schedule, or `null` when the kind
 * is not one this module knows how to bound.
 *
 * @param {import('./types.js').Schedule} schedule
 * @param {string} kind - a {@link RULE_IDENTIFIER_KIND} value
 * @returns {string[]|null}
 */
export function universeOf(schedule, kind) {
  if (kind === RULE_IDENTIFIER_KIND.GAME) {
    return schedule.games.map((game) => game.id);
  }
  if (kind === RULE_IDENTIFIER_KIND.DATE) {
    return [...new Set(schedule.games.map((game) => game.date))].sort();
  }
  const field = UNIVERSE_FIELD[kind];
  if (field === undefined || field === null) return null;
  const values = /** @type {Record<string, unknown>} */ (schedule)[field];
  return Array.isArray(values) ? /** @type {string[]} */ (values) : null;
}

/**
 * Check every declared minimum against the counters the rule reported.
 *
 * A counter the rule declared and did not report is **not** treated as zero:
 * zero is an answer, and "the rule stopped reporting this counter" is a
 * different fault with a different fix, so it gets its own code.
 *
 * @param {import('./types.js').RuleDefinition} rule
 * @param {Record<string, number>} counters
 * @returns {{ findings: import('./types.js').RuleFinding[], shortfalls: Array<{ counter: string, observed: number|null, required: number, kind: string }> }}
 */
export function checkMinimums(rule, counters) {
  /** @type {import('./types.js').RuleFinding[]} */
  const findings = [];
  /** @type {Array<{ counter: string, observed: number|null, required: number, kind: string }>} */
  const shortfalls = [];

  for (const [counter, required] of Object.entries(rule.exercise.minimums)) {
    const observed = counters[counter];
    if (observed === undefined) {
      shortfalls.push({ counter, observed: null, required, kind: 'missing' });
      findings.push(
        makeRuleFinding(
          RULE_REASON.RULE_EXERCISE_COUNTER_MISSING,
          `rule "${rule.id}" declares a minimum for "${counter}" and reported no such counter, so the expectation measured nothing`,
          { ruleId: rule.id, counter, required, reported: Object.keys(counters).sort() }
        )
      );
      continue;
    }
    if (observed < required) {
      shortfalls.push({ counter, observed, required, kind: 'minimum' });
      findings.push(
        makeRuleFinding(
          RULE_REASON.RULE_EXERCISE_BELOW_MINIMUM,
          `rule "${rule.id}" examined ${observed} ${counter} and its own definition requires at least ${required}; a verdict from a check that matched this little is not a verdict`,
          {
            ruleId: rule.id,
            counter,
            observed,
            required,
            shortfall: required - observed,
            rationale: rule.exercise.rationale,
          }
        )
      );
    }
  }

  return { findings, shortfalls };
}

/**
 * Check every declared coverage expectation: the counter must equal the size of
 * the universe it names, not merely exceed zero.
 *
 * @param {import('./types.js').RuleDefinition} rule
 * @param {Record<string, number>} counters
 * @param {import('./types.js').Schedule} schedule
 * @returns {{ findings: import('./types.js').RuleFinding[], shortfalls: Array<{ counter: string, observed: number|null, required: number, kind: string }> }}
 */
export function checkCoverage(rule, counters, schedule) {
  /** @type {import('./types.js').RuleFinding[]} */
  const findings = [];
  /** @type {Array<{ counter: string, observed: number|null, required: number, kind: string }>} */
  const shortfalls = [];

  for (const [counter, kind] of Object.entries(rule.exercise.coverage)) {
    const universe = universeOf(schedule, kind);
    if (universe === null) {
      shortfalls.push({ counter, observed: null, required: 0, kind: 'domain-unknown' });
      findings.push(
        makeRuleFinding(
          RULE_REASON.RULE_EXERCISE_DOMAIN_UNKNOWN,
          `rule "${rule.id}" claims to cover every "${kind}" and this schedule carries no universe of that kind, so the claim cannot be judged`,
          { ruleId: rule.id, counter, kind }
        )
      );
      continue;
    }
    const required = universe.length;
    const observed = counters[counter];
    if (observed === undefined) {
      shortfalls.push({ counter, observed: null, required, kind: 'missing' });
      findings.push(
        makeRuleFinding(
          RULE_REASON.RULE_EXERCISE_COUNTER_MISSING,
          `rule "${rule.id}" claims to cover every "${kind}" through "${counter}" and reported no such counter`,
          { ruleId: rule.id, counter, kind, required, reported: Object.keys(counters).sort() }
        )
      );
      continue;
    }
    if (observed < required) {
      shortfalls.push({ counter, observed, required, kind: 'coverage' });
      findings.push(
        makeRuleFinding(
          RULE_REASON.RULE_EXERCISE_COVERAGE_SHORT,
          `rule "${rule.id}" examined ${observed} of ${required} ${kind}(s); it declares that it covers every one, and a rule that skipped ${required - observed} of them is reporting on a season it did not read`,
          {
            ruleId: rule.id,
            counter,
            kind,
            observed,
            required,
            shortfall: required - observed,
            rationale: rule.exercise.rationale,
          }
        )
      );
    }
  }

  return { findings, shortfalls };
}

/**
 * Check the **shape** of what a rule matched — incident 4's second half.
 *
 * Every identifier the rule reports under a declared kind must be a member of
 * that kind's universe, and must not be one of the schedule's placeholder
 * labels. The placeholder check runs first and gets its own code, because
 * "you read a label as an id" is a specific, reproducible mistake with a
 * specific fix, and burying it inside the general "unknown identifier" answer
 * would lose that.
 *
 * @param {import('./types.js').RuleDefinition} rule
 * @param {Record<string, string[]>} matched
 * @param {import('./types.js').Schedule} schedule
 * @returns {{ findings: import('./types.js').RuleFinding[], badIdentifiers: Array<{ kind: string, identifier: string, code: string }>, identifiersChecked: number }}
 */
export function checkIdentifiers(rule, matched, schedule) {
  /** @type {import('./types.js').RuleFinding[]} */
  const findings = [];
  /** @type {Array<{ kind: string, identifier: string, code: string }>} */
  const badIdentifiers = [];
  const placeholders = new Set(schedule.placeholderLabels);
  let identifiersChecked = 0;

  for (const kind of rule.exercise.identifierKinds) {
    const universe = universeOf(schedule, kind);
    if (universe === null) {
      findings.push(
        makeRuleFinding(
          RULE_REASON.RULE_IDENTIFIER_KIND_UNKNOWN,
          `rule "${rule.id}" declares that it matches "${kind}" identifiers and this schedule carries no universe of that kind, so the shape of its match cannot be checked`,
          { ruleId: rule.id, kind }
        )
      );
      continue;
    }
    const known = new Set(universe);
    const claimed = [...new Set(matched[kind] ?? [])].sort();

    for (const identifier of claimed) {
      identifiersChecked += 1;
      if (placeholders.has(identifier)) {
        badIdentifiers.push({ kind, identifier, code: RULE_REASON.RULE_MATCHED_PLACEHOLDER });
        findings.push(
          makeRuleFinding(
            RULE_REASON.RULE_MATCHED_PLACEHOLDER,
            `rule "${rule.id}" matched "${identifier}" as a ${kind} identifier; the schedule lists it as a placeholder label, so every verdict resting on it is about a row that names no ${kind}`,
            { ruleId: rule.id, kind, identifier, placeholderCount: placeholders.size }
          )
        );
        continue;
      }
      if (!known.has(identifier)) {
        badIdentifiers.push({
          kind,
          identifier,
          code: RULE_REASON.RULE_MATCHED_UNKNOWN_IDENTIFIER,
        });
        findings.push(
          makeRuleFinding(
            RULE_REASON.RULE_MATCHED_UNKNOWN_IDENTIFIER,
            `rule "${rule.id}" matched "${identifier}" as a ${kind} identifier and this schedule's ${universe.length}-strong ${kind} universe does not contain it`,
            { ruleId: rule.id, kind, identifier, universeSize: universe.length }
          )
        );
      }
    }
  }

  return { findings, badIdentifiers, identifiersChecked };
}

/**
 * Judge one rule's whole exercise expectation.
 *
 * @param {import('./types.js').RuleDefinition} rule
 * @param {import('./types.js').RuleOutput} output
 * @param {import('./types.js').Schedule} schedule
 * @returns {import('./types.js').RuleExerciseVerdict}
 */
export function judgeExercise(rule, output, schedule) {
  const minimums = checkMinimums(rule, output.counters);
  const coverage = checkCoverage(rule, output.counters, schedule);
  const identifiers = checkIdentifiers(rule, output.matched, schedule);

  const findings = [...minimums.findings, ...coverage.findings, ...identifiers.findings];
  const shortfalls = [...minimums.shortfalls, ...coverage.shortfalls];
  const satisfied = findings.length === 0;

  if (satisfied) {
    findings.push(
      makeRuleFinding(
        RULE_REASON.RULE_EXERCISE_SATISFIED,
        `rule "${rule.id}" met every expectation it declares: ${describeExpectation(rule, output.counters)}`,
        {
          ruleId: rule.id,
          counters: { ...output.counters },
          identifiersChecked: identifiers.identifiersChecked,
        }
      )
    );
  }

  return {
    ruleId: rule.id,
    satisfied,
    counters: { ...output.counters },
    shortfalls,
    badIdentifiers: identifiers.badIdentifiers,
    findings,
    identifiersChecked: identifiers.identifiersChecked,
  };
}

/**
 * Render a rule's expectation and what it actually saw, for the `info` finding
 * that records a satisfied one.
 *
 * @param {import('./types.js').RuleDefinition} rule
 * @param {Record<string, number>} counters
 * @returns {string}
 */
export function describeExpectation(rule, counters) {
  const parts = [];
  for (const [counter, required] of Object.entries(rule.exercise.minimums)) {
    parts.push(`${counter} ${counters[counter] ?? 0} (>= ${required})`);
  }
  for (const [counter, kind] of Object.entries(rule.exercise.coverage)) {
    parts.push(`${counter} ${counters[counter] ?? 0} (every ${kind})`);
  }
  return parts.join(', ');
}

/**
 * Fresh meta for a standalone exercise check, so a caller that runs one on its
 * own still gets counters back.
 *
 * @returns {import('./types.js').RuleEngineMeta}
 */
export function createExerciseMeta() {
  return createRuleEngineMeta();
}
