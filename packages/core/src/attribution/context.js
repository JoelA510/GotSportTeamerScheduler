/**
 * Everything an explain-why run needs, assembled once and then only read.
 *
 * The context owns no facts. It holds the engines the other modules built —
 * the facility graph, the format timing table, the availability calendar, the
 * constraint registry — plus, optionally, a standing-rule-engine run, a
 * coach-travel evaluation and a coach roster. Nothing here recomputes any of
 * them; the only thing this file constructs is the `ResolveState` that
 * `checkPlacement()` needs in order to ask *"may this game stand here, given
 * everything else currently placed?"*, and every game in it is **frozen**
 * because an attribution moves nothing.
 *
 * ## What it says when it is missing something
 *
 * A context built without a rule-engine run can still explain facility legality,
 * and it says so: `ATTRIBUTION_VERIFICATION_ABSENT` at `compromise`, carried on
 * to every answer built from it. The same for the coach-travel evaluation and
 * the roster. This is the "declared is not enforced" rule from
 * `docs/LESSONS_LEARNED.md` applied to an *answer*: a thin explanation must
 * never read like a complete one, and the three-state status is what stops it.
 *
 * **Travel is never built from a guess.** `evaluateCoachTravel()` needs the
 * season's declared venue complexes, and a run that supplies none judges every
 * pair of distinct venue names against the 60-minute drive floor — the
 * misreading that reported eighteen shortfalls across five coaches on a clean
 * season (`docs/RULE_ENGINE.md` §9). So a caller passes an evaluation, or passes
 * the complexes and lets this build one, or gets an answer that admits it cannot
 * speak about coaches at all.
 *
 * @module attribution/context
 */

import { FREEZE_DISPOSITION } from '../freeze/reasonCodes.js';
import { soleCoachRiskRegister } from '../people/roster.js';
import { buildSlotInventory } from '../resolve/inventory.js';
import { createResolveLedger, createResolveState } from '../resolve/state.js';
import { evaluateCoachTravel } from '../waivers/coachTravel.js';

import {
  ATTRIBUTION_REASON,
  createAttributionMeta,
  deriveAttributionStatus,
  makeAttributionFinding,
} from './reasonCodes.js';

/**
 * Build the context.
 *
 * @param {Object} input
 * @param {Object} input.graph - a `FacilityGraph`
 * @param {Object} input.table - a `FormatTimingTable`
 * @param {Object} input.calendar - an `AvailabilityCalendar`
 * @param {Object} input.registry - a `ConstraintRegistry`
 * @param {import('../ruleEngine/types.js').Schedule} input.schedule
 * @param {Object|null} [input.verification] - a `runRuleEngine()` result
 * @param {Object|null} [input.travel] - an `evaluateCoachTravel()` result
 * @param {Object|null} [input.venueComplexes] - used only to build `travel` when
 *   one was not supplied; never defaulted to "no complexes"
 * @param {Object|null} [input.roster] - a `CoachRoster`
 * @returns {import('./types.js').AttributionContext}
 */
export function buildAttributionContext(input) {
  const {
    graph,
    table,
    calendar,
    registry,
    schedule,
    verification = null,
    venueComplexes = null,
    roster = null,
  } = input;
  const meta = createAttributionMeta();
  /** @type {import('./types.js').AttributionFinding[]} */
  const findings = [];

  const state = createResolveState({
    games: schedule.games.map((game) => ({ ...game })),
    dispositions: Object.fromEntries(
      schedule.games.map((game) => [game.id, FREEZE_DISPOSITION.FROZEN])
    ),
    inventory: buildSlotInventory(schedule.games),
    ledger: createResolveLedger(),
  });

  if (verification === null) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_VERIFICATION_ABSENT,
        'no standing-rule-engine run was supplied, so every answer from this context carries facility legality only: turnover floors, coach travel, round-robin completeness and hosting balance are not absent from the schedule, they are absent from the question',
        { scheduleName: schedule.name, gameCount: schedule.games.length }
      )
    );
  }

  let travel = input.travel ?? null;
  if (travel === null && venueComplexes !== null) {
    travel = evaluateCoachTravel(schedule.commitments, { registry, venueComplexes });
  }
  if (travel === null) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_TRAVEL_ABSENT,
        'no coach-travel evaluation was supplied and none could be built: `evaluateCoachTravel()` needs the season’s declared venue complexes, and guessing there are none judges every pair of venue names against the drive floor',
        { commitmentCount: schedule.commitments.length }
      )
    );
  } else {
    meta.transitionsConsulted += travel.meta?.transitionsExamined ?? 0;
  }

  const soleCoach = roster === null ? null : soleCoachRiskRegister(roster);
  if (soleCoach === null) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_ROSTER_ABSENT,
        'no coach roster was supplied, so an answer about a conflict cannot say whether the coach it names was the only one that team had',
        {}
      )
    );
  } else {
    meta.rosterEntriesConsulted += soleCoach.meta?.teamsExamined ?? 0;
  }

  return {
    engines: { graph, table, calendar, registry },
    schedule,
    state,
    verification,
    travel,
    roster,
    soleCoach,
    findings,
    meta,
    status: deriveAttributionStatus(findings),
  };
}
