/**
 * **Where a displaced game could actually go — proposed, never solved.**
 *
 * The build plan's acceptance test asks a scenario report to name *"the
 * affected format, the replacement venues, and the added compromises"*. The
 * re-solver cannot supply the middle one, and the reason is structural rather
 * than a bug: `resolve/inventory.js` `candidateSlotsFor()` derives a game's
 * candidate venue from **its own anchor surface** and fixes every candidate at
 * **`anchor.date`**. It is the anti-slot-inventor guarantee working exactly as
 * designed — a re-solve re-places games onto slots the baseline already used —
 * and it means a re-solve of "no venue X" produces TIME TBD fixtures each
 * correctly naming `PERMIT_BLACKOUT` and **no replacement venue at all**.
 *
 * So this module searches, and says so. It runs
 * {@link import('../reserve/capacity.js').buildReserveCapacityReport} under the
 * *branch's own* engines to find spare ground of the right format on the right
 * dates, pairs each displaced game with a slot under a **stated policy**, and
 * emits a change request naming those slots. `changeRequestApply` already
 * accepts an arbitrary date and surface, and `isSlotAdmissible()` already
 * admits an out-of-inventory slot for exactly the game the request named.
 *
 * **Widening `candidateSlotsFor()` was the alternative and was rejected.** It
 * changes the anti-slot-inventor guarantee for every caller and silently
 * redefines `reoptimiseWholeSeason()`, whose 8-games-moved figure is a headline
 * result of Prompt 4.2.
 *
 * ## The sentence that must survive every rewrite of the report
 *
 * These replacements were **proposed by `proposeRelocations()` under a stated
 * policy**. The solver did not find them. Every finding this module emits names
 * the policy, and `docs/SCENARIOS.md` §5 says it in as many words, because a
 * report that let a reader believe the optimiser discovered a second venue
 * would be claiming a capability this package does not have.
 *
 * ## The negative control
 *
 * Running the same scenario with the proposer switched off is not a lesser
 * deliverable, it is the control: every displaced game becomes TIME TBD naming
 * the code the branch introduced, and no replacement venue appears anywhere.
 * That is what proves the replacements came from a real search rather than from
 * a list somebody typed.
 *
 * @module scenario/relocation
 */

import { AVAILABILITY_SEVERITY } from '../availability/reasonCodes.js';
import { checkKickoffAvailability } from '../availability/kickoff.js';
import { DEFAULT_SIZE_RANK } from '../facility/eligibility.js';
import { FACILITY_REASON } from '../facility/reasonCodes.js';
import { buildReserveCapacityReport } from '../reserve/capacity.js';

import {
  RELOCATION_POLICY,
  REPLACEMENT_GRADE,
  SCENARIO_REASON,
  createScenarioMeta,
  deriveScenarioStatus,
  makeScenarioFinding,
} from './reasonCodes.js';
import { RelocationPolicySchema } from './schemas.js';

/**
 * Which findings make a replacement a compromise rather than a clean swap.
 *
 * **One entry, and the docstring is where the second one is refused.** The
 * build plan's acceptance test asks for compromises such as *"games on
 * undersized or wrongly-lined pitches"*. The wrongly-lined half is here and
 * composes with no new code. **The undersized half is unreachable by design**:
 * `SIZE_TOO_SMALL` is `blocking` and the size policy is downward-closed, so a
 * game is refused rather than placed on ground too small for it — and retyping
 * the size constraint to manufacture the case would weaken a hard physical
 * constraint in order to satisfy a test. `docs/SCENARIOS.md` §6 says so in the
 * report's own words.
 *
 * @type {ReadonlyArray<string>}
 */
const COMPROMISE_CODES = Object.freeze([/** @type {string} */ (FACILITY_REASON.LINING_MISMATCH)]);

/** How many example ids an aggregate finding carries. */
const EXAMPLE_LIMIT = 5;

/**
 * Candidate replacement ground for a format, derived rather than typed in.
 *
 * Three filters, each stated:
 *
 * 1. **Not at a withdrawn venue.** Obvious, and the caller names them.
 * 2. **A leaf surface.** A parent pitch is bookable, but booking Alder Pitch 1
 *    takes 1A and 1B with it, so proposing onto a parent is strictly more
 *    disruptive than proposing onto a half. `checkOccupancy()` would refuse the
 *    parent anyway the moment either half is in use.
 * 3. **Within `maxGradesAbove` size grades of the format.** The size policy is
 *    downward-closed, so *every* 11v11 pitch is technically eligible for a 7v7
 *    game and a search that took the policy literally would offer the stadium.
 *    One grade up is the club's own practice — a 7v7 game on a 9v9 pitch is a
 *    real arrangement with a real cost (`LINING_MISMATCH`); a 7v7 game on the
 *    11v11 stadium is a different conversation.
 *
 * The result is **the input to a stated policy, not the policy itself**:
 * `RelocationPolicySchema.surfaceIds` has no default, exactly as
 * `ReserveCapacityInputSchema.earliestKickoffMinutes` has none.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {{ format: string, excludeVenueIds?: ReadonlyArray<string>, maxGradesAbove?: number, sizeRank?: Record<string, number> }} query
 * @returns {string[]}
 */
export function replacementSurfacesFor(graph, query) {
  const rankTable = query.sizeRank ?? graph.sizeRank ?? DEFAULT_SIZE_RANK;
  const wanted = rankTable[query.format];
  if (wanted === undefined) {
    throw new Error(
      `scenario: format "${query.format}" has no size rank, so "one grade up" has no meaning for it; state the candidate surfaces instead`
    );
  }
  const excluded = new Set(query.excludeVenueIds ?? []);
  const maxGradesAbove = query.maxGradesAbove ?? 1;

  return Object.values(graph.surfaces)
    .filter((surface) => !excluded.has(surface.venueId))
    .filter((surface) => surface.childIds.length === 0)
    .filter((surface) => {
      const ranks = surface.sizes
        .map((size) => rankTable[size])
        .filter((rank) => typeof rank === 'number');
      if (ranks.length === 0) return false;
      const smallest = Math.min(...ranks);
      return smallest >= wanted && smallest <= wanted + maxGradesAbove;
    })
    .map((surface) => surface.id)
    .sort();
}

/**
 * Order the slots offered to one displaced game, cheapest first under a policy.
 *
 * @param {string} policy
 * @returns {(a: Object, b: Object) => number}
 */
function comparatorFor(policy) {
  const gradeRank = (option) => (option.grade === REPLACEMENT_GRADE.CLEAN ? 0 : 1);
  if (policy === RELOCATION_POLICY.PREFER_CLEAN) {
    return (a, b) =>
      gradeRank(a) - gradeRank(b) ||
      a.driftMinutes - b.driftMinutes ||
      a.startMinutes - b.startMinutes ||
      a.surfaceId.localeCompare(b.surfaceId);
  }
  return (a, b) =>
    a.driftMinutes - b.driftMinutes ||
    gradeRank(a) - gradeRank(b) ||
    a.startMinutes - b.startMinutes ||
    a.surfaceId.localeCompare(b.surfaceId);
}

/**
 * One booking record for a game, in the shape the facility model wants.
 *
 * @param {Object} game
 * @param {import('../resolve/types.js').Slot} [slot]
 * @returns {import('../facility/types.js').FacilityBooking}
 */
function bookingFor(game, slot) {
  const at = slot ?? {
    date: game.date,
    surfaceId: game.surfaceId,
    startMinutes: game.startMinutes,
  };
  const occupancy = game.endMinutes === null ? null : game.endMinutes - game.startMinutes;
  return {
    id: String(game.id),
    surfaceId: at.surfaceId,
    date: at.date,
    startMinutes: at.startMinutes,
    endMinutes: occupancy === null ? null : at.startMinutes + occupancy,
    format: game.format ?? null,
    label: `${game.homeLabel ?? ''} v ${game.awayLabel ?? ''}`,
  };
}

/**
 * Propose a replacement slot for each displaced game.
 *
 * @param {{ graph: Object, table: Object, calendar: Object, registry?: Object }} engines - the **branch's** engines
 * @param {Object} input
 * @param {ReadonlyArray<import('./types.js').DisplacedGame>} input.displaced
 * @param {ReadonlyArray<Object>} input.survivors - every game the branch leaves standing, so a proposal cannot double-book
 * @param {Record<string, Object>} input.gamesById - the baseline rows, for footprints and labels
 * @param {Object} input.policy - see `RelocationPolicySchema`
 * @param {{ slots: number, label: string, source: string }} input.requirement - what the ground is being asked to hold
 * @returns {import('./types.js').RelocationPlan}
 */
export function proposeRelocations(engines, input) {
  const policy = RelocationPolicySchema.parse(input.policy);
  const meta = createScenarioMeta();
  /** @type {import('./types.js').ScenarioFinding[]} */
  const findings = [];

  const displaced = [...input.displaced].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinutes - b.startMinutes ||
      a.gameId.localeCompare(b.gameId)
  );
  const dates = [...new Set(displaced.map((game) => game.date))].sort();
  const formats = [
    ...new Set(displaced.map((game) => game.format).filter((f) => typeof f === 'string')),
  ].sort();

  if (displaced.length === 0 || dates.length === 0 || formats.length === 0) {
    // Nothing to propose. Not a finding of its own: `runScenario()` reports the
    // displaced count, and a proposer that was handed nothing has nothing to
    // say about the season.
    return {
      policy: policy.policy,
      surfaceIds: Object.freeze([...policy.surfaceIds]),
      proposals: [],
      unrelocatable: [],
      capacity: null,
      findings,
      status: deriveScenarioStatus(findings),
      meta,
    };
  }

  /**
   * The grid, from the capacity report under the branch's own engines.
   *
   * One report per format, because a capacity report has exactly one stated
   * format and a grid derived for 7v7 says nothing about 9v9 occupancy.
   */
  /** @type {Map<string, number[]>} */
  const grid = new Map();
  /** @type {Object|null} */
  let capacity = null;
  for (const format of formats) {
    const forFormat = displaced.filter((game) => game.format === format);
    const perDate = Math.max(
      ...dates.map((date) => forFormat.filter((game) => game.date === date).length)
    );
    const report = buildReserveCapacityReport(engines, {
      name: `replacement ground for ${format} (${policy.source})`,
      format,
      dates: [...new Set(forFormat.map((game) => game.date))].sort(),
      surfaceIds: [...policy.surfaceIds],
      cadenceMinutes: policy.cadenceMinutes,
      earliestKickoffMinutes: policy.earliestKickoffMinutes,
      latestKickoffMinutes: policy.latestKickoffMinutes,
      requirement: {
        slots: Math.max(1, perDate),
        label: input.requirement.label,
        source: input.requirement.source,
      },
      reservedSlots: [],
      bookings: [],
    });
    if (capacity === null) capacity = report;
    for (const dateRow of report.dates) {
      for (const surfaceRow of dateRow.bySurface) {
        grid.set(`${format}|${dateRow.date}|${surfaceRow.surfaceId}`, [
          ...surfaceRow.kickoffMinutes,
        ]);
      }
    }
  }

  /**
   * What already stands on the ground, per date, growing as proposals land.
   *
   * A proposal that double-booked a surface would be handed to
   * `applyChangeRequest()` only for `dislodge` to lift a published neighbour
   * back off it, so the search checks each candidate against everything the
   * branch leaves standing **plus every earlier proposal**.
   */
  /** @type {Map<string, import('../facility/types.js').FacilityBooking[]>} */
  const bookingsByDate = new Map();
  for (const game of input.survivors) {
    const bucket = bookingsByDate.get(game.date) ?? [];
    bucket.push(bookingFor(game));
    bookingsByDate.set(game.date, bucket);
  }

  /** @type {import('./types.js').RelocationProposal[]} */
  const proposals = [];
  /** @type {import('./types.js').UnrelocatableGame[]} */
  const unrelocatable = [];
  const compare = comparatorFor(policy.policy);

  for (const game of displaced) {
    const row = input.gamesById[game.gameId];
    if (!row) {
      throw new Error(
        `scenario: proposeRelocations() was handed displaced game "${game.gameId}" and no baseline row for it; the footprint that travels with a game comes from the row, and inventing one would be a second duration model`
      );
    }
    const format = /** @type {string} */ (game.format);
    const bookings = bookingsByDate.get(game.date) ?? [];
    /** @type {Array<{ surfaceId: string, startMinutes: number, grade: string, driftMinutes: number, codes: string[] }>} */
    const options = [];

    for (const surfaceId of policy.surfaceIds) {
      for (const kickoff of grid.get(`${format}|${game.date}|${surfaceId}`) ?? []) {
        meta.candidatesConsidered += 1;
        const answer = checkKickoffAvailability(
          engines.graph,
          engines.table,
          engines.calendar,
          {
            surfaceId,
            date: game.date,
            kickoffMinutes: kickoff,
            format,
            ignoreBookingIds: [game.gameId],
          },
          { existingBookings: bookings }
        );
        if (answer.findings.some((f) => f.severity === AVAILABILITY_SEVERITY.BLOCKING)) continue;
        const codes = [
          ...new Set(
            answer.findings
              .map((finding) => finding.code)
              .filter((code) => COMPROMISE_CODES.includes(code))
          ),
        ].sort();
        options.push({
          surfaceId,
          startMinutes: kickoff,
          grade: codes.length === 0 ? REPLACEMENT_GRADE.CLEAN : REPLACEMENT_GRADE.COMPROMISED,
          driftMinutes: Math.abs(kickoff - game.startMinutes),
          codes,
        });
      }
    }

    const candidatesConsidered = options.length;
    if (candidatesConsidered === 0) {
      unrelocatable.push({
        gameId: game.gameId,
        label: game.label,
        reason: `the scenario withdraws the ground it stood on (${game.codes.join(', ')}) and no candidate slot on ${game.date} across ${policy.surfaceIds.length} replacement surface(s) is legal for it; kept visible as TIME TBD rather than dropped (incident 10)`,
        codes: Object.freeze([...game.codes]),
        constraintIds: Object.freeze([...game.constraintIds]),
        candidatesConsidered,
      });
      meta.relocationsUnavailable += 1;
      continue;
    }

    const [chosen] = [...options].sort(compare);
    const toSlot = {
      date: game.date,
      surfaceId: chosen.surfaceId,
      startMinutes: chosen.startMinutes,
    };
    const surface = engines.graph.surfaces[chosen.surfaceId];
    proposals.push({
      gameId: game.gameId,
      label: game.label,
      format,
      policy: policy.policy,
      grade: chosen.grade,
      from: { date: game.date, surfaceId: game.surfaceId, startMinutes: game.startMinutes },
      to: toSlot,
      fromVenueId: game.venueId,
      toVenueId: surface?.venueId ?? '',
      driftMinutes: chosen.driftMinutes,
      compromiseCodes: Object.freeze([...chosen.codes]),
      candidatesConsidered,
    });
    meta.relocationsProposed += 1;
    if (chosen.grade === REPLACEMENT_GRADE.COMPROMISED) meta.relocationsCompromised += 1;
    // The slot is held from this point on, keyed the way the capacity report
    // spells a candidate so the two can be reconciled.
    bookings.push(bookingFor(row, toSlot));
    bookingsByDate.set(game.date, bookings);
  }

  if (proposals.length > 0) {
    const venues = [...new Set(proposals.map((p) => p.toVenueId))].sort();
    const surfaces = [...new Set(proposals.map((p) => p.to.surfaceId))].sort();
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_RELOCATION_PROPOSED,
        `proposeRelocations() searched ${meta.candidatesConsidered} candidate slot(s) under the "${policy.policy}" policy and proposed ${proposals.length} replacement(s) on ${venues.join(', ')}. These were **proposed**, not solved: the re-solver cannot move a game to another venue, and it is being handed these slots by name`,
        {
          policy: policy.policy,
          policySource: policy.source,
          proposed: proposals.length,
          candidatesConsidered: meta.candidatesConsidered,
          venueIds: venues,
          surfaceIds: surfaces,
          formats,
        }
      )
    );
  }

  const compromised = proposals.filter((p) => p.grade === REPLACEMENT_GRADE.COMPROMISED);
  if (compromised.length > 0) {
    const codes = [...new Set(compromised.flatMap((p) => p.compromiseCodes))].sort();
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_RELOCATION_COMPROMISED,
        `${compromised.length} of the ${proposals.length} replacement(s) are legal but add ${codes.join(', ')}: ${[...new Set(compromised.map((p) => p.to.surfaceId))].sort().join(', ')} are size-eligible for the format under the downward-closed policy and painted for another one`,
        {
          policy: policy.policy,
          compromised: compromised.length,
          proposed: proposals.length,
          codes,
          surfaceIds: [...new Set(compromised.map((p) => p.to.surfaceId))].sort(),
          exampleGameIds: compromised.slice(0, EXAMPLE_LIMIT).map((p) => p.gameId),
        }
      )
    );
  }

  if (unrelocatable.length > 0) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_RELOCATION_UNAVAILABLE,
        `${unrelocatable.length} displaced game(s) have no legal replacement slot on their own date across the ${policy.surfaceIds.length} stated replacement surface(s), and are carried as TIME TBD with a reason rather than dropped (incident 10)`,
        {
          policy: policy.policy,
          unrelocatable: unrelocatable.length,
          surfaceCount: policy.surfaceIds.length,
          exampleGameIds: unrelocatable.slice(0, EXAMPLE_LIMIT).map((entry) => entry.gameId),
          dates: [...new Set(unrelocatable.map((entry) => input.gamesById[entry.gameId]?.date))]
            .filter(Boolean)
            .sort(),
        }
      )
    );
  }

  return {
    policy: policy.policy,
    surfaceIds: Object.freeze([...policy.surfaceIds]),
    proposals,
    unrelocatable,
    capacity,
    findings,
    status: deriveScenarioStatus(findings),
    meta,
  };
}
