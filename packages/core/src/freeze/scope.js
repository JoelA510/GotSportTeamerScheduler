/**
 * Freeze scope matching: which games one rule reaches, and how narrow it is.
 *
 * **Mirrors `waivers/scope.js`; deliberately does not reuse it.** The two
 * models rhyme — a conjunction of named dimensions, shared specificity
 * integers, a verdict kept rather than dropped when a dimension cannot be
 * judged — and they answer different questions. A waiver asks *"is this subject
 * excused?"*; a freeze asks *"is this game held?"*. The differences are small
 * and load-bearing:
 *
 * | | waiver scope | freeze scope |
 * |---|---|---|
 * | dimensions | person, team, game, venues, surface, division, date, date-range | date, date-range, division, venue, surface, **format**, team, game |
 * | team match | the waiver's team is in the subject's `teamIds` | either side of the game |
 * | venue match | the subject's venues are a **subset** of the waiver's | the game's one venue equals the rule's |
 * | unjudged | not applied | **applied** — see `reasonCodes.js` |
 *
 * Everything else is the same by design, including `specificityOf` reading the
 * ranks `CONSTRAINT_SCOPE_SPECIFICITY` sets, so a comparison across the three
 * models means something.
 *
 * @module freeze/scope
 */

import { FREEZE_SCOPE_DIMENSION, freezeSpecificityOf } from './reasonCodes.js';

/**
 * Normalise a context so the plural forms always exist.
 *
 * `surfaceLineage` defaults to `[surfaceId]` — correct for a leaf and lossy for
 * anything with ancestors, so callers holding a
 * {@link import('../facility/types.js').FacilityGraph} should pass
 * `surface.lineage`. Freezing "Pitch 1" must freeze the games standing on 1A
 * and 1B, and only the lineage says so.
 *
 * `teamIds` is assembled from whichever of `teamIds`, `homeTeamId` and
 * `awayTeamId` the caller supplied. A game that names **no** team yields `[]`,
 * which is a real answer — a Minis session is definitively not any given team's
 * game — and is distinct from `undefined`, which means the caller did not say.
 *
 * @param {import('./types.js').FreezeContext} context
 * @returns {Record<string, unknown>}
 */
export function normaliseFreezeContext(context) {
  /** @type {string[]|undefined} */
  let teamIds;
  if (context.teamIds !== undefined) {
    teamIds = [...context.teamIds];
  } else if ('homeTeamId' in context || 'awayTeamId' in context) {
    const sides = /** @type {Record<string, unknown>} */ (context);
    teamIds = [sides.homeTeamId, sides.awayTeamId]
      .filter((id) => typeof id === 'string' && id.length > 0)
      .map((id) => /** @type {string} */ (id));
  }

  return {
    ...context,
    teamIds,
    surfaceLineage:
      context.surfaceLineage === undefined
        ? context.surfaceId
          ? [context.surfaceId]
          : undefined
        : [...context.surfaceLineage],
  };
}

/**
 * Every dimension a match names, in a stable order.
 *
 * @param {import('./types.js').FreezeMatch} match
 * @returns {string[]}
 */
export function freezeDimensions(match) {
  /** @type {string[]} */
  const named = [];
  if (match.date !== null) named.push(FREEZE_SCOPE_DIMENSION.DATE);
  if (match.fromDate !== null || match.toDate !== null) {
    named.push(FREEZE_SCOPE_DIMENSION.DATE_RANGE);
  }
  if (match.divisionLabel !== null) named.push(FREEZE_SCOPE_DIMENSION.DIVISION);
  if (match.venueId !== null) named.push(FREEZE_SCOPE_DIMENSION.VENUE);
  if (match.surfaceId !== null) named.push(FREEZE_SCOPE_DIMENSION.SURFACE);
  if (match.format !== null) named.push(FREEZE_SCOPE_DIMENSION.FORMAT);
  if (match.teamId !== null) named.push(FREEZE_SCOPE_DIMENSION.TEAM);
  if (match.gameId !== null) named.push(FREEZE_SCOPE_DIMENSION.GAME);
  return named.sort();
}

/**
 * How narrow a match is: the rank of the **narrowest** dimension it names.
 *
 * The narrowest rather than the broadest, for the reason `waivers/scope.js`
 * gives: a conjunction is at least as narrow as its narrowest term. "9v9 on
 * 08/22" is a statement about one date however many formats share it.
 *
 * @param {import('./types.js').FreezeMatch} match
 * @returns {number}
 */
export function freezeSpecificity(match) {
  let best = 0;
  for (const dimension of freezeDimensions(match)) {
    const rank = freezeSpecificityOf(dimension);
    if (rank > best) best = rank;
  }
  return best;
}

/**
 * Does every dimension this match names reach this game?
 *
 * Written as a flat sequence of independent checks rather than a table-driven
 * loop, exactly as `judgeWaiverScope()` is and for the same reason: each
 * dimension matches by its own rule — an id against an id, a surface against a
 * lineage, a team against either side, a date against a range — and a generic
 * matcher would have to be told the rule anyway.
 *
 * @param {import('./types.js').FreezeMatch} match
 * @param {Record<string, unknown>} context - already normalised
 * @returns {{ matches: boolean, judged: boolean, unjudgedDimension: string|null, dimensionsTested: number, labelMatched: boolean }}
 */
export function judgeFreezeMatch(match, context) {
  let dimensionsTested = 0;
  let labelMatched = false;

  /** @type {Array<{ dimension: string, value: unknown, matches: () => boolean }>} */
  const checks = [];

  if (match.gameId !== null) {
    checks.push({
      dimension: FREEZE_SCOPE_DIMENSION.GAME,
      value: context.gameId,
      matches: () => context.gameId === match.gameId,
    });
  }
  if (match.teamId !== null) {
    checks.push({
      dimension: FREEZE_SCOPE_DIMENSION.TEAM,
      value: context.teamIds,
      // Either side. A team's games are its games whichever column it sits in.
      matches: () => /** @type {string[]} */ (context.teamIds).includes(match.teamId),
    });
  }
  if (match.surfaceId !== null) {
    checks.push({
      dimension: FREEZE_SCOPE_DIMENSION.SURFACE,
      value: context.surfaceLineage,
      // Lineage, so freezing "Pitch 1" freezes the games on 1A and 1B.
      matches: () =>
        /** @type {string[]} */ (context.surfaceLineage).includes(
          /** @type {string} */ (match.surfaceId)
        ),
    });
  }
  if (match.venueId !== null) {
    checks.push({
      dimension: FREEZE_SCOPE_DIMENSION.VENUE,
      value: context.venueId,
      matches: () => context.venueId === match.venueId,
    });
  }
  if (match.format !== null) {
    checks.push({
      dimension: FREEZE_SCOPE_DIMENSION.FORMAT,
      value: context.format,
      matches: () => context.format === match.format,
    });
  }
  if (match.date !== null) {
    checks.push({
      dimension: FREEZE_SCOPE_DIMENSION.DATE,
      value: context.date,
      matches: () => context.date === match.date,
    });
  }
  if (match.fromDate !== null || match.toDate !== null) {
    checks.push({
      dimension: FREEZE_SCOPE_DIMENSION.DATE_RANGE,
      value: context.date,
      matches: () => {
        const date = /** @type {string} */ (context.date);
        return (
          (match.fromDate === null || date >= match.fromDate) &&
          (match.toDate === null || date <= match.toDate)
        );
      },
    });
  }

  for (const check of checks) {
    dimensionsTested += 1;
    if (check.value === undefined || check.value === null) {
      return {
        matches: false,
        judged: false,
        unjudgedDimension: check.dimension,
        dimensionsTested,
        labelMatched,
      };
    }
    if (!check.matches()) {
      return {
        matches: false,
        judged: true,
        unjudgedDimension: null,
        dimensionsTested,
        labelMatched,
      };
    }
  }

  // Division last, so `labelMatched` is only reported for a match that survived
  // every other dimension — GAP-24's caveat belongs on a rule that actually
  // reached a game, not on one that was about to fail on a venue anyway.
  if (match.divisionLabel !== null) {
    dimensionsTested += 1;
    if (context.divisionLabel === undefined || context.divisionLabel === null) {
      return {
        matches: false,
        judged: false,
        unjudgedDimension: FREEZE_SCOPE_DIMENSION.DIVISION,
        dimensionsTested,
        labelMatched,
      };
    }
    if (context.divisionLabel !== match.divisionLabel) {
      return {
        matches: false,
        judged: true,
        unjudgedDimension: null,
        dimensionsTested,
        labelMatched,
      };
    }
    labelMatched = true;
  }

  return { matches: true, judged: true, unjudgedDimension: null, dimensionsTested, labelMatched };
}
