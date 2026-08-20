/**
 * Types for the change-request re-solver.
 *
 * JSDoc typedefs only — this file emits no runtime code.
 *
 * @module resolve/types
 */

/**
 * One game as the re-solver holds it: exactly the rule engine's
 * {@link import('../ruleEngine/types.js').ScheduledGame}, so a resolved state
 * converts back into a `Schedule` without a translation layer that could drift.
 *
 * @typedef {Object} PlacedGame
 * @property {string} id
 * @property {string} date
 * @property {number} startMinutes
 * @property {number|null} endMinutes
 * @property {string} venueId
 * @property {string} surfaceId
 * @property {string|null} format
 * @property {string|null} divisionLabel
 * @property {string|null} homeTeamId
 * @property {string|null} awayTeamId
 * @property {string} homeLabel
 * @property {string} awayLabel
 * @property {boolean} counted
 */

/**
 * Where a game may stand. Never invented: every slot comes from the baseline's
 * own inventory or from a change request that named it.
 *
 * @typedef {Object} Slot
 * @property {string} date
 * @property {string} surfaceId
 * @property {number} startMinutes
 */

/**
 * The one thing a stage may ask the writer to do.
 *
 * @typedef {Object} Move
 * @property {string} gameId
 * @property {'relocate'|'dislodge'|'time-tbd'} kind
 * @property {Slot|null} to - null for `dislodge` and `time-tbd`
 * @property {string} reason
 */

/**
 * One entry of the move ledger: what actually happened, in order.
 *
 * @typedef {Object} MoveRecord
 * @property {number} seq
 * @property {string} stageId
 * @property {string} gameId
 * @property {string} kind
 * @property {Slot|null} from
 * @property {Slot|null} to
 * @property {string} reason
 */

/**
 * The run-scoped recorder. **Deliberately mutable, and deliberately the only
 * mutable thing a stage can reach**: the placement state is deep-frozen and
 * replaced wholesale on every write, while counters, findings and the move log
 * accumulate here.
 *
 * @typedef {Object} ResolveLedger
 * @property {ResolveMeta} meta
 * @property {MoveRecord[]} moves
 * @property {import('../freeze/types.js').FreezeFinding[]} findings
 * @property {Record<string, { considered: number, rejected: number, applied: number }>} byStage
 */

/**
 * Which slots the baseline schedule actually used. The anti-slot-inventor
 * guarantee lives here: nothing in this package can offer a game a date, a
 * surface or a kickoff that is not in this object.
 *
 * Frozen all the way down, and typed that way: the immutability is the
 * guarantee, not an implementation detail of how it happens to be built.
 *
 * @typedef {Object} SlotInventory
 * @property {ReadonlyArray<string>} dates
 * @property {Readonly<Record<string, string>>} venueBySurfaceId
 * @property {Readonly<Record<string, ReadonlyArray<number>>>} kickoffsByDateVenue - key `date|venueId`
 * @property {Readonly<Record<string, ReadonlyArray<string>>>} surfacesByDateVenueFormat - key `date|venueId|format`
 * @property {number} slotCount
 */

/**
 * The placement state. Deep-frozen except for `ledger`.
 *
 * @typedef {Object} ResolveState
 * @property {string[]} gameIds - every game in the run, sorted
 * @property {Record<string, PlacedGame>} games - the currently placed ones
 * @property {Record<string, PlacedGame>} baseline
 * @property {Record<string, string>} dispositions - gameId -> freeze disposition
 * @property {Record<string, string[]>} admittedSlotsByGameId - slots a change request brought
 * @property {Record<string, string>} pinnedAt - gameId -> the slot key it was frozen at mid-run by `pinGames()`; the position `freeze-audit` holds it to, in place of the baseline
 * @property {string[]} pending - dislodged, awaiting placement
 * @property {Array<{ gameId: string, reason: string }>} unplaced - TIME TBD
 * @property {SlotInventory} inventory
 * @property {ResolveLedger} ledger
 */

/**
 * A stage's freeze contract. Required, and required to be filled in: a stage
 * that says nothing about how it treats the freeze cannot be registered.
 *
 * @typedef {Object} FreezeContract
 * @property {string[]} mutationKinds - empty means "this stage writes nothing"
 * @property {'offers-frozen-move'|'writes-nothing'} probe
 * @property {string} claim - what this stage promises about frozen games
 */

/**
 * One stage of the pipeline.
 *
 * @typedef {Object} ResolveStage
 * @property {string} id
 * @property {string} title
 * @property {FreezeContract} freezeContract
 * @property {(state: ResolveState, context: Object) => ResolveState} run
 */

/**
 * What one stage did.
 *
 * @typedef {Object} StageResult
 * @property {string} stageId
 * @property {string} title
 * @property {string[]} declaredMutationKinds
 * @property {string} claim
 * @property {number} movesConsidered
 * @property {number} movesRejectedByFreeze
 * @property {number} movesApplied
 * @property {number} findingsEmitted
 */

/**
 * Everything either entry point accepts.
 *
 * @typedef {Object} ResolveInput
 * @property {import('../ruleEngine/types.js').Schedule} schedule - the baseline
 * @property {ReadonlyArray<Object>} [changes] - see `ScheduleChangeRequestSchema`
 * @property {Object} engines - `{ graph, table, calendar, registry, resources?, ruleEngine?, waiverLedger? }`
 * @property {import('../freeze/types.js').FreezePlan} [freeze] - omit for maximum freeze
 * @property {boolean} [holdChanges] - pin the changed games at the slots they were given
 * @property {'throw'|'report'} [onUnsatisfiable]
 * @property {ReadonlyArray<Object>} [extraStages] - inserted before `freeze-audit`
 * @property {Object|null} [baselineVerification] - a `runRuleEngine()` result over the baseline
 * @property {boolean} [verify] - false skips the rule-engine pass
 * @property {string} [name]
 * @property {string} [reason] - `reoptimiseWholeSeason()` only, and required there
 * @property {true} [acknowledged] - `reoptimiseWholeSeason()` only, and required there
 * @property {string} [requestedBy] - `reoptimiseWholeSeason()` only
 * @property {ReadonlyArray<Object>} [holdScopes] - `reoptimiseWholeSeason()` only: rules to hold parts of the season even under a thawed default
 */

/**
 * The whole answer.
 *
 * @typedef {Object} ResolveRun
 * @property {string} name
 * @property {import('../ruleEngine/types.js').Schedule} schedule - the resolved schedule
 * @property {import('../ruleEngine/types.js').Schedule} baselineSchedule
 * @property {import('../freeze/types.js').FreezePlan} freeze
 * @property {import('../freeze/types.js').FreezeJudgementSet} judgements
 * @property {ResolveState} state
 * @property {ScheduleChange[]} moved - by game, never a bare count
 * @property {Array<{ gameId: string, reason: string }>} unplaced
 * @property {MoveRecord[]} moves
 * @property {StageResult[]} stages
 * @property {Array<Object>} unsatisfiable - every frozen game reported rather than thrown
 * @property {Object|null} verification
 * @property {import('../freeze/types.js').FreezeFinding[]} findings
 * @property {string} status
 * @property {ResolveMeta} meta
 */

/**
 * One game that ended up somewhere other than where it started.
 *
 * @typedef {Object} ScheduleChange
 * @property {string} gameId
 * @property {string} label
 * @property {string} disposition
 * @property {string[]} changedFields
 * @property {Slot|null} before
 * @property {Slot|null} after
 */

/**
 * Counters.
 *
 * @typedef {Object} ResolveMeta
 * @property {number} gamesExamined
 * @property {number} freezeJudgements
 * @property {number} stagesRegistered
 * @property {number} stagesRun
 * @property {number} movesConsidered
 * @property {number} movesRejectedByFreeze
 * @property {number} movesApplied
 * @property {number} candidatesEvaluated
 * @property {number} candidatesRejected
 * @property {number} conflictsExamined
 * @property {number} gamesDislodged
 * @property {number} gamesReplaced
 * @property {number} gamesTimeTbd
 * @property {number} gamesAudited
 * @property {number} rulesRun
 * @property {number} rulesExercised
 * @property {number} constraintsConsulted
 * @property {number} slotsAvailable
 */

export {};
