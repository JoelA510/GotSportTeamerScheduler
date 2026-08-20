/**
 * Barrel for scheduled things that are not fully known yet.
 *
 * Every public export of `reserve/` goes through this file, exactly as
 * `facility/index.js`, `timing/index.js`, `availability/index.js`,
 * `constraints/index.js`, `waivers/index.js`, `ruleEngine/index.js`,
 * `people/index.js`, `freeze/index.js`, `resolve/index.js` and
 * `attribution/index.js` do for theirs.
 *
 * ## What this module is
 *
 * Three kinds of thing the source project handled with ad-hoc string hacks, and
 * one report over them:
 *
 * | thing | what it is | corpus |
 * | --- | --- | --- |
 * | **unnamed fixture** | a field and a kickoff the club committed before the league said who plays | 100 `Select Game N` rows across 10 dates (GAP-16) |
 * | **reservation** | ground held for a purpose with no fixture behind it | one `Scrimmage - teams TBD` row (GAP-17) |
 * | **unplaced fixture** | a game that must exist and has no legal slot | incident 10 (GAP-28) |
 * | **capacity** | how many slots a date holds, against a stated requirement | derived from the corpus, `sunsets.csv` and the permits |
 *
 * Alongside them, {@link FIXTURE_SIDE} separates the four things the corpus
 * spells with one `-` character: an opponent that does not exist (GAP-15), one
 * the league has not named yet, a reservation with no fixture at all, and a real
 * visiting club with no id in this system (GAP-18).
 *
 * ## What it deliberately is not
 *
 * - **Not a solver.** Nothing here places a game. `resolve/` re-places games
 *   against a freeze plan and `placement/` demonstrates hardness; this module
 *   holds what they produce and counts what the ground can take.
 * - **Not a second evaluator.** There is no overlap test, no permit reading, no
 *   occupancy arithmetic and no tightness comparison in this package. Whether
 *   ground overlaps is `facility/occupancy.js`; whether a kickoff is legal and
 *   what bounds it is `availability/kickoff.js`; how long a format occupies a
 *   field is `timing/`; which registry constraint claims a code is
 *   `constraints/` through `resolve/errors.js`.
 * - **Not persisted.** Phase 5 is in-memory only. There is no SQL home for a
 *   reserved slot, a condition or a capacity report and this work deliberately
 *   does not create one, consistently with Phases 1-4.
 * - **Not wired into the shipping exports.** `publication.js` emits rows in
 *   `outputGeneration.js`'s own column vocabulary; it does not relax that
 *   function's four validators and its `new Date()` normaliser, which is what
 *   accepting a `TIME TBD` row through it would require. See that module's
 *   header for the reasoning and `docs/MODEL_GAPS.md` for the follow-up.
 *
 * @module reserve
 */

export {
  BINDABLE_SIDES,
  CONDITION_VERDICT,
  FIXTURE_SIDE,
  PUBLICATION_TBD,
  RESERVE_KIND,
  RESERVE_REASON,
  RESERVE_REASON_SEVERITY,
  RESERVE_SEVERITY,
  RESERVE_STATUS,
  SLOT_CONDITION_KIND,
  createReserveMeta,
  deriveReserveStatus,
  makeReserveFinding,
  mergeReserveMeta,
  reserveSeverityOf,
} from './reasonCodes.js';

export {
  CapacityCapSchema,
  CapacityRequirementSchema,
  ReserveCapacityInputSchema,
  ReservedSlotSchema,
  SlotBindingSchema,
  SlotConditionSchema,
  UnplacedFixtureSchema,
} from './schemas.js';

export {
  SLOT_FOOTPRINT_FIELDS,
  applySlotBindings,
  checkSlotsUnmoved,
  makeReservedSlot,
  reservedSlotFootprint,
  slotIsSettled,
  slotNamesATeam,
  slotsToBookings,
  summariseSlots,
} from './slots.js';

export {
  CONDITION_DERIVED_FROM,
  conditionForSurface,
  conditionsForSurfaces,
  describeSlotCondition,
  evaluateSlotCondition,
} from './conditions.js';

export {
  accountForFixtures,
  makeUnplacedFixture,
  unplacedFromPlacementRun,
  unplacedFromResolveRun,
} from './unplaced.js';

export { buildReserveCapacityReport, capacitySlotId } from './capacity.js';

export {
  PUBLICATION_EVENT_TYPE,
  naiveDateTime,
  publicationCoverageFindings,
  publicationRowsFor,
} from './publication.js';

export {
  SEASON_2026_EARLIEST_KICKOFF_MINUTES,
  SEASON_2026_KIND,
  SEASON_2026_LEAGUE_CAP_PER_DATE,
  SEASON_2026_RESERVE_FORMAT,
  season2026CapacityRequirement,
  season2026FixtureSides,
  season2026LeagueCap,
  season2026ReserveBookings,
  season2026ReserveCapacityInput,
  season2026ReservedSlots,
  season2026SelectTeamIds,
} from './adapters/season2026Reserve.js';
