/**
 * Reserved slots — the two kinds of committed-but-not-fully-known thing — and
 * the one guarantee they exist to provide.
 *
 * > *"An external league caps the club at 10 games per Saturday and picks which
 * > teams play, publishing late. The club chooses field and time. So 10 slots
 * > per Saturday are real, committed, and team-less. They must occupy fields,
 * > appear in exports, and accept team assignment later **without moving**."*
 *
 * The last three words are the whole design. The club published a field and a
 * kickoff to families weeks before the league said who would play; if naming the
 * teams can move either, the commitment was fiction. So:
 *
 * - a slot's **footprint** — date, surface, kickoff, end, format — and its
 *   **occupants** are separate halves of the record;
 * - {@link applySlotBindings} builds each result by spreading the original and
 *   overriding the occupant fields only, and then **proves** it did by running
 *   {@link checkSlotsUnmoved} over its own before-and-after and folding those
 *   findings into the result. The guarantee is enforced on the production path,
 *   not only in a test;
 * - {@link checkSlotsUnmoved} refuses to certify a comparison that examined zero
 *   pairs. "No slot moved" over an empty comparison is incident 4 on the one
 *   assertion this module exists to make.
 *
 * A reservation (`Scrimmage - teams TBD`, exactly one row in the corpus) is the
 * same record with `kind: 'reservation'` and a `purpose`. It occupies ground and
 * therefore constrains, but it is not a game and never counts as one.
 *
 * @module reserve/slots
 */

import { bookingsOverlapInTime } from '../facility/occupancy.js';

import {
  BINDABLE_SIDES,
  FIXTURE_SIDE,
  RESERVE_KIND,
  RESERVE_REASON,
  createReserveMeta,
  deriveReserveStatus,
  makeReserveFinding,
  mergeReserveMeta,
} from './reasonCodes.js';
import { ReservedSlotSchema, SlotBindingSchema } from './schemas.js';

/**
 * The separator used inside composite keys.
 *
 * Written as the `\u0000` escape and never as the raw byte: a raw NUL makes the
 * whole file binary to git, ripgrep and every diff review, which is how a 57 KB
 * rule file once merged as an opaque blob. `tests/sourceHygiene.test.js` stands
 * guard over this.
 */
const KEY_SEPARATOR = '\u0000';

/**
 * The fields that make up a slot's **footprint** — the part families already
 * have, and the part naming the teams may never touch.
 *
 * Exported because it is a contract rather than an implementation detail: a
 * field added to `ReservedSlot` is either part of the commitment or part of what
 * can still change, and this list is where that decision is recorded.
 *
 * @type {ReadonlyArray<string>}
 */
export const SLOT_FOOTPRINT_FIELDS = Object.freeze([
  'id',
  'kind',
  'date',
  'venueId',
  'surfaceId',
  'startMinutes',
  'endMinutes',
  'format',
]);

/**
 * The canonical rendering of a slot's footprint.
 *
 * Two slots with the same footprint string stand on the same ground at the same
 * time; two with different ones do not, whatever else they agree about.
 *
 * @param {import('./types.js').ReservedSlot} slot
 * @returns {string}
 */
export function reservedSlotFootprint(slot) {
  return SLOT_FOOTPRINT_FIELDS.map((field) => String(slot[field] ?? '')).join(KEY_SEPARATOR);
}

/**
 * Parse and freeze one reserved slot.
 *
 * @param {Object} input - see `ReservedSlotSchema`
 * @returns {import('./types.js').ReservedSlot}
 */
export function makeReservedSlot(input) {
  return Object.freeze(
    /** @type {import('./types.js').ReservedSlot} */ (ReservedSlotSchema.parse(input))
  );
}

/**
 * Is this slot's roster of occupants complete — both sides settled, whether by
 * naming a team, a visiting club, or nobody at all?
 *
 * A Minis session with no opponent is **settled**; a `Select Game 7` awaiting
 * the league is not. Collapsing the two is GAP-15.
 *
 * @param {import('./types.js').ReservedSlot} slot
 * @returns {boolean}
 */
export function slotIsSettled(slot) {
  return slot.homeSide !== FIXTURE_SIDE.TBD && slot.awaySide !== FIXTURE_SIDE.TBD;
}

/**
 * Does this slot name at least one member team?
 *
 * @param {import('./types.js').ReservedSlot} slot
 * @returns {boolean}
 */
export function slotNamesATeam(slot) {
  return slot.homeSide === FIXTURE_SIDE.TEAM || slot.awaySide === FIXTURE_SIDE.TEAM;
}

/**
 * The slots as facility bookings, so the rest of the system sees the ground they
 * occupy.
 *
 * GAP-17's point in one function: a reservation is not a game, and it still
 * blocks a field.
 *
 * @param {ReadonlyArray<import('./types.js').ReservedSlot>} slots
 * @returns {import('../facility/types.js').FacilityBooking[]}
 */
export function slotsToBookings(slots) {
  return slots.map(
    (slot) =>
      /** @type {import('../facility/types.js').FacilityBooking} */ ({
        id: slot.id,
        surfaceId: slot.surfaceId,
        date: slot.date,
        startMinutes: slot.startMinutes,
        endMinutes: slot.endMinutes,
        format: slot.format,
        label: slot.label,
      })
  );
}

/**
 * Structural counts over a set of slots, so a test can meta-assert the input
 * before asserting any behaviour on it.
 *
 * @param {ReadonlyArray<import('./types.js').ReservedSlot>} slots
 * @returns {{ total: number, byKind: Record<string, number>, byHomeSide: Record<string, number>, byAwaySide: Record<string, number>, settled: number, awaitingTeams: number, conditional: number, namingATeam: number, byDate: Record<string, number>, sources: string[] }}
 */
export function summariseSlots(slots) {
  /** @type {Record<string, number>} */
  const byKind = {};
  /** @type {Record<string, number>} */
  const byHomeSide = {};
  /** @type {Record<string, number>} */
  const byAwaySide = {};
  /** @type {Record<string, number>} */
  const byDate = {};
  for (const kind of Object.values(RESERVE_KIND)) byKind[kind] = 0;
  for (const side of Object.values(FIXTURE_SIDE)) {
    byHomeSide[side] = 0;
    byAwaySide[side] = 0;
  }

  let settled = 0;
  let conditional = 0;
  let namingATeam = 0;
  /** @type {Set<string>} */
  const sources = new Set();
  for (const slot of slots) {
    byKind[slot.kind] = (byKind[slot.kind] ?? 0) + 1;
    byHomeSide[slot.homeSide] = (byHomeSide[slot.homeSide] ?? 0) + 1;
    byAwaySide[slot.awaySide] = (byAwaySide[slot.awaySide] ?? 0) + 1;
    byDate[slot.date] = (byDate[slot.date] ?? 0) + 1;
    if (slotIsSettled(slot)) settled += 1;
    if (slotNamesATeam(slot)) namingATeam += 1;
    if (slot.condition) conditional += 1;
    if (slot.source) sources.add(slot.source);
  }

  return {
    total: slots.length,
    byKind,
    byHomeSide,
    byAwaySide,
    settled,
    awaitingTeams: slots.length - settled,
    conditional,
    namingATeam,
    byDate,
    sources: [...sources].sort(),
  };
}

/**
 * Did anything move?
 *
 * Compares two sets of slots by id and reports, per slot, whether its footprint
 * changed. A slot present in `before` and absent from `after` is
 * `RESERVED_SLOT_DROPPED`: vanishing is a stronger form of moving, and a
 * comparison that only looked at survivors would miss it — the same shape as
 * enumerating a check's subject set from the data a break would corrupt.
 *
 * @param {ReadonlyArray<import('./types.js').ReservedSlot>} before
 * @param {ReadonlyArray<import('./types.js').ReservedSlot>} after
 * @returns {{ moved: Array<{ slotId: string, before: string, after: string }>, dropped: string[], findings: import('./types.js').ReserveFinding[], status: string, meta: import('./types.js').ReserveMeta }}
 */
export function checkSlotsUnmoved(before, after) {
  const meta = createReserveMeta();
  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];
  /** @type {Array<{ slotId: string, before: string, after: string }>} */
  const moved = [];
  /** @type {string[]} */
  const dropped = [];

  const afterById = new Map(after.map((slot) => [slot.id, slot]));

  for (const slot of before) {
    const next = afterById.get(slot.id);
    if (!next) {
      dropped.push(slot.id);
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.RESERVED_SLOT_DROPPED,
          `reserved slot "${slot.id}" (${slot.label}) was present before this operation and is absent after it`,
          { slotId: slot.id, label: slot.label, date: slot.date, surfaceId: slot.surfaceId }
        )
      );
      continue;
    }
    meta.slotPairsCompared += 1;
    const from = reservedSlotFootprint(slot);
    const to = reservedSlotFootprint(next);
    if (from === to) continue;
    meta.slotsMoved += 1;
    moved.push({ slotId: slot.id, before: from, after: to });
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVED_SLOT_MOVED,
        `reserved slot "${slot.id}" (${slot.label}) changed position: the club committed this field and time before knowing who would play in it`,
        {
          slotId: slot.id,
          label: slot.label,
          beforeDate: slot.date,
          afterDate: next.date,
          beforeSurfaceId: slot.surfaceId,
          afterSurfaceId: next.surfaceId,
          beforeStartMinutes: slot.startMinutes,
          afterStartMinutes: next.startMinutes,
          beforeEndMinutes: slot.endMinutes,
          afterEndMinutes: next.endMinutes,
          changedFields: SLOT_FOOTPRINT_FIELDS.filter((field) => slot[field] !== next[field]),
        }
      )
    );
  }

  if (meta.slotPairsCompared === 0) {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVED_SLOT_COMPARISON_VACUOUS,
        'the unmoved comparison examined zero slot pairs, so "nothing moved" is a statement about an empty set',
        { beforeCount: before.length, afterCount: after.length }
      )
    );
  } else {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVED_SLOT_UNMOVED,
        `${meta.slotPairsCompared - meta.slotsMoved} of ${meta.slotPairsCompared} compared slots held their date, surface, kickoff, end and format exactly`,
        {
          pairsCompared: meta.slotPairsCompared,
          moved: meta.slotsMoved,
          dropped: dropped.length,
          footprintFields: [...SLOT_FOOTPRINT_FIELDS],
        }
      )
    );
  }

  return { moved, dropped, findings, status: deriveReserveStatus(findings), meta };
}

/**
 * Name the teams in reserved slots, and prove nothing moved doing it.
 *
 * Every refusal is a finding rather than an exception, because a batch of
 * bindings from an external league is exactly the input where one bad row must
 * not discard the other ninety-nine.
 *
 * @param {ReadonlyArray<import('./types.js').ReservedSlot>} slots
 * @param {ReadonlyArray<Object>} rawBindings - see `SlotBindingSchema`
 * @param {{ teamUniverse: ReadonlyArray<string> }} options - the roster's team
 *   universe. Required: a team identifier is a member of the roster or it is not
 *   a team identifier, which is the discipline
 *   `ruleEngine/adapters/season2026Schedule.js` applies for the same reason.
 * @returns {import('./types.js').SlotBindingResult}
 */
export function applySlotBindings(slots, rawBindings, options) {
  if (!options || !Array.isArray(options.teamUniverse)) {
    throw new Error(
      'reserve: applySlotBindings needs { teamUniverse } — without it every label would be accepted as a team id, which is incident 4'
    );
  }
  const known = new Set(options.teamUniverse.map(String));
  const meta = createReserveMeta();
  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];

  const before = [...slots];
  meta.slotsExamined = before.length;

  /** @type {Map<string, import('./types.js').ReservedSlot>} */
  const working = new Map(before.map((slot) => [slot.id, slot]));
  /** @type {string[]} */
  const boundSlotIds = [];

  for (const raw of rawBindings) {
    const binding = /** @type {import('./types.js').SlotBinding} */ (SlotBindingSchema.parse(raw));
    const slot = working.get(binding.slotId);
    if (!slot) {
      meta.bindingsRefused += 1;
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.RESERVED_SLOT_UNKNOWN,
          `a binding names slot "${binding.slotId}", which this run does not hold`,
          { slotId: binding.slotId }
        )
      );
      continue;
    }

    /** @type {Record<string, string|null>} */
    const patch = {};
    let refused = false;

    for (const side of /** @type {const} */ (['home', 'away'])) {
      const teamId = binding[`${side}TeamId`];
      if (teamId === null) continue;
      const sideKind = slot[`${side}Side`];
      if (!BINDABLE_SIDES.has(sideKind)) {
        refused = true;
        findings.push(
          makeReserveFinding(
            sideKind === FIXTURE_SIDE.TEAM
              ? RESERVE_REASON.RESERVED_SLOT_SIDE_ALREADY_NAMED
              : RESERVE_REASON.RESERVED_SLOT_SIDE_NOT_BINDABLE,
            `slot "${slot.id}" has a ${side} side of kind "${sideKind}", which is not waiting to be filled in`,
            { slotId: slot.id, side, sideKind, teamId }
          )
        );
        continue;
      }
      if (!known.has(teamId)) {
        refused = true;
        findings.push(
          makeReserveFinding(
            RESERVE_REASON.RESERVED_SLOT_TEAM_UNKNOWN,
            `a binding puts "${teamId}" in slot "${slot.id}", and no such team is in the roster's team universe`,
            { slotId: slot.id, side, teamId, teamUniverseSize: known.size }
          )
        );
        continue;
      }
      patch[`${side}TeamId`] = teamId;
    }

    const nextHome = patch.homeTeamId ?? slot.homeTeamId;
    const nextAway = patch.awayTeamId ?? slot.awayTeamId;
    if (nextHome !== null && nextHome === nextAway) {
      refused = true;
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.RESERVED_SLOT_SIDES_IDENTICAL,
          `a binding puts "${nextHome}" on both sides of slot "${slot.id}"`,
          { slotId: slot.id, teamId: nextHome }
        )
      );
    }

    if (refused || Object.keys(patch).length === 0) {
      meta.bindingsRefused += 1;
      continue;
    }

    // Built by spreading the original: every footprint field is carried over
    // rather than recomputed, and `checkSlotsUnmoved()` below proves it.
    const bound = makeReservedSlot({
      ...slot,
      ...patch,
      homeSide: patch.homeTeamId ? FIXTURE_SIDE.TEAM : slot.homeSide,
      awaySide: patch.awayTeamId ? FIXTURE_SIDE.TEAM : slot.awaySide,
      // A named side carries an identity, not display text. The placeholder
      // label it used to wear (`Select Game 7`) stays on `slot.label`, which is
      // what the published schedule called this slot and does not change.
      homeLabel: patch.homeTeamId ? null : slot.homeLabel,
      awayLabel: patch.awayTeamId ? null : slot.awayLabel,
    });
    working.set(slot.id, bound);
    boundSlotIds.push(slot.id);
    meta.bindingsApplied += 1;

    findings.push(
      makeReserveFinding(
        RESERVE_REASON.RESERVED_SLOT_BOUND,
        `slot "${slot.id}" (${slot.label}) now names ${bound.homeTeamId ?? bound.homeLabel ?? '(tbd)'} v ${bound.awayTeamId ?? bound.awayLabel ?? '(tbd)'}`,
        {
          slotId: slot.id,
          date: slot.date,
          surfaceId: slot.surfaceId,
          startMinutes: slot.startMinutes,
          homeTeamId: bound.homeTeamId,
          awayTeamId: bound.awayTeamId,
        }
      )
    );

    if (!slotIsSettled(bound)) {
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.RESERVED_SLOT_PARTIALLY_BOUND,
          `slot "${slot.id}" names one side and the other is still to be decided`,
          {
            slotId: slot.id,
            homeSide: bound.homeSide,
            awaySide: bound.awaySide,
          }
        )
      );
    }
  }

  const after = before.map(
    (slot) => /** @type {import('./types.js').ReservedSlot} */ (working.get(slot.id))
  );

  findings.push(...doubleBookingFindings(after, boundSlotIds));

  // The guarantee, checked on the production path rather than only in a test.
  const unmoved = checkSlotsUnmoved(before, after);
  findings.push(...unmoved.findings);
  mergeReserveMeta(meta, unmoved.meta);

  return {
    slots: after,
    boundSlotIds: [...boundSlotIds].sort(),
    findings,
    status: deriveReserveStatus(findings),
    meta,
  };
}

/**
 * One team in two slots at once.
 *
 * The league picks the teams; nothing stops it picking one twice, and a schedule
 * that accepted that would publish a team in two places on the same afternoon.
 * Only slots this call bound are judged — a clash that was already in the
 * published schedule is not something a binding introduced, and reporting it
 * here would blame the wrong operation.
 *
 * @param {ReadonlyArray<import('./types.js').ReservedSlot>} slots
 * @param {ReadonlyArray<string>} boundSlotIds
 * @returns {import('./types.js').ReserveFinding[]}
 */
function doubleBookingFindings(slots, boundSlotIds) {
  const bound = new Set(boundSlotIds);
  if (bound.size === 0) return [];

  /** @type {Map<string, Array<import('./types.js').ReservedSlot>>} */
  const byTeam = new Map();
  for (const slot of slots) {
    for (const teamId of [slot.homeTeamId, slot.awayTeamId]) {
      if (!teamId) continue;
      if (!byTeam.has(teamId)) byTeam.set(teamId, []);
      /** @type {Array<import('./types.js').ReservedSlot>} */ (byTeam.get(teamId)).push(slot);
    }
  }

  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];
  for (const [teamId, entries] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i];
        const b = entries[j];
        if (!bound.has(a.id) && !bound.has(b.id)) continue;
        const overlap = bookingsOverlapInTime(
          /** @type {import('../facility/types.js').FacilityBooking} */ ({ ...a }),
          /** @type {import('../facility/types.js').FacilityBooking} */ ({ ...b })
        );
        if (overlap !== true) continue;
        findings.push(
          makeReserveFinding(
            RESERVE_REASON.RESERVED_SLOT_TEAM_DOUBLE_BOOKED,
            `team "${teamId}" is named in "${a.id}" and "${b.id}", which overlap on ${a.date}`,
            { teamId, slotIds: [a.id, b.id].sort(), date: a.date }
          )
        );
      }
    }
  }
  return findings;
}
