/**
 * Types for the freeze scope model.
 *
 * JSDoc typedefs only — this file emits no runtime code, exactly as
 * `constraints/types.js`, `waivers/types.js` and `ruleEngine/types.js` do for
 * their modules.
 *
 * @module freeze/types
 */

/**
 * One finding: a machine-readable code, a looked-up severity, a human message
 * and flat primitive details.
 *
 * @typedef {Object} FreezeFinding
 * @property {string} code - a {@link import('./reasonCodes.js').FREEZE_REASON} value
 * @property {string} severity - a {@link import('./reasonCodes.js').FREEZE_SEVERITY} value
 * @property {string} message - for humans only; never parsed
 * @property {Record<string, unknown>} details
 */

/**
 * The conjunction one rule matches on. Every named dimension must match; a
 * dimension left `null` is not named and imposes nothing.
 *
 * @typedef {Object} FreezeMatch
 * @property {string|null} date - ISO `YYYY-MM-DD`
 * @property {string|null} fromDate - inclusive
 * @property {string|null} toDate - inclusive
 * @property {string|null} divisionLabel - a LABEL, not a key (GAP-24)
 * @property {string|null} venueId
 * @property {string|null} surfaceId - matched against the surface's lineage
 * @property {string|null} format
 * @property {string|null} teamId - matched against either side
 * @property {string|null} gameId
 */

/**
 * One rule of a plan.
 *
 * @typedef {Object} FreezeRule
 * @property {string} id - stable, derived from the match when not supplied
 * @property {string} kind - a {@link import('./reasonCodes.js').FREEZE_RULE_KIND} value
 * @property {FreezeMatch} match
 * @property {string|null} reason - why the operator wrote it
 */

/**
 * A whole plan: a default disposition plus the rules that carve it up.
 *
 * @typedef {Object} FreezePlan
 * @property {string} name
 * @property {string} defaultDisposition - a {@link import('./reasonCodes.js').FREEZE_DISPOSITION} value
 * @property {FreezeRule[]} rules
 * @property {GlobalReoptimisation|null} globalReoptimisation
 * @property {FreezeFinding[]} findings
 * @property {string} status
 */

/**
 * The acknowledgement a thawed default requires.
 *
 * @typedef {Object} GlobalReoptimisation
 * @property {string} reason - non-empty
 * @property {true} acknowledged - the literal `true`, never a truthy value
 * @property {string|null} requestedBy
 */

/**
 * Where one game stands, for a plan to judge it against.
 *
 * @typedef {Object} FreezeContext
 * @property {string} gameId
 * @property {string|null} [date]
 * @property {string|null} [divisionLabel]
 * @property {string|null} [venueId]
 * @property {string|null} [surfaceId]
 * @property {ReadonlyArray<string>} [surfaceLineage]
 * @property {string|null} [format]
 * @property {ReadonlyArray<string>} [teamIds]
 */

/**
 * The verdict on one game.
 *
 * @typedef {Object} FreezeJudgement
 * @property {string} gameId
 * @property {string} disposition - a {@link import('./reasonCodes.js').FREEZE_DISPOSITION} value
 * @property {boolean} frozen
 * @property {string|null} decidedByRuleId - null when the default decided
 * @property {string|null} decidedByReason - the operator's own words, when the rule carried any
 * @property {number} specificity - rank of the winning rule, 0 for the default
 * @property {boolean} judged - false when some rule named a dimension the game lacks
 * @property {string[]} matchedRuleIds
 * @property {FreezeFinding[]} findings
 * @property {FreezeMeta} meta
 */

/**
 * The verdict on a whole set of games.
 *
 * @typedef {Object} FreezeJudgementSet
 * @property {Record<string, FreezeJudgement>} byGameId
 * @property {string[]} frozenGameIds
 * @property {string[]} thawedGameIds
 * @property {FreezeFinding[]} findings
 * @property {string} status
 * @property {FreezeMeta} meta
 */

/**
 * Counters. A judgement that examined nothing must never read as a judgement
 * that found everything held.
 *
 * @typedef {Object} FreezeMeta
 * @property {number} gamesJudged
 * @property {number} rulesTested
 * @property {number} dimensionsTested
 * @property {number} frozenGames
 * @property {number} thawedGames
 * @property {number} unjudgedDimensions
 * @property {number} ambiguitiesReported
 * @property {number} rulesThatMatchedSomething
 * @property {number} rulesThatMatchedNothing
 */

export {};
