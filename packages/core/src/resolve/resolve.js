/**
 * The two entry points: **apply a change request**, and — explicitly, by name,
 * with an acknowledgement — **re-optimise the whole season**.
 *
 * ## Maximum freeze is what you get by not asking for anything else
 *
 * `applyChangeRequest()` with no `freeze` argument builds
 * `freezeForChanges(changes)`: a plan that thaws exactly the games the request
 * names and freezes every other game in the season. "A change request touches
 * only what it must" is therefore not a policy the solver tries to honour — it
 * is the shape of the only plan it was handed.
 *
 * `freeze: null` is a **TypeError**, not "no freeze". A caller who means "let
 * everything move" has to say `reoptimiseWholeSeason()`, spell out a reason,
 * and pass the literal `true`; and the plan that comes back is stamped
 * `FREEZE_GLOBAL_REOPTIMISATION` at blocking, so the report can never come back
 * clean. Incident 1 was a global re-solve that produced a valid-looking answer
 * in which 366 of 679 games had silently moved; the point of this module is
 * that the same operation is still available and can no longer be reached by
 * accident or read as routine.
 *
 * @module resolve/resolve
 */

import { FREEZE_DISPOSITION } from '../freeze/reasonCodes.js';
import { buildFreezePlan, freezeForChanges, judgeFreezeAll } from '../freeze/plan.js';
import { getSurface } from '../facility/facilityGraph.js';
import { runRuleEngine } from '../ruleEngine/engine.js';
import { ScheduleSchema } from '../ruleEngine/schemas.js';

import { buildSlotInventory } from './inventory.js';
import {
  RESOLVE_REASON,
  createResolveMeta,
  deriveResolveStatus,
  makeResolveFinding,
  mergeResolveMeta,
} from './reasonCodes.js';
import { ScheduleChangeRequestSchema } from './schemas.js';
import { buildResolvePipeline } from './stages.js';
import {
  createResolveLedger,
  createResolveState,
  diffAgainstBaseline,
  pinGames,
  slotKey,
} from './state.js';

/** The stage after which `holdChanges` pins what the request just moved. */
const CHANGE_STAGE_ID = 'change-request-apply';

/**
 * Everything the re-solver needs from Phases 1-3, checked once.
 *
 * @param {Object} engines
 * @returns {Object}
 */
function requireEngines(engines) {
  const { graph, table, calendar, registry } = engines ?? {};
  if (!graph || !table || !calendar || !registry) {
    throw new Error(
      'resolve: needs { graph, table, calendar, registry } — the Phase 1.1 facility graph, the Phase 1.2 format timing table, the Phase 1.3 availability calendar and the Phase 2.1 constraint registry'
    );
  }
  return engines;
}

/**
 * Where one game stands, for the freeze plan to judge it against.
 *
 * @param {import('../facility/types.js').FacilityGraph} graph
 * @param {import('./types.js').PlacedGame} game
 * @returns {import('../freeze/types.js').FreezeContext}
 */
function freezeContextOf(graph, game) {
  const surface = getSurface(graph, game.surfaceId);
  return {
    gameId: game.id,
    date: game.date,
    divisionLabel: game.divisionLabel,
    venueId: game.venueId,
    surfaceId: game.surfaceId,
    // Lineage, so freezing "Pitch 1" freezes the games standing on 1A and 1B.
    surfaceLineage: surface ? [...surface.lineage] : [game.surfaceId],
    format: game.format,
    teamIds: [game.homeTeamId, game.awayTeamId].filter(
      (id) => typeof id === 'string' && id.length > 0
    ),
  };
}

/**
 * The schedule a state currently describes.
 *
 * The universes are carried through from the baseline rather than re-derived
 * from the games: a universe derived from the rows it is meant to police cannot
 * police them, which is the lesson `ruleEngine/schemas.js` already records.
 *
 * @param {import('../ruleEngine/types.js').Schedule} baseSchedule
 * @param {import('./types.js').ResolveState} state
 * @returns {import('../ruleEngine/types.js').Schedule}
 */
export function resolvedScheduleOf(baseSchedule, state) {
  const games = state.gameIds
    .filter((gameId) => state.games[gameId] !== undefined)
    .map((gameId) => ({ ...state.games[gameId] }));
  return /** @type {import('../ruleEngine/types.js').Schedule} */ ({ ...baseSchedule, games });
}

/**
 * A snapshot of where everything stands, for the audit to diff.
 *
 * @param {import('./types.js').ResolveState} state
 * @returns {Record<string, string>}
 */
function placementSnapshot(state) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const gameId of state.gameIds) {
    const game = state.games[gameId];
    out[gameId] = game === undefined ? '' : `${game.date}|${game.surfaceId}|${game.startMinutes}`;
  }
  return out;
}

/**
 * The shared driver. Not exported: the two named entry points below are the
 * only ways in, which is what makes "exactly one export can produce a thawed
 * default" a statement about the module rather than about discipline.
 *
 * @param {Object} input
 * @returns {import('./types.js').ResolveRun}
 */
function runResolve(input) {
  const engines = requireEngines(input.engines);
  const baseSchedule = /** @type {import('../ruleEngine/types.js').Schedule} */ (
    ScheduleSchema.parse(input.schedule)
  );
  const changes = (input.changes ?? []).map((change) => ScheduleChangeRequestSchema.parse(change));
  const plan = input.plan;

  const changedIds = changes.map((change) => change.gameId);
  if (new Set(changedIds).size !== changedIds.length) {
    // Two changes for one game are two answers to "where does it go", and the
    // later one would silently win. There is no reading of that a caller meant.
    throw new Error(
      'resolve: the change request names the same game more than once; a game has one destination, and picking the last one silently is not a decision this module gets to make'
    );
  }

  if (baseSchedule.games.length === 0) {
    throw new Error(
      'resolve: the schedule holds no games, so every verdict this run could produce would be true of nothing (incident 4)'
    );
  }
  const games = baseSchedule.games.map((game) => ({ ...game }));
  const judgements = judgeFreezeAll(
    plan,
    games.map((game) => freezeContextOf(engines.graph, game))
  );
  /** @type {Record<string, string>} */
  const dispositions = {};
  for (const [gameId, judgement] of Object.entries(judgements.byGameId)) {
    dispositions[gameId] = judgement.disposition;
  }

  // Surfaces a change request names that no baseline row ever stood on. They
  // enter the *venue lookup* only, never the placer's candidate surfaces, so a
  // relocated game carries the venue it is actually standing at.
  /** @type {Record<string, string>} */
  const surfaceVenues = {};
  for (const change of changes) {
    if (change.surfaceId === null) continue;
    const surface = getSurface(engines.graph, change.surfaceId);
    if (surface) surfaceVenues[change.surfaceId] = surface.venueId;
  }

  const inventory = buildSlotInventory(games, { surfaceVenues });
  /** @type {Record<string, string[]>} */
  const admittedSlotsByGameId = {};
  const ledger = createResolveLedger();
  for (const change of changes) {
    const game = games.find((candidate) => candidate.id === change.gameId);
    if (!game) continue;
    const slot = {
      date: change.date ?? game.date,
      surfaceId: change.surfaceId ?? game.surfaceId,
      startMinutes: change.startMinutes,
    };
    admittedSlotsByGameId[change.gameId] = [
      ...(admittedSlotsByGameId[change.gameId] ?? []),
      slotKey(slot),
    ];
    const venueId = inventory.venueBySurfaceId[slot.surfaceId];
    const known =
      inventory.dates.includes(slot.date) &&
      venueId !== undefined &&
      (inventory.kickoffsByDateVenue[`${slot.date}|${venueId}`] ?? []).includes(slot.startMinutes);
    if (known) continue;
    ledger.findings.push(
      makeResolveFinding(
        RESOLVE_REASON.RESOLVE_CHANGE_SLOT_OUTSIDE_INVENTORY,
        `the change request puts game "${change.gameId}" on ${slotKey(slot)}, a slot the baseline schedule never used; it is admitted for this game only, because an externally-published fixture brings its own time and the club does not get to invent one for it`,
        { gameId: change.gameId, slot: slotKey(slot) }
      )
    );
  }

  let state = createResolveState({ games, dispositions, admittedSlotsByGameId, inventory, ledger });

  const touchedDates = input.dislodgeAll
    ? [...inventory.dates]
    : [
        ...new Set(
          changes.flatMap((change) => {
            const game = state.baseline[change.gameId];
            return game ? [game.date, change.date ?? game.date] : [];
          })
        ),
      ].sort();

  /** @type {Object} */
  const context = {
    engines,
    changes,
    plan,
    judgements,
    order: input.order,
    dislodgeAll: input.dislodgeAll === true,
    onUnsatisfiable: input.onUnsatisfiable ?? 'throw',
    touchedDates,
    baselineBlockingCodes: {},
    anchors: {},
    requestedSlots: {},
    unsatisfiableErrors: [],
    /**
     * What the rule engine already said about the schedule **before** this run
     * touched it.
     *
     * Derived here when the caller does not supply it, rather than defaulting
     * to "the baseline had no violations". The published season-2026 schedule
     * carries 62 accepted exceptions, and treating that as a clean baseline
     * makes the `verify` stage report all of them as newly introduced — a
     * change request blamed for four `Scrimmage` rows with no timing entry and
     * 36 Minis sessions on unlined ground. That is the same mistake
     * `newBlockingCodes()` exists to prevent on the facility side, and it is
     * not the caller's job to remember it.
     */
    baselineVerification: null,
    verificationCache: new Map(),
    stageSnapshots: [],
    baselineSnapshot: placementSnapshot(state),
    /**
     * The rule-engine run, computed at most once per distinct state.
     *
     * @param {import('./types.js').ResolveState} current
     * @returns {Object|null}
     */
    runVerification(current) {
      if (input.verify === false) return null;
      const key = current.ledger.moves.length;
      const cached = context.verificationCache.get(key);
      if (cached !== undefined) return cached;
      const result = runRuleEngine(resolvedScheduleOf(baseSchedule, current), {
        registry: engines.registry,
        ledger: engines.waiverLedger ?? null,
        resources: engines.resources ?? {},
        engine: engines.ruleEngine,
      });
      context.verificationCache.set(key, result);
      return result;
    },
  };

  // At this point no move has been applied, so the cache key (`0`) is the
  // baseline's own and a run that moves nothing correctly reuses it.
  context.baselineVerification = input.baselineVerification ?? context.runVerification(state);

  const pipeline = buildResolvePipeline(input.extraStages ?? []);
  ledger.meta.stagesRegistered = pipeline.length;

  for (const stage of pipeline) {
    const next = stage.run(state, context);
    if (!next || typeof next !== 'object' || !Array.isArray(next.gameIds)) {
      throw new Error(`resolve: stage "${stage.id}" did not return a state`);
    }
    state = next;
    ledger.meta.stagesRun += 1;
    context.stageSnapshots.push({
      stageId: stage.id,
      title: stage.title,
      declaredMutationKinds: [...stage.freezeContract.mutationKinds],
      placements: placementSnapshot(state),
      ledgerLength: ledger.moves.length,
    });

    if (stage.id === CHANGE_STAGE_ID && input.holdChanges === true) {
      // "These times are not mine to move." The right setting for an
      // externally-published fixture: the request states a fact, and a slot the
      // fact cannot occupy is a contradiction to raise, not a request to
      // quietly reinterpret.
      const moved = ledger.moves
        .filter((move) => move.stageId === CHANGE_STAGE_ID)
        .map((move) => move.gameId);
      state = pinGames(state, moved, 'held at the slot the change request named (holdChanges)');
    }
  }

  if (ledger.meta.movesConsidered === 0) {
    ledger.findings.push(
      makeResolveFinding(
        RESOLVE_REASON.RESOLVE_NOTHING_CONSIDERED,
        'this run never asked the freeze a single question, so its "no frozen game moved" verdict is true of nothing it did',
        { stagesRun: ledger.meta.stagesRun }
      )
    );
  }

  const findings = [...judgements.findings, ...ledger.findings];
  const meta = mergeResolveMeta(createResolveMeta(), ledger.meta);
  meta.freezeJudgements = Math.max(meta.freezeJudgements, judgements.meta.gamesJudged);
  // How many distinct (date, surface, kickoff) slots the baseline ever used —
  // the whole of what this package is allowed to offer anybody.
  meta.slotsAvailable = inventory.slotCount;

  /** @type {import('./types.js').StageResult[]} */
  const stages = pipeline.map((stage) => {
    const counters = ledger.byStage[stage.id] ?? { considered: 0, rejected: 0, applied: 0 };
    return {
      stageId: stage.id,
      title: stage.title,
      declaredMutationKinds: [...stage.freezeContract.mutationKinds],
      claim: stage.freezeContract.claim,
      movesConsidered: counters.considered,
      movesRejectedByFreeze: counters.rejected,
      movesApplied: counters.applied,
      findingsEmitted: findings.filter((finding) => finding.details.stageId === stage.id).length,
    };
  });

  return {
    name: input.name,
    schedule: resolvedScheduleOf(baseSchedule, state),
    baselineSchedule: baseSchedule,
    freeze: plan,
    judgements,
    state,
    moved: diffAgainstBaseline(state),
    unplaced: [...state.unplaced],
    moves: [...ledger.moves],
    stages,
    unsatisfiable: [...context.unsatisfiableErrors],
    verification: context.verificationCache.get(ledger.moves.length) ?? null,
    findings,
    status: deriveResolveStatus(findings),
    meta,
  };
}

/**
 * Apply a change request to a published schedule, holding everything the plan
 * does not thaw.
 *
 * @param {import('./types.js').ResolveInput} input
 * @returns {import('./types.js').ResolveRun}
 */
export function applyChangeRequest(input) {
  if (input.freeze === null) {
    throw new TypeError(
      'resolve: `freeze: null` is not "no freeze" — it is a missing argument. Omit it for maximum freeze (every game held except the ones the request names), or call reoptimiseWholeSeason() and say why.'
    );
  }
  const changes = input.changes ?? [];
  if (changes.length === 0) {
    throw new Error(
      'resolve: applyChangeRequest() was given no changes; a change request that asks for nothing has nothing to freeze around, and reporting "no frozen game moved" over it would be vacuous (incident 4)'
    );
  }
  const plan = input.freeze ?? freezeForChanges(changes);
  if (plan.defaultDisposition === FREEZE_DISPOSITION.THAWED) {
    throw new Error(
      'resolve: applyChangeRequest() was handed a plan that thaws every game by default. A global re-solve is a different, named operation: call reoptimiseWholeSeason().'
    );
  }
  return runResolve({
    ...input,
    name: input.name ?? 'change request',
    plan,
    changes,
    order: 'baseline-first',
    dislodgeAll: false,
  });
}

/**
 * Re-optimise the whole season. **The named, rare, loud operation.**
 *
 * This is the only function in the package that can produce a plan whose
 * default is `thawed`, and everything about the way it is reached is
 * deliberate: the name says what it does, `reason` must say why, `acknowledged`
 * must be the literal `true`, the plan it builds carries
 * `FREEZE_GLOBAL_REOPTIMISATION` at **blocking**, and the ordering it hands the
 * placer is earliest-legal-first rather than nearest-to-where-it-was.
 *
 * The last of those is the one that matters. Under the hold rule a legal game
 * is never moved, so a "global re-optimisation" that kept the hold rule would
 * move nothing and prove nothing. This one genuinely re-solves the season the
 * way incident 1's solver did — which is what makes the number of games it
 * moves a measurement rather than a claim.
 *
 * @param {import('./types.js').ResolveInput} input - `reason` and `acknowledged` are required
 * @returns {import('./types.js').ResolveRun}
 */
export function reoptimiseWholeSeason(input) {
  const plan = buildFreezePlan({
    name: 'global re-optimisation',
    defaultDisposition: FREEZE_DISPOSITION.THAWED,
    rules: input.holdScopes ?? [],
    globalReoptimisation: {
      reason: /** @type {string} */ (input.reason),
      acknowledged: /** @type {true} */ (input.acknowledged),
      requestedBy: input.requestedBy ?? null,
    },
  });
  return runResolve({
    ...input,
    name: input.name ?? 'global re-optimisation',
    plan,
    changes: input.changes ?? [],
    order: 'earliest-first',
    dislodgeAll: true,
  });
}
