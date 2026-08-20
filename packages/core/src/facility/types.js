/**
 * JSDoc typedefs for the facility graph.
 *
 * Type-only module: it has no runtime exports and ends with `export {};` so it
 * stays a module, exactly like `packages/core/src/types.js`.
 *
 * Vocabulary note: the graph node is a **`FacilitySurface`**, not a "field".
 * `fields` and `field_subunits` are the same kind of thing here (a bookable
 * patch of ground), and "field" is already overloaded repo-wide in the
 * form-field sense. `surface.id` is an **opaque** string — never parse it, and
 * in particular never assume a separator. `surface.name` is the display label.
 *
 * @module facility/types
 */

/**
 * A site that owns surfaces. Conflicts never cross a venue.
 *
 * @typedef {Object} FacilityVenue
 * @property {string} id - opaque
 * @property {string} name - display label
 * @property {boolean} lit
 * @property {string|null} notes
 * @property {string|null} overlapNote
 */

/**
 * Two or more separately-named venues that are one site to walk between.
 *
 * Declared, never inferred: see `venueComplex.js` for why no rule turns
 * `"Maplewood Back"` into `"Maplewood"`. `id` is opaque; `name` is the display
 * label; `source` records who stated the complex, in the style of
 * `ConstraintRecord.source`.
 *
 * @typedef {Object} VenueComplex
 * @property {string} id - opaque
 * @property {string} name - display label
 * @property {string[]} venueIds - at least two, sorted
 * @property {string|null} note
 * @property {string|null} source
 */

/**
 * Which venues form which complex. Deep-frozen, and holds no schedule state.
 *
 * Kept separate from {@link FacilityGraph} on purpose: containment and overlap
 * are intra-venue statements about bookable ground, while a complex is a
 * statement about travel time between sites. See `venueComplex.js`.
 *
 * @typedef {Object} VenueComplexMap
 * @property {Record<string, VenueComplex>} complexes
 * @property {string[]} complexIds
 * @property {Record<string, string>} complexIdByVenueId - venue id -> complex id
 * @property {string[]} venueIds - every venue that belongs to some complex, sorted
 * @property {VenueComplexStats} stats
 */

/**
 * Structural counts, so a test can meta-assert the map before asserting any
 * behaviour on it. A map with zero complexes makes every "these two sites are
 * one" test pass trivially — which is precisely the state that made the
 * 15-minute walking rule unreachable in the first place.
 *
 * @typedef {Object} VenueComplexStats
 * @property {number} complexCount
 * @property {number} venueCount
 */

/**
 * One node of the facility graph: a patch of ground that can hold a game.
 *
 * Containment (`parentId` / `childIds`) is a **forest**: every surface has at
 * most one parent, and a parent is mutually exclusive in time with all of its
 * descendants. Overlap is a *separate*, undirected relation and lives on the
 * graph, not on the surface.
 *
 * @typedef {Object} FacilitySurface
 * @property {string} id - opaque
 * @property {string} venueId
 * @property {string} name - display label, unique within the venue
 * @property {string[]} sizes - formats the ground is big enough for
 * @property {string[]} lined - formats actually lined this season
 * @property {string|null} parentId
 * @property {string[]} childIds
 * @property {boolean} bookable
 * @property {string|null} note
 * @property {string[]} cells - atomic leaf ids under this surface (self when a leaf)
 * @property {string[]} lineage - self plus every ancestor, nearest first
 * @property {number} depth - 0 for a root surface
 */

/**
 * Where an equipment record applies.
 *
 * A `surface`-scoped window applies to that surface **and its descendants**:
 * goals stood on Pitch 1 are equally present on halves 1A and 1B.
 *
 * @typedef {Object} EquipmentScope
 * @property {'venue'|'surface'} kind
 * @property {string} id - a venue id or a surface id, per `kind`
 */

/**
 * A date-scoped statement about a piece of equipment.
 *
 * `status` is deliberately **tri-state**. The season-2026 corpus's single
 * record reads "was in doubt; confirmed available" — a boolean would erase the
 * fact that it was ever in doubt, which is the provenance an operator needs.
 *
 * `fromDate`/`toDate` are inclusive ISO `YYYY-MM-DD`; a single-date exception
 * sets them equal.
 *
 * @typedef {Object} EquipmentWindow
 * @property {string} id
 * @property {string} equipment - e.g. `9v9 goals`
 * @property {'available'|'unavailable'|'unknown'} status
 * @property {EquipmentScope} scope
 * @property {string} fromDate
 * @property {string} toDate
 * @property {string|null} note
 * @property {string|null} source - where the record came from, for audit
 */

/**
 * Plain input accepted by `buildFacilityGraph()`. Validated by
 * `FacilityGraphInputSchema`, which is `.strict()` — an unexpected key is an
 * error, not a passenger.
 *
 * @typedef {Object} FacilityGraphInput
 * @property {Array<Object>} venues
 * @property {Array<Object>} surfaces
 * @property {Array<[string, string]>} [overlapPairs]
 * @property {EquipmentWindow[]} [equipmentWindows]
 * @property {Record<string, string[]>} [formatEquipment]
 * @property {Record<string, number>} [sizeRank]
 * @property {'downward-closed'|'declared'} [sizePolicy]
 */

/**
 * Counters proving a check actually looked at something.
 *
 * Incident 4 in `fixtures/season-2026/README.md` is a validator that matched
 * zero records and reported a perfect score. Every result in this module
 * carries these so a test can assert the check was not vacuous.
 *
 * @typedef {Object} FacilityMeta
 * @property {number} surfacesConsidered
 * @property {number} cellPairsCompared
 * @property {number} overlapPairsConsulted
 * @property {number} equipmentWindowsConsulted
 * @property {number} bookingPairsCompared
 */

/**
 * One machine-readable reason. `code` is the contract; `message` is for humans.
 * `details` is a flat bag of primitives and ids — never a live graph node.
 *
 * @typedef {Object} FacilityFinding
 * @property {string} code - a `FACILITY_REASON` value
 * @property {string} severity - a `FACILITY_SEVERITY` value
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

/**
 * The result shape shared by every check in this module.
 *
 * `findings` is a **list**, never a first hit: a booking can be lining
 * compromised *and* overlap blocked, and an operator needs both.
 *
 * @typedef {Object} FacilityCheckResult
 * @property {string} status - a `FACILITY_STATUS` value
 * @property {FacilityFinding[]} findings
 * @property {FacilityMeta} meta
 */

/**
 * A time-boxed claim on a surface.
 *
 * `endMinutes` is nullable on purpose (GAP-14): the corpus's four `Scrimmage`
 * rows have no timing row, so their footprint is genuinely unknown. Callers get
 * `OCCUPANCY_FOOTPRINT_UNKNOWN`, never a fabricated "no conflict".
 *
 * @typedef {Object} FacilityBooking
 * @property {string} id
 * @property {string} surfaceId
 * @property {string} date - ISO `YYYY-MM-DD`
 * @property {number} startMinutes - minutes past local midnight
 * @property {number|null} endMinutes
 * @property {string|null} [format]
 * @property {string|null} [label]
 */

/**
 * The built graph. Deep-frozen: it holds no booking state, and every check
 * takes the caller's own bookings as an argument.
 *
 * @typedef {Object} FacilityGraph
 * @property {Record<string, FacilityVenue>} venues
 * @property {string[]} venueIds
 * @property {Record<string, FacilitySurface>} surfaces
 * @property {string[]} surfaceIds
 * @property {Array<[string, string]>} overlapPairs
 * @property {Record<string, string[]>} overlapBySurface
 * @property {EquipmentWindow[]} equipmentWindows
 * @property {Record<string, string[]>} formatEquipment
 * @property {Record<string, number>} sizeRank
 * @property {string} sizePolicy
 * @property {FacilityGraphStats} stats
 */

/**
 * Structural counts, so a test can meta-assert the *graph* before asserting any
 * behaviour on it. A graph with zero overlap pairs would make every "these two
 * may run concurrently" test pass trivially.
 *
 * @typedef {Object} FacilityGraphStats
 * @property {number} venueCount
 * @property {number} surfaceCount
 * @property {number} bookableSurfaceCount
 * @property {number} containmentEdgeCount
 * @property {number} overlapPairCount
 * @property {number} equipmentWindowCount
 * @property {number} formatEquipmentCount
 */

export {};
