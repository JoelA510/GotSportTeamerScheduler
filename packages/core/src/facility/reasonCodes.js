/**
 * Machine-readable reason codes for every facility decision, and the single
 * severity table that turns a list of findings into a status.
 *
 * Two rules govern this file:
 *
 * 1. **`code` is the contract, `message` is decoration.** Downstream consumers
 *    (renderers, the constraint registry, CSV exports) branch on `code` only.
 *    Never parse `message`.
 * 2. **Severity lives here and nowhere else.** No call site is allowed to
 *    decide "this one is blocking". Prompt 2.1 has to be able to demote field
 *    adjacency from a hard constraint to a preference and back again, so
 *    {@link FACILITY_REASON_SEVERITY} is the seam that override has to write
 *    through.
 *
 * @module facility/reasonCodes
 */

/**
 * How badly a finding counts against a booking.
 *
 * @readonly
 * @enum {string}
 */
export const FACILITY_SEVERITY = Object.freeze({
  /** The booking is illegal. Any one of these forces `rejected`. */
  BLOCKING: 'blocking',
  /** The booking is playable but worse than it looks. Forces `compromised`. */
  COMPROMISE: 'compromise',
  /** Provenance only. Never changes the status. */
  INFO: 'info',
});

/**
 * The three-state outcome of any facility check.
 *
 * `compromised` exists so that "7v7 played on a 9v9-lined pitch with portable
 * goals" is *visible* rather than either invisible (collapsed into `allowed`)
 * or fatal (collapsed into `rejected`).
 *
 * @readonly
 * @enum {string}
 */
export const FACILITY_STATUS = Object.freeze({
  ALLOWED: 'allowed',
  COMPROMISED: 'compromised',
  REJECTED: 'rejected',
});

/**
 * Every reason a facility check can give.
 *
 * @readonly
 * @enum {string}
 */
export const FACILITY_REASON = Object.freeze({
  /* -- structural ------------------------------------------------------- */
  /** The booking names a surface that is not in the graph. */
  SURFACE_UNKNOWN: 'SURFACE_UNKNOWN',
  /** The surface exists but is flagged as not directly bookable. */
  SURFACE_NOT_BOOKABLE: 'SURFACE_NOT_BOOKABLE',

  /* -- occupancy -------------------------------------------------------- */
  /** Both bookings want the identical surface. */
  OCCUPIED_SAME_SURFACE: 'OCCUPIED_SAME_SURFACE',
  /** One surface contains the other (a full pitch versus one of its halves). */
  OCCUPIED_PARENT_CHILD: 'OCCUPIED_PARENT_CHILD',
  /** Two distinct surfaces are declared to share ground. */
  OCCUPIED_SPATIAL_OVERLAP: 'OCCUPIED_SPATIAL_OVERLAP',
  /**
   * A booking has no known end, so concurrency cannot be decided.
   *
   * Deliberately not `info`: the corpus's four `Scrimmage` rows have no
   * `game_formats.csv` entry (GAP-14), and reporting "no conflict" for them
   * would be a lie dressed as a pass.
   */
  OCCUPANCY_FOOTPRINT_UNKNOWN: 'OCCUPANCY_FOOTPRINT_UNKNOWN',

  /* -- size ------------------------------------------------------------- */
  /** The format needs more ground than the surface has. */
  SIZE_TOO_SMALL: 'SIZE_TOO_SMALL',
  /** `sizePolicy: 'declared'` and the format is not on the surface's list. */
  SIZE_NOT_DECLARED: 'SIZE_NOT_DECLARED',
  /** The format has no entry in the size-rank table, so it cannot be ranked. */
  SIZE_UNKNOWN_FORMAT: 'SIZE_UNKNOWN_FORMAT',
  /** The surface declares no sizes at all. */
  SIZE_UNDECLARED: 'SIZE_UNDECLARED',

  /* -- line markings ---------------------------------------------------- */
  /**
   * The surface is big enough but is not lined for this format. This is the
   * canonical `compromise`: the game can be played with portable goals and
   * cones, and the schedule should say so out loud.
   */
  LINING_MISMATCH: 'LINING_MISMATCH',
  /** The surface records no line markings at all. */
  LINING_UNDECLARED: 'LINING_UNDECLARED',

  /* -- equipment -------------------------------------------------------- */
  /** A required piece of kit is recorded unavailable for this date/scope. */
  EQUIPMENT_UNAVAILABLE: 'EQUIPMENT_UNAVAILABLE',
  /** A required piece of kit is recorded *positively* available. */
  EQUIPMENT_AVAILABLE: 'EQUIPMENT_AVAILABLE',
  /** A required piece of kit is recorded, but its status is `unknown`. */
  EQUIPMENT_STATUS_UNKNOWN: 'EQUIPMENT_STATUS_UNKNOWN',
  /** A requirement exists and no window says anything, so it is presumed met. */
  EQUIPMENT_ASSUMED_AVAILABLE: 'EQUIPMENT_ASSUMED_AVAILABLE',
  /** The format has no entry in the `formatEquipment` map, so it needs nothing. */
  EQUIPMENT_UNDECLARED: 'EQUIPMENT_UNDECLARED',
  /**
   * Two windows survive at the same specificity and disagree. The more
   * restrictive one is applied *and* this is emitted; the resolver never picks
   * a winner silently.
   */
  EQUIPMENT_PRECEDENCE_AMBIGUOUS: 'EQUIPMENT_PRECEDENCE_AMBIGUOUS',

  /* -- the alias layer (Phase 8.3) -------------------------------------- */
  /** A published field name that no decoder ring carries. */
  ALIAS_UNKNOWN: 'ALIAS_UNKNOWN',
  /**
   * A ring lists the code with an empty cell where the resolver looks: no
   * label, no venue, or no field. The finding names which — `blankLabel`,
   * `blankVenue`, `blankField` — because only a missing *venue* makes the row
   * unplaceable; a row with no label but a real venue and field resolves from
   * the cells the resolver actually reads.
   */
  ALIAS_BLANK: 'ALIAS_BLANK',
  /**
   * Two rings carry the code and give it different labels. Both candidates
   * are carried and every check runs over each; nothing here picks a ring.
   */
  ALIAS_RINGS_DISAGREE: 'ALIAS_RINGS_DISAGREE',
  /** A ring names a venue the graph (and the complex map) does not hold. */
  ALIAS_VENUE_UNKNOWN: 'ALIAS_VENUE_UNKNOWN',
  /** A ring names a venue the graph holds and a field it does not. */
  ALIAS_SURFACE_UNKNOWN: 'ALIAS_SURFACE_UNKNOWN',
  /** The label fits more than one surface; every one is carried. */
  ALIAS_SURFACE_AMBIGUOUS: 'ALIAS_SURFACE_AMBIGUOUS',
  /** A ring names a venue and no field, so the code is not ground. */
  ALIAS_VENUE_ONLY: 'ALIAS_VENUE_ONLY',
  /** The source itself marked the row uncertain (`?`). */
  ALIAS_SOURCE_UNCERTAIN: 'ALIAS_SOURCE_UNCERTAIN',
  /** One ring lists the same code twice; the first occurrence is read. */
  ALIAS_CODE_DUPLICATED: 'ALIAS_CODE_DUPLICATED',
  /**
   * **Nothing enforces this alias map.** Nothing outside `facility/aliases.js`
   * and its tests calls `buildFieldAliasMap()`, `lookupFieldAlias()` or
   * `surfacesOfAlias()`, and no rule and no registry constraint claims an
   * `ALIAS_*` code -- `ALIAS_UNKNOWN` at blocking included. Every map says so
   * on itself, the same way a closure set carries `CLOSURE_SET_UNWIRED` and
   * an unwired fairness objective carries `FAIRNESS_OBJECTIVE_UNWIRED`, and
   * `tests/helpers/unwiredLayer.js` checks the claim against the enforcement
   * paths for both layers with one assertion: the day something claims one of
   * these codes, the declaration has to go with it.
   */
  ALIAS_LAYER_UNWIRED: 'ALIAS_LAYER_UNWIRED',
});

/**
 * Severity of every reason code.
 *
 * Overlap is `blocking` in Phase 1. That is a *policy* recorded in a table, not
 * a fact baked into the conflict test — Prompt 2.1's constraint registry
 * overrides this map rather than editing `occupancy.js`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FACILITY_REASON_SEVERITY = Object.freeze({
  [FACILITY_REASON.SURFACE_UNKNOWN]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.SURFACE_NOT_BOOKABLE]: FACILITY_SEVERITY.BLOCKING,

  [FACILITY_REASON.OCCUPIED_SAME_SURFACE]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.OCCUPIED_PARENT_CHILD]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.OCCUPIED_SPATIAL_OVERLAP]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.OCCUPANCY_FOOTPRINT_UNKNOWN]: FACILITY_SEVERITY.COMPROMISE,

  [FACILITY_REASON.SIZE_TOO_SMALL]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.SIZE_NOT_DECLARED]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.SIZE_UNKNOWN_FORMAT]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.SIZE_UNDECLARED]: FACILITY_SEVERITY.BLOCKING,

  [FACILITY_REASON.LINING_MISMATCH]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.LINING_UNDECLARED]: FACILITY_SEVERITY.INFO,

  [FACILITY_REASON.EQUIPMENT_UNAVAILABLE]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.EQUIPMENT_AVAILABLE]: FACILITY_SEVERITY.INFO,
  [FACILITY_REASON.EQUIPMENT_STATUS_UNKNOWN]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.EQUIPMENT_ASSUMED_AVAILABLE]: FACILITY_SEVERITY.INFO,
  [FACILITY_REASON.EQUIPMENT_UNDECLARED]: FACILITY_SEVERITY.INFO,
  [FACILITY_REASON.EQUIPMENT_PRECEDENCE_AMBIGUOUS]: FACILITY_SEVERITY.INFO,

  [FACILITY_REASON.ALIAS_UNKNOWN]: FACILITY_SEVERITY.BLOCKING,
  [FACILITY_REASON.ALIAS_BLANK]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.ALIAS_RINGS_DISAGREE]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.ALIAS_VENUE_UNKNOWN]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.ALIAS_SURFACE_UNKNOWN]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.ALIAS_SURFACE_AMBIGUOUS]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.ALIAS_VENUE_ONLY]: FACILITY_SEVERITY.INFO,
  [FACILITY_REASON.ALIAS_SOURCE_UNCERTAIN]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.ALIAS_CODE_DUPLICATED]: FACILITY_SEVERITY.COMPROMISE,
  [FACILITY_REASON.ALIAS_LAYER_UNWIRED]: FACILITY_SEVERITY.INFO,
});

/**
 * Severity of a reason code.
 *
 * Throws on an unknown code rather than defaulting to `info`: a code with no
 * severity is a code somebody forgot to register, and defaulting would make it
 * silently non-blocking.
 *
 * @param {string} code
 * @returns {string} a {@link FACILITY_SEVERITY} value
 */
export function severityOf(code) {
  const severity = FACILITY_REASON_SEVERITY[code];
  if (!severity) {
    throw new Error(`facility: reason code "${code}" has no registered severity`);
  }
  return severity;
}

/**
 * Build a finding. `severity` is looked up, never passed in.
 *
 * @param {string} code - a {@link FACILITY_REASON} value
 * @param {string} message - for humans only
 * @param {Record<string, unknown>} [details] - flat primitives and ids only
 * @returns {import('./types.js').FacilityFinding}
 */
export function makeFinding(code, message, details = {}) {
  return { code, severity: severityOf(code), message, details };
}

/**
 * Derive the status of a check mechanically from its findings.
 *
 * Never write a status by hand at a call site; a hand-written status is how a
 * `compromised` result quietly becomes `allowed`.
 *
 * @param {ReadonlyArray<import('./types.js').FacilityFinding>} findings
 * @returns {string} a {@link FACILITY_STATUS} value
 */
export function deriveFacilityStatus(findings) {
  let compromised = false;
  for (const finding of findings) {
    if (finding.severity === FACILITY_SEVERITY.BLOCKING) return FACILITY_STATUS.REJECTED;
    if (finding.severity === FACILITY_SEVERITY.COMPROMISE) compromised = true;
  }
  return compromised ? FACILITY_STATUS.COMPROMISED : FACILITY_STATUS.ALLOWED;
}
