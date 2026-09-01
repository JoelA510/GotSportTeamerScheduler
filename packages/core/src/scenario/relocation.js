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
import { CONSTRAINT_SEVERITY } from '../constraints/reasonCodes.js';
import { checkKickoffAvailability } from '../availability/kickoff.js';
import { DEFAULT_SIZE_RANK, checkSizeEligibility } from '../facility/eligibility.js';
import { bookingsOverlapInTime } from '../facility/occupancy.js';
import { FACILITY_REASON, FACILITY_STATUS } from '../facility/reasonCodes.js';
import { buildReserveCapacityReport } from '../reserve/capacity.js';
import { RESERVE_REASON } from '../reserve/reasonCodes.js';

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
 * Four filters, each stated:
 *
 * 1. **Not at a withdrawn venue.** Obvious, and the caller names them.
 * 2. **A leaf surface.** A parent pitch is bookable, but booking Alder Pitch 1
 *    takes 1A and 1B with it, so proposing onto a parent is strictly more
 *    disruptive than proposing onto a half. `checkOccupancy()` would refuse the
 *    parent anyway the moment either half is in use.
 * 3. **Big enough, by `checkSizeEligibility()` and not by a second rule.**
 *    Whether a format fits a patch of ground is `facility/eligibility.js`'s
 *    question, and it is asked here rather than answered again. This filter used
 *    to judge from the *smallest* declared size, which excluded every surface
 *    declaring more than one — Brookside's Upper 1 and Upper 2 declare
 *    `["7v7","9v9"]`, are `allowed` for 9v9 by `checkSizeEligibility()` and are
 *    counted as 9v9 ground by the reserve adapter, and were nonetheless refused
 *    here, so a venue withdrawal reported 9v9 games unrelocatable while legal
 *    ground stood empty.
 * 4. **Within `maxGradesAbove` size grades of the format.** The size policy is
 *    downward-closed, so *every* 11v11 pitch is technically eligible for a 7v7
 *    game and a search that took the policy literally would offer the stadium.
 *    One grade up is the club's own practice — a 7v7 game on a 9v9 pitch is a
 *    real arrangement with a real cost (`LINING_MISMATCH`); a 7v7 game on the
 *    11v11 stadium is a different conversation.
 *
 *    **The grade of a surface is its largest declared size**, which is the same
 *    quantity `checkSizeEligibility()` measures "big enough" against. Reading the
 *    floor off the largest and the ceiling off the smallest would be the two
 *    disagreeing rules again, one level down: a surface would be both big enough
 *    *because* its largest fits and not oversized *because* its smallest is
 *    close, which is a claim about two different patches of ground. A surface
 *    declaring `["4v4","11v11"]` is the stadium, and the smallest-size ceiling
 *    would have offered it to a Minis game as "one grade up" — exactly the case
 *    this filter exists to refuse.
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
  // The rank table travels with the eligibility question so the two cannot be
  // asked against different orderings.
  const sizeOptions = query.sizeRank ? { sizeRank: query.sizeRank } : {};

  return Object.values(graph.surfaces)
    .filter((surface) => !excluded.has(surface.venueId))
    .filter((surface) => surface.childIds.length === 0)
    .filter((surface) => {
      const ranks = surface.sizes
        .map((size) => rankTable[size])
        .filter((rank) => typeof rank === 'number');
      // Nothing rankable to measure a grade against; `checkSizeEligibility()`
      // says `SIZE_UNKNOWN_FORMAT` about the same surface.
      if (ranks.length === 0) return false;
      // The ceiling is this module's own policy and nothing else's.
      if (Math.max(...ranks) > wanted + maxGradesAbove) return false;
      // "Big enough" is not this module's question.
      return (
        checkSizeEligibility(graph, { surfaceId: surface.id, format: query.format }, sizeOptions)
          .status === FACILITY_STATUS.ALLOWED
      );
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
 * Who a game or a held slot commits, for the clash the facility model cannot see.
 *
 * **A surface knows who is standing on it, never who is playing.**
 * `checkOccupancy()` compares ground against ground, so two games sharing a
 * team on two different surfaces at the same minute are both perfectly legal
 * placements and one impossible afternoon. The team id is preferred and the
 * label is the fallback, because this corpus carries rows with a label and no
 * id; a side with neither is skipped rather than folded into a single empty
 * key, which would make every anonymous side clash with every other one.
 *
 * @param {Object} row - a schedule game or a `ReservedSlotSchema` row
 * @returns {string[]}
 */
function teamsOf(row) {
  /** @type {string[]} */
  const teams = [];
  for (const side of ['home', 'away']) {
    const id = row[`${side}TeamId`];
    const label = row[`${side}Label`];
    const key = id ? `id:${id}` : label ? `label:${label}` : null;
    if (key !== null && !teams.includes(key)) teams.push(key);
  }
  return teams;
}

/**
 * One reserved slot as a booking, so held ground is ground already occupied.
 *
 * @param {Object} slot - a `ReservedSlotSchema` row
 * @returns {import('../facility/types.js').FacilityBooking}
 */
function bookingForReservedSlot(slot) {
  return {
    id: `reserved:${slot.id}`,
    surfaceId: slot.surfaceId,
    date: slot.date,
    startMinutes: slot.startMinutes,
    endMinutes: slot.endMinutes,
    format: slot.format ?? null,
    label: slot.label ?? `reserved slot ${slot.id}`,
  };
}

/**
 * Capacity codes this proposer does **not** lift into its plan's findings.
 *
 * Every one of them answers the requirement `proposeRelocations()` invents for
 * its own grid derivation — `slots: Math.max(1, perDate)`, computed from the
 * displaced set a moment earlier — rather than a requirement an operator stated
 * about the branch. Two consequences make lifting them wrong rather than merely
 * noisy.
 *
 * - **They restate, worse, what this plan already reports.** "The ground cannot
 *   hold all of them" is exactly the fact `unrelocatable` carries, per game,
 *   with a reason, as `SCENARIO_RELOCATION_UNAVAILABLE` and a TIME TBD fixture.
 *   A second copy at date granularity adds no information and names no game.
 * - **They would put shelving on the wrong side of this module's own line.**
 *   `docs/SCENARIOS.md` states it: a branch that *shelves* games is
 *   `compromised` and promotable, and a branch that *loses* one carries
 *   `FIXTURE_DROPPED` at blocking and is refused. A capacity shortfall is the
 *   cause of shelving, so blocking on it would make every venue-withdrawal
 *   branch with a single TIME TBD fixture unpromotable — including the
 *   acceptance run, whose twelve are the documented answer rather than a fault.
 *
 * They stay on `capacities` in full, where a caller asking about the ground
 * rather than about the branch can read them.
 *
 * @type {ReadonlySet<string>}
 */
const ANSWERS_THE_PROPOSERS_OWN_REQUIREMENT = Object.freeze(
  new Set([
    RESERVE_REASON.RESERVE_CAPACITY_BELOW_REQUIREMENT,
    RESERVE_REASON.RESERVE_CAPACITY_AT_REQUIREMENT,
    RESERVE_REASON.RESERVE_CAPACITY_CONDITIONAL_SHORTFALL,
  ])
);

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
 * @param {ReadonlyArray<Object>} [input.reservedSlots] - the branch's own `ReservedSlotSchema` rows; ground already held
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
      capacities: [],
      findings,
      status: deriveScenarioStatus(findings),
      meta,
    };
  }

  /**
   * Ground the branch already holds.
   *
   * A reserved slot is a commitment, not a hint: the record set is one a
   * scenario override may edit, so a branch that holds a pitch for a
   * tournament must not then be offered that pitch as spare replacement
   * ground. They go in twice on purpose — to the capacity report, so its
   * `reserved` and `spare` counts are about the branch's own ground, and to the
   * booking table below, so `checkOccupancy()` refuses a candidate standing on
   * one.
   */
  const reservedSlots = input.reservedSlots ?? [];

  /**
   * The grid, from the capacity report under the branch's own engines.
   *
   * One report per format, because a capacity report has exactly one stated
   * format and a grid derived for 7v7 says nothing about 9v9 occupancy.
   */
  /** @type {Map<string, number[]>} */
  const grid = new Map();
  /**
   * Every report, whole.
   *
   * This was `capacity`: **one** report, arbitrarily the first, with every
   * report's `findings` and `status` dropped. Two blocking codes could
   * therefore reach nothing — `RESERVE_CAPACITY_VACUOUS`, which says the report
   * generated no slot at all so every requirement it met was met by an empty
   * count, and `RESERVED_SLOT_UNCOVERED`, which says a reservation stands on
   * ground this report does not cover. The first is the worse of the two here:
   * an empty grid and a season with no spare ground both make the search report
   * *"nowhere to go"*, and nothing distinguished them.
   *
   * @type {Object[]}
   */
  const capacities = [];
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
      reservedSlots: [...reservedSlots],
      bookings: [],
    });
    capacities.push(report);
    // **The report's own verdict, carried rather than discarded.** What is
    // lifted into the plan's findings is everything that impeaches the report:
    // it examined nothing, it does not cover ground somebody reserved, a
    // reservation sits off its grid, a date is over its own cap. Those are
    // things this proposer cannot say for itself, and while they were dropped a
    // blocking finding could not reach `plan.status`, `runScenario()`'s result
    // or `promoteScenario()`'s gate.
    //
    // `info` provenance is not lifted — `SLOT_CONDITION_SATISFIED` per
    // generated slot and `RESERVE_CAPACITY_BOUND` per date run to hundreds of
    // entries on a real season and would bury the branch's own report without
    // moving a single status. Nothing is dropped: every report is on
    // `capacities` in full.
    for (const finding of report.findings) {
      if (finding.severity === CONSTRAINT_SEVERITY.INFO) continue;
      if (ANSWERS_THE_PROPOSERS_OWN_REQUIREMENT.has(finding.code)) continue;
      findings.push(/** @type {import('./types.js').ScenarioFinding} */ (finding));
    }
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
  /**
   * Who is already committed when, per date, growing as proposals land.
   *
   * The half of "what already stands on the ground" that the ground itself
   * cannot answer. Seeded from the same rows, walked the same way, and checked
   * before a candidate is graded — because a grade is a claim about the quality
   * of a placement and must not be issued on one that is not legal.
   */
  /** @type {Map<string, Array<{ teams: string[], booking: import('../facility/types.js').FacilityBooking }>>} */
  const commitmentsByDate = new Map();
  const commit = (date, teams, booking) => {
    if (teams.length === 0) return;
    const bucket = commitmentsByDate.get(date) ?? [];
    bucket.push({ teams, booking });
    commitmentsByDate.set(date, bucket);
  };
  for (const game of input.survivors) {
    const bucket = bookingsByDate.get(game.date) ?? [];
    const booking = bookingFor(game);
    bucket.push(booking);
    bookingsByDate.set(game.date, bucket);
    commit(game.date, teamsOf(game), booking);
  }
  for (const slot of reservedSlots) {
    const bucket = bookingsByDate.get(slot.date) ?? [];
    const booking = bookingForReservedSlot(slot);
    bucket.push(booking);
    bookingsByDate.set(slot.date, bucket);
    commit(slot.date, teamsOf(slot), booking);
    // **Counted here, where the slot becomes a booking**, rather than off
    // `reservedSlots.length` where it was only a restatement of the input: a
    // counter named for what the search *did* must be incremented where the
    // search does it, or deleting this loop would leave it claiming otherwise.
    meta.reservedSlotsHonoured += 1;
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
    const commitments = commitmentsByDate.get(game.date) ?? [];
    const teams = teamsOf(row);
    const occupancy = row.endMinutes === null ? null : row.endMinutes - row.startMinutes;
    /**
     * Would this kickoff put one of this game's teams in two places at once?
     *
     * Decided by `bookingsOverlapInTime()` — the facility model's own answer,
     * rather than a second one written here — which returns `null` for an
     * unknown footprint. An undecidable pair is not treated as a clash: the
     * unknown-footprint case is reported by the rule engine in its own right,
     * and refusing every candidate over it would silently shrink the search.
     */
    const teamClash = (kickoff) => {
      if (teams.length === 0) return null;
      const candidate = {
        id: game.gameId,
        surfaceId: game.surfaceId,
        date: game.date,
        startMinutes: kickoff,
        endMinutes: occupancy === null ? null : kickoff + occupancy,
      };
      for (const entry of commitments) {
        if (entry.booking.id === game.gameId) continue;
        if (!entry.teams.some((team) => teams.includes(team))) continue;
        if (bookingsOverlapInTime(candidate, entry.booking) !== true) continue;
        return entry.booking;
      }
      return null;
    };
    let refusedForTeamClash = 0;
    /**
     * Every candidate slot this game was offered, before any filter.
     *
     * `candidatesConsidered` used to be `options.length` — the slots that
     * *survived* — and on an unrelocatable game that branch runs only when
     * `options.length === 0`, so the field was structurally nought while the
     * run-wide counter beside it read in the thousands. `CLAUDE.md` §3 names
     * that shape: a meta-assertion nothing can make fail is not one. The
     * per-game counts now sum to `meta.candidatesConsidered`, so neither can
     * drift from the other without the reconciliation in the test failing.
     */
    let consideredForThisGame = 0;
    /** @type {Array<{ surfaceId: string, startMinutes: number, grade: string, driftMinutes: number, codes: string[] }>} */
    const options = [];

    for (const surfaceId of policy.surfaceIds) {
      for (const kickoff of grid.get(`${format}|${game.date}|${surfaceId}`) ?? []) {
        meta.candidatesConsidered += 1;
        consideredForThisGame += 1;
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
        // **Legality before grade.** The ground is free; the teams may not be.
        if (teamClash(kickoff) !== null) {
          refusedForTeamClash += 1;
          meta.candidatesRefusedTeamClash += 1;
          continue;
        }
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

    const candidatesConsidered = consideredForThisGame;
    if (options.length === 0) {
      unrelocatable.push({
        gameId: game.gameId,
        label: game.label,
        reason: `the scenario withdraws the ground it stood on (${game.codes.join(', ')}) and none of the ${candidatesConsidered} candidate slot(s) on ${game.date} across ${policy.surfaceIds.length} replacement surface(s) is legal for it${refusedForTeamClash === 0 ? '' : ` (${refusedForTeamClash} otherwise-free slot(s) would have put one of its teams in two places at once)`}; kept visible as TIME TBD rather than dropped (incident 10)`,
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
    const held = bookingFor(row, toSlot);
    bookings.push(held);
    bookingsByDate.set(game.date, bookings);
    // The teams are held from this point on as well, so the next displaced game
    // sharing one of them cannot be offered the same minute on other ground.
    commit(game.date, teams, held);
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
    capacities,
    findings,
    status: deriveScenarioStatus(findings),
    meta,
  };
}
