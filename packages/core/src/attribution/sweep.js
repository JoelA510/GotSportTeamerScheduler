/**
 * **Every game in the schedule, attributed** — and the count that proves it.
 *
 * > *Acceptance test: for every game in the fixture, the system produces an
 * > attribution.*
 *
 * The dangerous version of this function is the one that returns a list of
 * attributions for the rows it managed to explain. It would pass its own test on
 * a season it had half-read, which is incident 4 in
 * `fixtures/season-2026/README.md` — *"a perfect score meaning 'I looked at
 * nothing'"*.
 *
 * So the subject set is enumerated from **`schedule.games`**, the schedule as
 * handed in, and coverage is a comparison of two numbers that come from
 * different places: `gamesInSchedule` from the schedule, `gamesAttributed` from
 * the answers. A row that produced no claim is named in `coverage.gamesUnattributed`
 * and is `ATTRIBUTION_GAME_UNATTRIBUTED` at `blocking`; it is never quietly
 * absent from the list. `docs/LESSONS_LEARNED.md`: *"never derive a check's
 * subject set from the data a break would corrupt"*.
 *
 * Three things are asserted mechanically rather than trusted:
 *
 * - **completeness** — `gamesAttributed === gamesInSchedule`, with the shortfall
 *   named;
 * - **substance** — every attribution carries at least one claim, and
 *   `claimsPerGameMinimum` reports the thinnest one so a season of empty answers
 *   cannot average its way to looking fine;
 * - **specificity** — `categoryOnlyClaims` counts claims that named a category
 *   rather than an instance, and is expected to be zero. It is a count rather
 *   than a boolean because "one game in six hundred" and "all of them" need
 *   different reactions.
 *
 * @module attribution/sweep
 */

import { explainGame } from './explain.js';
import {
  ATTRIBUTION_REASON,
  createAttributionMeta,
  deriveAttributionStatus,
  makeAttributionFinding,
  mergeAttributionMeta,
} from './reasonCodes.js';

/**
 * Attribute every game in the schedule.
 *
 * @param {import('./types.js').AttributionContext} context
 * @returns {import('./types.js').ScheduleAttribution}
 */
export function explainSchedule(context) {
  const meta = createAttributionMeta();
  /** @type {import('./types.js').AttributionFinding[]} */
  const findings = [...context.findings];
  // The context's own findings are carried once here and stripped from each
  // per-game answer below, so "no rule engine ran" is stated once rather than
  // six hundred and seventy-nine times.
  const contextFindings = new Set(context.findings);

  const games = context.schedule.games;
  /** @type {import('./types.js').GameAttribution[]} */
  const attributions = [];
  /** @type {Record<string, import('./types.js').GameAttribution>} */
  const byGameId = {};
  /** @type {string[]} */
  const unattributed = [];
  let claims = 0;
  let claimsPerGameMinimum = Number.POSITIVE_INFINITY;
  let categoryOnly = 0;

  for (const game of games) {
    const attribution = explainGame(context, { gameId: game.id });
    attributions.push(attribution);
    byGameId[game.id] = attribution;
    mergeAttributionMeta(meta, attribution.meta);
    claims += attribution.claims.length;
    claimsPerGameMinimum = Math.min(claimsPerGameMinimum, attribution.claims.length);
    categoryOnly += attribution.meta.claimsCategoryOnly;
    if (attribution.claims.length === 0) unattributed.push(game.id);
    for (const finding of attribution.findings) {
      if (contextFindings.has(finding)) continue;
      findings.push(finding);
    }
  }

  if (games.length === 0) {
    findings.push(
      makeAttributionFinding(
        ATTRIBUTION_REASON.ATTRIBUTION_SWEEP_VACUOUS,
        'the schedule handed to the attribution sweep holds no games, so "every game is attributed" is true of nothing',
        { scheduleName: context.schedule.name }
      )
    );
  }

  const complete = games.length > 0 && meta.gamesAttributed === games.length;

  return {
    attributions,
    byGameId,
    coverage: {
      gamesInSchedule: games.length,
      gamesAttributed: meta.gamesAttributed,
      gamesUnattributed: unattributed,
      claims,
      claimsPerGameMinimum: Number.isFinite(claimsPerGameMinimum) ? claimsPerGameMinimum : 0,
      categoryOnlyClaims: categoryOnly,
      complete,
    },
    findings,
    meta,
    status: deriveAttributionStatus(findings),
  };
}
