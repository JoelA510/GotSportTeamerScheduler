/**
 * Unplaced fixtures as first-class state — incident 10.
 *
 * > *"A game that must exist but has no legal slot. In one variant a fixture
 * > genuinely could not be placed; it must remain VISIBLE, be counted in
 * > totals, and export with explicit TIME TBD / LOCATION TBD plus the reason. It
 * > must never be silently dropped — that's how a team loses a game."*
 *
 * The three verbs get three functions:
 *
 * | verb | function |
 * | --- | --- |
 * | *visible* | {@link makeUnplacedFixture} — a record with an id, a label, both TBD tokens and a reason, rather than a transient return value |
 * | *counted* | {@link accountForFixtures} — reconciles what must exist against what a run produced, and reports anything in neither list at `blocking` |
 * | *exported* | `publication.js` — rows carrying `TIME TBD` / `LOCATION TBD` and the reason |
 *
 * ## What this file does **not** re-derive
 *
 * It does not decide that a fixture is unplaceable, and it does not compute the
 * reason. Both already exist: `resolve/stages.js` carries a thawed game with no
 * legal slot as TIME TBD with a reason, and `placement/replaceGames.js` does the
 * same for its bounded harness. The two adapters here read those results; a
 * third opinion about why a game cannot be placed would be free to disagree with
 * the one the solver acted on. Where the *machine-readable* half of that reason
 * lives, and why it is sometimes legitimately absent, is on
 * {@link unplacedFromResolveRun}.
 *
 * ## The one thing it insists on
 *
 * {@link accountForFixtures} takes `expectedFixtureIds` as an argument and will
 * not derive them from the run. A fixture the run dropped is exactly the record
 * that is missing from the run's own output, so a check that enumerated its
 * subjects from there would report a clean season — the shape that let a team
 * play zero of nine games and be silently absent rather than reported.
 *
 * @module reserve/unplaced
 */

import {
  PUBLICATION_TBD,
  RESERVE_REASON,
  createReserveMeta,
  deriveReserveStatus,
  makeReserveFinding,
} from './reasonCodes.js';
import { UnplacedFixtureSchema } from './schemas.js';

/**
 * Parse and freeze one unplaced fixture, stamping both TBD tokens.
 *
 * `timeStatus` and `locationStatus` are not inputs. They are what an unplaced
 * fixture *is*, and letting a caller supply them would allow one that quietly
 * says something else.
 *
 * @param {Object} input - see `UnplacedFixtureSchema`
 * @returns {import('./types.js').UnplacedFixture}
 */
export function makeUnplacedFixture(input) {
  const parsed = UnplacedFixtureSchema.parse(input);
  return Object.freeze(
    /** @type {import('./types.js').UnplacedFixture} */ ({
      ...parsed,
      timeStatus: PUBLICATION_TBD.TIME,
      locationStatus: PUBLICATION_TBD.LOCATION,
    })
  );
}

/**
 * A label for a fixture, from whatever the source knows about it.
 *
 * @param {{ homeLabel?: string|null, awayLabel?: string|null, homeTeamId?: string|null, awayTeamId?: string|null }} game
 * @param {string} fallback
 * @returns {string}
 */
function labelFor(game, fallback) {
  const home = game.homeLabel || game.homeTeamId;
  const away = game.awayLabel || game.awayTeamId;
  if (home && away) return `${home} v ${away}`;
  if (home) return String(home);
  return fallback;
}

/**
 * The reason codes a `resolve/` cause carries.
 *
 * `ConsequentialChange.codes` is a **string**, built by `constraintCause()` in
 * `resolve/stages.js` as `[...codes].sort().join(', ')`. Splitting it back is the
 * exact inverse of that join and not a message parse: a reason code in this
 * repository is a `SCREAMING_SNAKE_CASE` identifier and can never contain the
 * separator. An array is accepted too, so this keeps working if that field ever
 * becomes one.
 *
 * **Read this honestly**: the string branch is the one a *constraint-caused*
 * TIME TBD would take — a game dislodged by a named clash that then finds no
 * slot — and the season-2026 corpus produces none. Its four TIME TBD fixtures
 * come out of a global re-optimisation, whose cause is `global-reoptimisation`
 * with no codes at all, so `causeKind` carries the answer and `reasonCodes` is
 * legitimately empty. This branch is therefore reviewed rather than exercised
 * against the corpus, and the record says which of the two happened rather than
 * leaving a reader to guess from an empty list.
 *
 * @param {unknown} codes
 * @returns {string[]}
 */
function reasonCodesOf(codes) {
  if (Array.isArray(codes)) return codes.map(String).filter(Boolean);
  if (typeof codes !== 'string' || codes.length === 0) return [];
  return codes
    .split(/,\s*/)
    .map((code) => code.trim())
    .filter(Boolean);
}

/**
 * Turn a `resolve/` run's TIME TBD entries into unplaced-fixture records.
 *
 * The reason comes from the run; the cause fields — which reason codes, which
 * registry constraints, which counterpart games, which binding edge and how many
 * minutes short — come from the run's own report, which assembled them from
 * `checkPlacement()` and the Phase 2.1 registry. Nothing is recomputed here.
 *
 * **Where the cause is read from matters.** `resolve/stages.js` gives the
 * TIME TBD move itself no cause on purpose — *"a game reaching TIME TBD was
 * lifted out by an earlier move that already named what forced it, and this one
 * is the consequence rather than the reason"* — so this function follows that
 * comment to its source and takes the last cause-bearing entry for the game from
 * the run's **move ledger**, falling back to the report's own entry. A fixture
 * unplaced because it was *asked* to go somewhere impossible has no earlier
 * move and therefore no codes; the full sentence is in `reason`, which is the
 * run's honest position rather than a gap papered over here.
 *
 * @param {Object} run - a `ResolveRun` or `CommittedResolve`
 * @param {{ source?: string }} [options]
 * @returns {import('./types.js').UnplacedFixture[]}
 */
export function unplacedFromResolveRun(run, options = {}) {
  const entries = run?.unplaced ?? [];
  const baseline = run?.state?.baseline ?? {};
  /** @type {Map<string, Object>} */
  const causes = new Map();
  for (const change of run?.report?.consequential ?? []) causes.set(change.gameId, change);
  for (const change of run?.report?.requested ?? []) {
    if (change.outcome === 'unplaced' && !causes.has(change.gameId))
      causes.set(change.gameId, change);
  }

  /** The last move for each game that named a machine-readable cause. */
  /** @type {Map<string, Record<string, unknown>>} */
  const ledgerCauses = new Map();
  for (const move of run?.moves ?? []) {
    if (move.cause) ledgerCauses.set(move.gameId, move.cause);
  }

  return entries
    .map((entry) => {
      const game = baseline[entry.gameId] ?? {};
      const cause = {
        ...(causes.get(entry.gameId) ?? {}),
        ...(ledgerCauses.get(entry.gameId) ?? {}),
      };
      return makeUnplacedFixture({
        fixtureId: entry.gameId,
        label: cause.label || labelFor(game, entry.gameId),
        date: game.date ?? null,
        format: game.format ?? null,
        divisionLabel: game.divisionLabel ?? null,
        homeTeamId: game.homeTeamId ?? null,
        awayTeamId: game.awayTeamId ?? null,
        homeLabel: game.homeLabel || null,
        awayLabel: game.awayLabel || null,
        reason: entry.reason,
        causeKind: /** @type {string|null} */ (cause.causeKind ?? cause.kind ?? null),
        reasonCodes: reasonCodesOf(cause.codes),
        constraintIds: cause.constraintIds ? [...cause.constraintIds] : [],
        counterpartFixtureIds: cause.counterpartGameIds ? [...cause.counterpartGameIds] : [],
        bindingKinds: cause.bindingKinds ? [...cause.bindingKinds] : [],
        slackMinutes: typeof cause.slackMinutes === 'number' ? cause.slackMinutes : null,
        publishedSurfaceId: game.surfaceId ?? null,
        publishedKickoffMinutes: typeof game.startMinutes === 'number' ? game.startMinutes : null,
        source: options.source ?? run?.name ?? null,
      });
    })
    .sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
}

/**
 * Turn a `placement/` harness run's `unplaced[]` into unplaced-fixture records.
 *
 * @param {Object} run - a `PlacementRun`
 * @param {{ source?: string }} [options]
 * @returns {import('./types.js').UnplacedFixture[]}
 */
export function unplacedFromPlacementRun(run, options = {}) {
  return (run?.unplaced ?? [])
    .map((entry) =>
      makeUnplacedFixture({
        fixtureId: entry.gameId,
        label: entry.label || entry.gameId,
        date: run?.date ?? null,
        format: null,
        reason: entry.reason,
        publishedSurfaceId: entry.publishedSurfaceId ?? null,
        publishedKickoffMinutes: entry.publishedKickoffMinutes ?? null,
        source: options.source ?? run?.registryName ?? null,
      })
    )
    .sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
}

/**
 * Reconcile what must exist against what a run produced.
 *
 * @param {{ expectedFixtureIds: ReadonlyArray<string>, placedFixtureIds: ReadonlyArray<string>, unplaced: ReadonlyArray<import('./types.js').UnplacedFixture>, expectedSource?: string }} input
 * @returns {import('./types.js').FixtureAccounting}
 */
export function accountForFixtures(input) {
  if (!input || !Array.isArray(input.expectedFixtureIds)) {
    throw new Error(
      'reserve: accountForFixtures needs expectedFixtureIds — derived from the roster or the baseline, never from the run, because a dropped fixture is exactly what is missing from the run'
    );
  }
  const meta = createReserveMeta();
  /** @type {import('./types.js').ReserveFinding[]} */
  const findings = [];

  const expected = [...new Set(input.expectedFixtureIds.map(String))].sort();
  const placed = new Set(input.placedFixtureIds.map(String));
  /** @type {Map<string, import('./types.js').UnplacedFixture>} */
  const unplacedById = new Map(input.unplaced.map((fixture) => [fixture.fixtureId, fixture]));

  /** @type {string[]} */
  const missing = [];
  for (const fixtureId of expected) {
    meta.fixturesAccountedFor += 1;
    const isPlaced = placed.has(fixtureId);
    const isUnplaced = unplacedById.has(fixtureId);
    if (isPlaced && isUnplaced) {
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.FIXTURE_DOUBLE_COUNTED,
          `fixture "${fixtureId}" is reported both placed and unplaced, so the totals cannot both be right`,
          { fixtureId }
        )
      );
      continue;
    }
    if (isPlaced || isUnplaced) continue;
    missing.push(fixtureId);
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.FIXTURE_DROPPED,
        `fixture "${fixtureId}" must exist and this run neither placed it nor reported it unplaced; a fixture that disappears is how a team loses a game`,
        { fixtureId, expectedSource: input.expectedSource ?? null }
      )
    );
  }

  for (const fixture of input.unplaced) {
    meta.fixturesTimeTbd += 1;
    if (!fixture.reason || fixture.reason.trim() === '') {
      findings.push(
        makeReserveFinding(
          RESERVE_REASON.FIXTURE_REASON_MISSING,
          `fixture "${fixture.fixtureId}" is carried unplaced with no reason; a category label is what made somebody derive the real one by hand`,
          { fixtureId: fixture.fixtureId }
        )
      );
      continue;
    }
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.FIXTURE_TIME_TBD,
        `fixture "${fixture.fixtureId}" (${fixture.label}) is carried as ${fixture.timeStatus} / ${fixture.locationStatus}: ${fixture.reason}`,
        {
          fixtureId: fixture.fixtureId,
          label: fixture.label,
          date: fixture.date,
          causeKind: fixture.causeKind,
          format: fixture.format,
          divisionLabel: fixture.divisionLabel,
          reasonCodes: [...fixture.reasonCodes],
          constraintIds: [...fixture.constraintIds],
          counterpartFixtureIds: [...fixture.counterpartFixtureIds],
          bindingKinds: [...fixture.bindingKinds],
          slackMinutes: fixture.slackMinutes,
          publishedSurfaceId: fixture.publishedSurfaceId,
          publishedKickoffMinutes: fixture.publishedKickoffMinutes,
          source: fixture.source,
        }
      )
    );
  }

  if (meta.fixturesAccountedFor === 0) {
    findings.push(
      makeReserveFinding(
        RESERVE_REASON.FIXTURE_ACCOUNTING_VACUOUS,
        'the fixture accounting reconciled zero fixtures, so "nothing was dropped" is a statement about an empty set',
        { expected: expected.length, placed: placed.size, unplaced: unplacedById.size }
      )
    );
  }

  const placedExpected = expected.filter((id) => placed.has(id));
  const unplacedExpected = expected.filter((id) => unplacedById.has(id));

  return {
    totals: {
      expected: expected.length,
      placed: placedExpected.length,
      unplaced: unplacedExpected.length,
      accounted: placedExpected.length + unplacedExpected.length,
      missing: missing.length,
    },
    placedFixtureIds: placedExpected,
    unplacedFixtureIds: unplacedExpected,
    missingFixtureIds: missing,
    findings,
    status: deriveReserveStatus(findings),
    meta,
  };
}
