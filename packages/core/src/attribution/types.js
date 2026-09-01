/**
 * JSDoc typedefs for the explain-why layer.
 *
 * Type-only module: no runtime exports, ending in `export {};` so it stays a
 * module, exactly like `facility/types.js` and `resolve/types.js`.
 *
 * The centre of this file is {@link ConstraintClaim}. Everything else is a
 * container for a list of them. A claim is one *specific constraint instance*
 * standing in the way of, or setting the boundary of, one decision — the permit
 * record with its close minute and the slack against it, the booking on
 * overlapping ground with its id, the travel floor with the gap and the
 * shortfall. A claim that can only say `sunset` is refused at the point it is
 * built, because that is the answer somebody had to derive the real one from.
 *
 * @module attribution/types
 */

/**
 * One machine-readable reason. Identical in shape to `FacilityFinding`,
 * `TimingFinding`, `AvailabilityFinding`, `ConstraintFinding`, `WaiverFinding`,
 * `RuleFinding` and `FreezeFinding`, so all eight merge into one list without a
 * translation layer.
 *
 * @typedef {Object} AttributionFinding
 * @property {string} code
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

/**
 * One constraint instance, as an answer.
 *
 * `slackMinutes` is **copied** from whichever module computed it and is never
 * recomputed here: `limit - end` for an availability bound, `gap - minimum` for
 * a travel floor, the owner's own number in every other case. Negative means the
 * bound is broken by that many minutes.
 *
 * @typedef {Object} ConstraintClaim
 * @property {string} source - an `ATTRIBUTION_SOURCE` value: which module decided this
 * @property {string} kind - the constraint kind in that source's own vocabulary
 * @property {string|null} instanceId - the specific record: permit id, booking id,
 *   date, transition id. Half of "an instance, not a category"
 * @property {string|null} constraintId - the primary registry constraint, when one governs it
 * @property {string[]} constraintIds
 * @property {string|null} code - the reason code, when a finding carried one
 * @property {string[]} codes - every code that spoke about this instance
 * @property {string} severity
 * @property {boolean} binding - true when the machinery that owns this claim
 *   marked it binding, or when it raised a `blocking` finding about it. Never a
 *   judgement formed here: both halves are read off what the owner reported
 * @property {number|null} limitMinutes
 * @property {number|null} slackMinutes
 * @property {Record<string, number>} computed - the other half of "an instance,
 *   not a category": every numeric value the owner reported
 * @property {string} summary - `"gap 50 min, minimum gap 60 min"`, rendered once
 *   by `ruleEngine/engine.js`'s `summariseComputed()`
 * @property {string} detail - the owner's own sentence, carried unedited
 * @property {Array<{ kind: string, id: string }>} entities - ids only, never labels
 */

/**
 * A constraint that does **not** bound the thing asked about, and the owner's
 * stated reason why.
 *
 * Carried rather than dropped: "the field is lit, so sunset does not bound it"
 * is the difference between a rule that did not apply and a rule nobody checked.
 *
 * @typedef {Object} InapplicableConstraint
 * @property {string} source
 * @property {string} kind
 * @property {string} reason
 */

/**
 * Everything one run of the explain-why layer needs, built once.
 *
 * @typedef {Object} AttributionContext
 * @property {{ graph: Object, table: Object, calendar: Object, registry: Object }} engines
 * @property {import('../ruleEngine/types.js').Schedule} schedule
 * @property {import('../resolve/types.js').ResolveState} state
 * @property {Object|null} verification - a `runRuleEngine()` result
 * @property {Object|null} travel - an `evaluateCoachTravel()` result
 * @property {Object|null} roster - a `CoachRoster`
 * @property {Object|null} soleCoach - a `soleCoachRiskRegister()` result
 * @property {AttributionFinding[]} findings - what this context was built without
 * @property {AttributionMeta} meta
 * @property {string} status
 */

/**
 * Why one game stands where it stands.
 *
 * `status` is the status of the **answer**; `placementStatus` and `legal` are the
 * game's own verdict, from `checkPlacement()`.
 *
 * @typedef {Object} GameAttribution
 * @property {string} gameId
 * @property {string} label
 * @property {import('../resolve/types.js').Slot} slot
 * @property {number|null} endMinutes
 * @property {string|null} format
 * @property {ConstraintClaim[]} claims - tightest first
 * @property {ConstraintClaim|null} binding
 * @property {string[]} bindingKinds - consumed from `checkKickoffAvailability()`
 * @property {InapplicableConstraint[]} notApplicable
 * @property {string[]} blockingCodes
 * @property {boolean} legal
 * @property {string} placementStatus
 * @property {AttributionFinding[]} findings
 * @property {AttributionMeta} meta
 * @property {string} status
 */

/**
 * The whole season, attributed.
 *
 * @typedef {Object} ScheduleAttribution
 * @property {GameAttribution[]} attributions
 * @property {Record<string, GameAttribution>} byGameId
 * @property {{ gamesInSchedule: number, gamesAttributed: number, gamesUnattributed: string[],
 *   claims: number, claimsPerGameMinimum: number, categoryOnlyClaims: number,
 *   complete: boolean }} coverage
 * @property {AttributionFinding[]} findings
 * @property {AttributionMeta} meta
 * @property {string} status
 */

/**
 * *"Why is this game at 12:00 and not 12:30?"*
 *
 * Two sides, always both: what bounds the slot it has, and what the alternative
 * would break. An answer with only the first half cannot explain a time, and an
 * answer with only the second cannot say whether the current time is any better.
 *
 * @typedef {Object} TimeAttribution
 * @property {string} question - an `ATTRIBUTION_QUESTION` value
 * @property {string} gameId
 * @property {string} label
 * @property {import('../resolve/types.js').Slot} slot - where it stands
 * @property {import('../resolve/types.js').Slot} alternative - where it does not
 * @property {GameAttribution} current
 * @property {{ legal: boolean, placementStatus: string, claims: ConstraintClaim[],
 *   binding: ConstraintClaim|null, blockingCodes: string[], counterpartGameIds: string[],
 *   constraintIds: string[] }} counterfactual
 * @property {AttributionFinding[]} findings
 * @property {AttributionMeta} meta
 * @property {string} status
 */

/**
 * A computed boundary — the latest kickoff, or the earliest one with a full
 * warm-up — and which constraint set it.
 *
 * @typedef {Object} BoundaryAttribution
 * @property {string} question - an `ATTRIBUTION_QUESTION` value
 * @property {string|null} gameId
 * @property {string} surfaceId
 * @property {string} date
 * @property {string|null} format
 * @property {number|null} kickoffMinutes - the boundary itself, null when there is none
 * @property {number|null} headroomMinutes - boundary less the game's current kickoff
 * @property {ConstraintClaim[]} claims - tightest first
 * @property {ConstraintClaim|null} binding
 * @property {string[]} bindingKinds
 * @property {InapplicableConstraint[]} notApplicable
 * @property {AttributionFinding[]} findings
 * @property {AttributionMeta} meta
 * @property {string} status
 */

/**
 * *"Why did this team get a conflict?"*
 *
 * @typedef {Object} ConflictAttribution
 * @property {string} question - an `ATTRIBUTION_QUESTION` value
 * @property {string} teamId
 * @property {Array<{ transitionId: string, personId: string, date: string,
 *   counterpartTeamIds: string[], coverPersonIds: string[], counterpartGameIds: string[],
 *   claims: ConstraintClaim[], binding: ConstraintClaim|null }>} conflicts -
 *   `coverPersonIds` is the other active coaches of the counterpart team, from
 *   `coCoachesOf()`; empty means nobody could have taken it
 * @property {ConstraintClaim[]} claims - every conflict's claims, tightest first
 * @property {ConstraintClaim|null} binding
 * @property {AttributionFinding[]} findings
 * @property {AttributionMeta} meta
 * @property {string} status
 */

/**
 * The smallest set of constraints that together make a placement impossible.
 *
 * **Minimal in the real sense**: `witnesses` carries, for each member, the
 * result of relaxing every *other* member — the placement is still illegal, so
 * that member is doing work no other member does. A set that is merely short
 * carries no witnesses and is reported `certified: false`.
 *
 * @typedef {Object} MinimalBlockingSet
 * @property {string} gameId
 * @property {import('../resolve/types.js').Slot} slot
 * @property {boolean} blocked - false when the placement is legal
 * @property {string[]} constraintIds - the minimal set
 * @property {ConstraintClaim[]} claims - one per member, tightest first
 * @property {string[]} candidateConstraintIds - what the filter started from
 * @property {string[]} droppedConstraintIds - candidates proved unnecessary
 * @property {string[]} ungovernedBlockingCodes - blockers no registry constraint claims
 * @property {Array<{ constraintId: string, relaxedConstraintIds: string[], legal: boolean,
 *   blockingCodes: string[] }>} witnesses - the proof, one row per member
 * @property {{ legalWhenAllRelaxed: boolean, registryConstraintsHeld: number,
 *   candidatesConsidered: number, membersReported: number }} proof
 * @property {boolean} certified - every member proved necessary and the whole set sufficient
 * @property {AttributionFinding[]} findings
 * @property {AttributionMeta} meta
 * @property {string} status
 */

/**
 * Counters proving an answer looked at something.
 *
 * @typedef {Object} AttributionMeta
 * @property {number} gamesExamined
 * @property {number} gamesAttributed
 * @property {number} claimsBuilt
 * @property {number} claimsBinding
 * @property {number} claimsCategoryOnly
 * @property {number} availabilityConstraintsConsulted
 * @property {number} violationsConsulted
 * @property {number} transitionsConsulted
 * @property {number} rosterEntriesConsulted
 * @property {number} placementChecksRun
 * @property {number} registryRecordsUnjudged - records the severity lookup could not judge for a game this answer asked about, and so did not apply
 * @property {number} boundaryQueriesRun
 * @property {number} relaxationsTested
 * @property {number} membersProvenNecessary
 * @property {number} membersDropped
 */

export {};
