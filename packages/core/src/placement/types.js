/**
 * JSDoc typedefs for the placement demonstration harness.
 *
 * Type-only module: it has no runtime exports and ends with `export {};` so it
 * stays a module, exactly like `packages/core/src/facility/types.js`.
 *
 * @module placement/types
 */

/**
 * One game the harness may move.
 *
 * `publishedSurfaceId` / `publishedKickoffMinutes` are where the game actually
 * ran, carried so a run can be diffed against the schedule families already
 * have. They are nullable because a game with no published position is a
 * perfectly good thing to place — it just has nothing to be compared against.
 *
 * @typedef {Object} PlacementGame
 * @property {string} id
 * @property {string|null} format
 * @property {string|null} label
 * @property {string|null} divisionLabel - a label, not a key (GAP-24)
 * @property {string|null} publishedSurfaceId
 * @property {number|null} publishedKickoffMinutes
 */

/**
 * Where the harness put a game, and what the registry said about it.
 *
 * `findings` are kept after re-severity, which means an `allowed` placement can
 * still carry an overlap finding at `info`. That is the honest shape of "this is
 * legal only because adjacency is currently a preference".
 *
 * @typedef {Object} Placement
 * @property {string} gameId
 * @property {string|null} label
 * @property {string|null} format
 * @property {string|null} divisionLabel
 * @property {string} surfaceId
 * @property {string} surfaceName
 * @property {string} venueId
 * @property {string} date
 * @property {number} kickoffMinutes
 * @property {number|null} occupancyMinutes
 * @property {number|null} endMinutes
 * @property {string} status - a `CONSTRAINT_STATUS` value
 * @property {Array<Object>} findings
 * @property {string|null} publishedSurfaceId
 * @property {number|null} publishedKickoffMinutes
 * @property {number} attempts - candidates tried before this one landed
 */

/**
 * A game no candidate slot could hold.
 *
 * Incident 10: kept visible with a reason, never dropped.
 *
 * @typedef {Object} UnplacedGame
 * @property {string} gameId
 * @property {string|null} label
 * @property {number} attempts
 * @property {string|null} publishedSurfaceId
 * @property {number|null} publishedKickoffMinutes
 * @property {string} reason
 */

/**
 * A candidate the registry refused, with the findings that refused it.
 *
 * Kept because it is the input to the what-if query: "which of these refusals
 * would stop being refusals if adjacency were a preference?" is answerable from
 * this list without re-running anything.
 *
 * @typedef {Object} RejectedCandidate
 * @property {string} gameId
 * @property {string} surfaceId
 * @property {number} kickoffMinutes
 * @property {string} status
 * @property {Array<Object>} findings
 */

/**
 * How far a run drifted from the published schedule, by game.
 *
 * @typedef {Object} PlacementDiff
 * @property {PlacementChange[]} changed
 * @property {string[]} unchanged - game ids
 * @property {string[]} unplacedGameIds
 * @property {{ changed: number, unchanged: number, unplaced: number }} counts
 */

/**
 * @typedef {Object} PlacementChange
 * @property {string} gameId
 * @property {string|null} label
 * @property {string[]} changedFields
 * @property {{ surfaceId: string|null, kickoffMinutes: number|null }} before
 * @property {{ surfaceId: string, kickoffMinutes: number }} after
 */

/**
 * Counters proving the run actually tried something.
 *
 * @typedef {Object} PlacementMeta
 * @property {number} gamesConsidered
 * @property {number} candidatesEvaluated
 * @property {number} candidatesRejected
 * @property {number} placementsMade
 * @property {number} surfacesConsidered
 * @property {number} kickoffsConsidered
 * @property {number} fixedBookingsHeld
 * @property {number} findingsExamined
 * @property {number} findingsReseverified
 * @property {number} registryCodesGoverned
 * @property {number} registryOverridesApplied
 */

/**
 * The whole result of one run.
 *
 * @typedef {Object} PlacementRun
 * @property {string} date
 * @property {string|null} registryName
 * @property {Placement[]} placements
 * @property {UnplacedGame[]} unplaced
 * @property {RejectedCandidate[]} rejections
 * @property {PlacementDiff} diffVsPublished
 * @property {PlacementMeta} meta
 */

/**
 * @typedef {Object} RunChange
 * @property {string} gameId
 * @property {string|null} label
 * @property {string[]} changedFields
 * @property {{ surfaceId: string, kickoffMinutes: number, status: string }|null} before
 * @property {{ surfaceId: string, kickoffMinutes: number, status: string }|null} after
 */

/**
 * Which specific games differ between two runs — the literal wording of the
 * acceptance test.
 *
 * @typedef {Object} RunComparison
 * @property {RunChange[]} changed
 * @property {string[]} unchanged
 * @property {{ changed: number, unchanged: number, compared: number }} counts
 */

export {};
