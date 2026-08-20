/**
 * Reserve capacity: how much ground a date actually holds, against a stated
 * requirement, and which constraint caps the number.
 *
 * > *"Per-date reserved capacity against a stated requirement, e.g. 'every
 * > Saturday from 09/12 must hold all 14 teams if the league sends them all
 * > home.' Report slots reserved / assigned / spare / meets-requirement, and
 * > which constraint caps the number."*
 *
 * ## Where every number comes from
 *
 * | number | decided by |
 * | --- | --- |
 * | is this kickoff legal here on this date | `availability/kickoff.js` — `checkKickoffAvailability()` |
 * | which of the four edges bounds it, and by how much | the same call's `bindingKinds` / `slackMinutes`, ordered by `orderByTightness()` |
 * | how long the format occupies the ground | `timing/formatTiming.js`, through that call |
 * | how far apart two kickoffs on one field must be | the format's `blockMinutes`, from `game_formats.csv` |
 * | does this ground overlap other ground | `facility/occupancy.js` — `surfacesConflict()`, via `conditions.js` |
 * | which registry constraint claims a blocking code | `resolve/errors.js` — `registryConstraintIdsFor()` |
 *
 * Nothing in this file re-implements any of them. What it adds is the counting:
 * a grid of candidate kickoffs per surface per date, each candidate put through
 * the Phase 1.3 check, and the survivors tallied — with conditional ground kept
 * in its own column, because a slot that exists only while a neighbouring pitch
 * is empty is not the same asset as one that always exists.
 *
 * ## Two deliberate choices, both of which change the numbers
 *
 * 1. **Candidates are judged with no existing bookings.** Capacity is a question
 *    about the ground and the clock — *how many slots could this date hold* —
 *    not about how many are still free after the club filled some in. What is
 *    already reserved is reported separately as `reserved` and `spare`, and what
 *    stands on *overlapping* ground is reported through the condition. Feeding
 *    the reservations back in as occupancy would make the capacity of a fully
 *    booked date zero.
 * 2. **The grid is anchored at a stated first kickoff, not at the permit open.**
 *    A permit that opens at 07:00 does not mean the club plays at 07:00.
 *    `earliestKickoffMinutes` is a required input with no default for exactly
 *    that reason, and {@link buildReserveCapacityReport} proves the anchor
 *    against reality: every reserved slot must land on a generated one, or the
 *    date reports `RESERVED_SLOT_OFF_GRID` at `blocking`. A capacity model that
 *    cannot account for the club's own published reservations is wrong, and a
 *    number from a wrong model is worse than no number.
 *
 * The candidate loop stops at the first rejection rather than scanning the day.
 * That is sound and not an optimisation: with no bookings in play the three
 * remaining edges — permit close, lights-off and the daylight limit — are all
 * monotone in the kickoff, so once one is broken every later kickoff breaks it
 * too. The rejected candidate is kept, because it is what names the capping
 * constraint.
 *
 * @module reserve/capacity
 */

import { resolvePermitWindow } from '../availability/calendar.js';
import { checkKickoffAvailability } from '../availability/kickoff.js';
import { AVAILABILITY_SEVERITY } from '../availability/reasonCodes.js';
import { getSurface } from '../facility/facilityGraph.js';
import { registryConstraintIdsFor } from '../resolve/errors.js';

import { conditionsForSurfaces, evaluateSlotCondition } from './conditions.js';
import {
  CONDITION_VERDICT,
  RESERVE_REASON,
  createReserveMeta,
  deriveReserveStatus,
  makeReserveFinding,
  mergeReserveMeta,
} from './reasonCodes.js';
import { ReserveCapacityInputSchema } from './schemas.js';
import { makeReservedSlot, slotIsSettled } from './slots.js';

/** How a candidate slot's id is spelled. Stable, and derived from its position. */
export function capacitySlotId(date, surfaceId, kickoffMinutes) {
  return `${date}|${surfaceId}|${kickoffMinutes}`;
}

/**
 * Build the per-date reserve capacity report.
 *
 * @param {{ graph: import('../facility/types.js').FacilityGraph, table: import('../timing/types.js').FormatTimingTable, calendar: import('../availability/types.js').AvailabilityCalendar, registry?: import('../constraints/types.js').ConstraintRegistry }} engines
 * @param {Object} rawInput - see `ReserveCapacityInputSchema`
 * @returns {import('./types.js').ReserveCapacityReport}
 */
export function buildReserveCapacityReport(engines, rawInput) {
  const { graph, table, calendar, registry } = engines ?? {};
  if (!graph || !table || !calendar) {
    throw new Error(
      'reserve: buildReserveCapacityReport needs { graph, table, calendar } as its first argument'
    );
  }
  const input = ReserveCapacityInputSchema.parse(rawInput);
  const meta = createReserveMeta();
  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];

  const dates = [...new Set(input.dates)].sort();
  const surfaceIds = [...new Set(input.surfaceIds)].sort();
  const conditions = conditionsForSurfaces(graph, surfaceIds);

  const reservedSlots = input.reservedSlots.map((slot) => makeReservedSlot(slot));
  const bookings = /** @type {ReadonlyArray<import('../facility/types.js').FacilityBooking>} */ (
    input.bookings
  );
  const reservedIds = new Set(reservedSlots.map((slot) => slot.id));

  /** In scope: this format, on a date and surface the report covers. */
  const inScope = reservedSlots.filter(
    (slot) =>
      slot.format === input.format &&
      dates.includes(slot.date) &&
      surfaceIds.includes(slot.surfaceId)
  );
  meta.slotsExamined = inScope.length;

  /** @type {import('./types.js').DateCapacity[]} */
  const dateRows = [];

  for (const date of dates) {
    meta.datesExamined += 1;
    /** @type {import('./types.js').SurfaceCapacity[]} */
    const bySurface = [];

    for (const surfaceId of surfaceIds) {
      meta.surfaceDatesExamined += 1;
      const surface = getSurface(graph, surfaceId);
      const condition = conditions[surfaceId] ?? null;
      const reservedHere = inScope.filter(
        (slot) => slot.date === date && slot.surfaceId === surfaceId
      );

      /** @type {number[]} */
      const kickoffMinutes = [];
      let conditionSatisfied = 0;
      let conditionBlocked = 0;
      let conditionUndecidable = 0;
      /** @type {import('./types.js').SurfaceCapacity} */
      const row = {
        surfaceId,
        surfaceName: surface?.name ?? surfaceId,
        venueId: surface?.venueId ?? '',
        conditional: condition !== null,
        condition,
        kickoffMinutes,
        slots: 0,
        conditionSatisfied: 0,
        conditionBlocked: 0,
        conditionUndecidable: 0,
        reserved: reservedHere.length,
        firstRejectedKickoffMinutes: null,
        cappedByKinds: [],
        blockingCodes: [],
        constraintIds: [],
        slackMinutes: null,
      };

      for (
        let kickoff = Math.max(
          input.earliestKickoffMinutes,
          permitOpenFloor(calendar, surface, date)
        );
        kickoff <= input.latestKickoffMinutes;
        kickoff += input.cadenceMinutes
      ) {
        meta.candidatesTested += 1;
        const answer = checkKickoffAvailability(
          graph,
          table,
          calendar,
          { surfaceId, date, kickoffMinutes: kickoff, format: input.format },
          { existingBookings: [] }
        );
        const blocking = answer.findings.filter(
          (finding) => finding.severity === AVAILABILITY_SEVERITY.BLOCKING
        );
        if (blocking.length > 0) {
          row.firstRejectedKickoffMinutes = kickoff;
          row.cappedByKinds = [...answer.bindingKinds];
          row.blockingCodes = [...new Set(blocking.map((finding) => finding.code))].sort();
          row.constraintIds = registry ? registryConstraintIdsFor(registry, row.blockingCodes) : [];
          row.slackMinutes = answer.binding?.slackMinutes ?? null;
          break;
        }

        kickoffMinutes.push(kickoff);
        meta.slotsGenerated += 1;

        if (condition) {
          const evaluation = evaluateSlotCondition(
            graph,
            {
              id: capacitySlotId(date, surfaceId, kickoff),
              date,
              startMinutes: kickoff,
              endMinutes: answer.endMinutes,
              condition,
            },
            bookings,
            { ignoreBookingIds: [...reservedIds] }
          );
          mergeReserveMeta(meta, evaluation.meta);
          if (evaluation.verdict === CONDITION_VERDICT.SATISFIED) conditionSatisfied += 1;
          else if (evaluation.verdict === CONDITION_VERDICT.BLOCKED) conditionBlocked += 1;
          else conditionUndecidable += 1;
        }
      }

      row.slots = kickoffMinutes.length;
      row.conditionSatisfied = conditionSatisfied;
      row.conditionBlocked = conditionBlocked;
      row.conditionUndecidable = conditionUndecidable;

      const grid = new Set(kickoffMinutes);
      for (const slot of reservedHere) {
        if (grid.has(slot.startMinutes)) {
          meta.reservedSlotsMatched += 1;
          continue;
        }
        meta.reservedSlotsOffGrid += 1;
        findings.push(
          makeReserveFinding(
            RESERVE_REASON.RESERVED_SLOT_OFF_GRID,
            `reserved slot "${slot.id}" kicks off at minute ${slot.startMinutes} on ${row.surfaceName}, which is not one of the ${kickoffMinutes.length} slot(s) this model generates for ${date}`,
            {
              slotId: slot.id,
              date,
              surfaceId,
              startMinutes: slot.startMinutes,
              generatedKickoffMinutes: [...kickoffMinutes],
              earliestKickoffMinutes: input.earliestKickoffMinutes,
              cadenceMinutes: input.cadenceMinutes,
            }
          )
        );
      }

      bySurface.push(row);
    }

    dateRows.push(summariseDate(date, bySurface, inScope, input));
  }

  const bestSlotsBySurface = bestPerSurface(dateRows);
  for (const dateRow of dateRows) attributeCapping(dateRow, bestSlotsBySurface);

  for (const dateRow of dateRows) findings.push(...dateRow.findings);

  if (meta.datesExamined === 0 || meta.slotsGenerated === 0) {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVE_CAPACITY_VACUOUS,
        `this capacity report examined ${meta.datesExamined} date(s) and generated ${meta.slotsGenerated} slot(s), so every requirement it reports as met was met by an empty count`,
        {
          datesExamined: meta.datesExamined,
          surfaceDatesExamined: meta.surfaceDatesExamined,
          candidatesTested: meta.candidatesTested,
          slotsGenerated: meta.slotsGenerated,
        }
      )
    );
  }

  /** @type {Record<string, number>} */
  const slotsByDate = {};
  for (const dateRow of dateRows) slotsByDate[dateRow.date] = dateRow.slots;
  const counts = dateRows.map((dateRow) => dateRow.slots);

  return {
    name: input.name,
    format: input.format,
    requirement: input.requirement,
    cap: input.cap,
    cadenceMinutes: input.cadenceMinutes,
    earliestKickoffMinutes: input.earliestKickoffMinutes,
    dates: dateRows,
    slotsByDate,
    bestSlotsBySurface,
    minSlots: counts.length > 0 ? Math.min(...counts) : null,
    maxSlots: counts.length > 0 ? Math.max(...counts) : null,
    bareMinimumDates: dateRows.filter((row) => row.bareMinimum).map((row) => row.date),
    status: deriveReserveStatus(findings),
    findings,
    meta,
  };
}

/**
 * The earliest minute a permit lets anything start at this venue on this date.
 *
 * Which permit record governs a date — the weekday default or a date-scoped
 * exception, and which of two equally-applicable ones wins — is
 * `availability/calendar.js`'s `resolvePermitWindow()` answer and stays its
 * answer. A second reading of the Summit HS rows here would be free to disagree
 * with the first about the 09/12 early open.
 *
 * Returns `0` when there is no usable window, so the caller's stated first
 * kickoff governs and the candidate itself is refused by
 * `checkKickoffAvailability()` with the permit's own reason code — a blackout
 * must be *reported* as the thing that capped the date, not silently skipped.
 *
 * @param {import('../availability/types.js').AvailabilityCalendar} calendar
 * @param {import('../facility/types.js').FacilitySurface|null|undefined} surface
 * @param {string} date
 * @returns {number}
 */
function permitOpenFloor(calendar, surface, date) {
  if (!surface) return 0;
  const resolved = resolvePermitWindow(calendar, { venueId: surface.venueId, date });
  const window = resolved.window;
  if (!window || !window.hasPermit || window.openMinutes === null) return 0;
  return window.openMinutes;
}

/**
 * Fold one date's surfaces into its row, with the requirement and cap verdicts.
 *
 * @param {string} date
 * @param {import('./types.js').SurfaceCapacity[]} bySurface
 * @param {ReadonlyArray<import('./types.js').ReservedSlot>} inScope
 * @param {{ requirement: import('./types.js').CapacityRequirement, cap: import('./types.js').CapacityCap|null }} input
 * @returns {import('./types.js').DateCapacity}
 */
function summariseDate(date, bySurface, inScope, input) {
  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];

  const conditionalRows = bySurface.filter((row) => row.conditional);
  const unconditionalRows = bySurface.filter((row) => !row.conditional);
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);

  const unconditionalSlots = sum(unconditionalRows, 'slots');
  const conditionalSlots = sum(conditionalRows, 'slots');
  const conditionSatisfied = sum(conditionalRows, 'conditionSatisfied');
  const conditionBlocked = sum(conditionalRows, 'conditionBlocked');
  const conditionUndecidable = sum(conditionalRows, 'conditionUndecidable');
  const slots = unconditionalSlots + conditionalSlots;
  const available = unconditionalSlots + conditionSatisfied;

  const reservedOnDate = inScope.filter((slot) => slot.date === date);
  const reserved = reservedOnDate.length;
  const assigned = reservedOnDate.filter((slot) => slotIsSettled(slot)).length;

  const meetsRequirement = slots >= input.requirement.slots;
  const availableMeetsRequirement = available >= input.requirement.slots;
  const bareMinimum = slots === input.requirement.slots;

  const base = {
    date,
    slots,
    unconditionalSlots,
    conditionalSlots,
    available,
    requirement: input.requirement.slots,
    requirementLabel: input.requirement.label,
  };

  if (!meetsRequirement) {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVE_CAPACITY_BELOW_REQUIREMENT,
        `${date} holds ${slots} slot(s) against a stated requirement of ${input.requirement.slots} (${input.requirement.label})`,
        base
      )
    );
  } else if (bareMinimum) {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVE_CAPACITY_AT_REQUIREMENT,
        `${date} holds exactly the ${input.requirement.slots} slot(s) required (${input.requirement.label}) and not one more`,
        base
      )
    );
  }

  if (meetsRequirement && !availableMeetsRequirement) {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVE_CAPACITY_CONDITIONAL_SHORTFALL,
        `${date} counts ${slots} slot(s), but only ${available} of them are actually free once the ${conditionalSlots} conditional slot(s) are checked against what already stands on the overlapping ground`,
        { ...base, conditionBlocked, conditionUndecidable }
      )
    );
  }

  let atCap = false;
  let overCap = false;
  if (input.cap) {
    atCap = reserved === input.cap.limit;
    overCap = reserved > input.cap.limit;
    if (overCap) {
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.RESERVE_CAP_EXCEEDED,
          `${date} reserves ${reserved} slot(s) against a cap of ${input.cap.limit} (${input.cap.label})`,
          { date, reserved, limit: input.cap.limit, source: input.cap.source }
        )
      );
    } else if (atCap) {
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.RESERVE_CAP_REACHED,
          `${date} reserves ${reserved} slot(s), exactly the cap of ${input.cap.limit} (${input.cap.label}); the ${slots - reserved} spare slot(s) are unreservable for that reason, not for a facility one`,
          {
            date,
            reserved,
            limit: input.cap.limit,
            spare: slots - reserved,
            source: input.cap.source,
          }
        )
      );
    }
  }

  return {
    date,
    slots,
    unconditionalSlots,
    conditionalSlots,
    conditionSatisfied,
    conditionBlocked,
    conditionUndecidable,
    available,
    reserved,
    assigned,
    unassigned: reserved - assigned,
    spare: slots - reserved,
    meetsRequirement,
    availableMeetsRequirement,
    bareMinimum,
    atCap,
    overCap,
    bySurface,
    cappedBy: [],
    findings,
  };
}

/**
 * The most slots each surface offered on any date in this report.
 *
 * This is the reference a date's shortfall is measured against, and it is
 * derived from the report's own dates rather than stated: a season whose ground
 * changes mid-way moves it, which is the correct behaviour.
 *
 * @param {ReadonlyArray<import('./types.js').DateCapacity>} dateRows
 * @returns {Record<string, number>}
 */
function bestPerSurface(dateRows) {
  /** @type {Record<string, number>} */
  const best = {};
  for (const dateRow of dateRows) {
    for (const row of dateRow.bySurface) {
      best[row.surfaceId] = Math.max(best[row.surfaceId] ?? 0, row.slots);
    }
  }
  return best;
}

/**
 * Attribute a date's shortfall to the constraints that caused it.
 *
 * A surface that offered fewer slots than its best day lost them to whatever
 * refused its next candidate kickoff — `availability/kickoff.js`'s binding
 * kinds, consumed rather than recomputed. Where two edges tie for tightest the
 * loss is attributed to both, because the tie is real: relaxing either alone
 * would not add the slot.
 *
 * @param {import('./types.js').DateCapacity} dateRow
 * @param {Record<string, number>} bestSlotsBySurface
 * @returns {void}
 */
function attributeCapping(dateRow, bestSlotsBySurface) {
  /** @type {Map<string, { kind: string, surfaceIds: string[], slotsLostVsBest: number }>} */
  const byKind = new Map();
  for (const row of dateRow.bySurface) {
    const lost = Math.max(0, (bestSlotsBySurface[row.surfaceId] ?? 0) - row.slots);
    for (const kind of row.cappedByKinds) {
      if (!byKind.has(kind)) byKind.set(kind, { kind, surfaceIds: [], slotsLostVsBest: 0 });
      const entry = /** @type {{ kind: string, surfaceIds: string[], slotsLostVsBest: number }} */ (
        byKind.get(kind)
      );
      entry.surfaceIds.push(row.surfaceId);
      entry.slotsLostVsBest += lost;
    }
  }

  dateRow.cappedBy = [...byKind.values()]
    .map((entry) => ({ ...entry, surfaceIds: [...entry.surfaceIds].sort() }))
    .sort((a, b) => b.slotsLostVsBest - a.slotsLostVsBest || a.kind.localeCompare(b.kind));

  if (dateRow.cappedBy.length > 0) {
    dateRow.findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVE_CAPACITY_BOUND,
        `${dateRow.date} holds ${dateRow.slots} slot(s), bounded by ${dateRow.cappedBy
          .map((entry) => `${entry.kind} on ${entry.surfaceIds.join(', ')}`)
          .join('; ')}`,
        {
          date: dateRow.date,
          slots: dateRow.slots,
          cappedBy: dateRow.cappedBy.map((entry) => entry.kind),
          slotsLostVsBest: dateRow.cappedBy.map((entry) => entry.slotsLostVsBest),
        }
      )
    );
  }
}
