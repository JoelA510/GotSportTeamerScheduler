/**
 * Incident 9's waiver, as a record.
 *
 * The incident, in full, from `fixtures/season-2026/README.md`:
 *
 * > **A board waiver with a lifecycle.** A 60-minute travel floor was waived
 * > for one coach because two venues are ~5 minutes apart; the waiver then
 * > became unnecessary when times shifted, then relevant again. It lived in a
 * > code comment and was lost once across a rebuild.
 *
 * ## Why this adapter takes arguments when `season2026Constraints.js` does not
 *
 * The constraint adapter is a transcription and takes nothing, because every
 * constraint it seeds is stated somewhere in the corpus or the incident log.
 * This one cannot be: the log records that a waiver existed, what it was for,
 * why it was granted and who granted it, and **does not name the coach or the
 * two venues**. That is not an oversight in the log — it is the whole incident.
 * The waiver lived in a code comment, and a code comment is exactly the place
 * where "which coach?" goes to be forgotten.
 *
 * So the subject is a parameter. The caller derives it from the corpus (the
 * acceptance test does exactly that, by finding the coach whose day the
 * incident describes), and everything the log *does* record — the constraint,
 * the reason, the approving body, the absence of a date, the five minutes — is
 * transcribed here. Inventing a person id in `packages/core` would be both a
 * fabrication and a needless piece of PII in the repository.
 *
 * The arrow still points fixtures -> core: this module reads nothing from disk.
 *
 * @module waivers/adapters/season2026Waivers
 */

import { SEASON_2026_CONSTRAINT_ID } from '../../constraints/adapters/season2026Constraints.js';
import { buildWaiverLedger } from '../ledger.js';

/**
 * Stable ids for the seeded set, so callers and tests never spell one by hand.
 *
 * @readonly
 * @enum {string}
 */
export const SEASON_2026_WAIVER_ID = Object.freeze({
  COACH_TRAVEL_BOARD_EXCEPTION: 'coach-travel-board-exception',
});

/** `fixtures/season-2026/README.md`, cited often enough to get a constant. */
const INCIDENT_LOG = 'fixtures/season-2026/README.md — incident log, incident 9';

/**
 * The travel time the board's decision rested on. The incident log says the two
 * venues are "~5 minutes apart"; the tilde is why this is a parameter on the
 * record rather than a second constraint.
 */
export const INCIDENT_9_OBSERVED_TRAVEL_MINUTES = 5;

/**
 * Build incident 9's waiver for a named coach and a named pair of venues.
 *
 * @param {{ personId: string, venueIds: string[], effectiveFrom?: string|null, effectiveTo?: string|null, subjectSource?: string }} input
 * @returns {Object} a plain record, ready for `buildWaiverLedger()`
 */
export function makeSeason2026TravelWaiver(input) {
  const { personId, venueIds, effectiveFrom = null, effectiveTo = null, subjectSource } = input;
  if (!personId) throw new Error('waivers: incident 9 waiver needs the coach it was granted to');
  if (!Array.isArray(venueIds) || venueIds.length < 2) {
    throw new Error(
      'waivers: incident 9 waiver needs the two venues the board found to be five minutes apart'
    );
  }

  return {
    id: SEASON_2026_WAIVER_ID.COACH_TRAVEL_BOARD_EXCEPTION,
    constraintId: SEASON_2026_CONSTRAINT_ID.COACH_TRAVEL_BETWEEN_VENUES,
    name: 'Board exception to the 60-minute inter-venue travel floor',
    scope: {
      personId,
      venueIds: [...venueIds].sort(),
      label: 'one coach, between two venues five minutes apart',
    },
    // Empty: the board waived *the travel rule*, not one of its reason codes.
    reasonCodes: [],
    reason:
      'The two venues are approximately five minutes apart, so the hour the travel floor assumes is not the hour this journey takes. The board granted the exception for this coach and these two sites only.',
    approval: {
      approvedBy: 'club board',
      approvedAt: null,
      reference: subjectSource
        ? `${INCIDENT_LOG}; subject derived from ${subjectSource}`
        : INCIDENT_LOG,
      note: 'the incident log records that the waiver "lived in a code comment and was lost once across a rebuild", so no dated decision survives; the coach and the venue pair are derived from the corpus because the log names neither',
    },
    effectiveFrom,
    effectiveTo,
    parameters: { observedTravelMinutes: INCIDENT_9_OBSERVED_TRAVEL_MINUTES },
  };
}

/**
 * Build the seeded ledger.
 *
 * @param {{ personId: string, venueIds: string[], effectiveFrom?: string|null, effectiveTo?: string|null, subjectSource?: string, extraWaivers?: ReadonlyArray<Object> }} input
 * @returns {import('../types.js').WaiverLedger}
 */
export function buildSeason2026WaiverLedger(input) {
  const { extraWaivers = [], ...waiverInput } = input;
  return buildWaiverLedger({
    name: 'season-2026',
    source: 'fixtures/season-2026 + the incident log',
    waivers: [makeSeason2026TravelWaiver(waiverInput), ...extraWaivers],
  });
}
