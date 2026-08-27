/**
 * **Deriving a branch, and promoting one.**
 *
 * A {@link import('./types.js').ScenarioResult} is *lazily evaluated with a
 * fingerprinted memo*, and everything about that phrase is deliberate:
 *
 * - **Not a stored schedule.** That is the source project's failure verbatim —
 *   five hand-built duplicates of the whole pipeline, separately verified,
 *   impossible to keep in sync.
 * - **Not a stored diff.** A diff is only meaningful against the baseline it
 *   was computed from, so a constraint fixed in the baseline leaves every
 *   stored diff describing a schedule that no longer exists. A stored diff also
 *   cannot answer *"which constraints break"*, because breakage is a property
 *   of the result rather than of the edit.
 * - **A fingerprinted memo**, so re-deriving is cheap and a stale read is
 *   refused rather than served. The fingerprint is a structural digest over the
 *   base record arrays plus the override list — never over scenario metadata.
 *
 * ## The four steps, and which machinery each one is
 *
 * | step | machinery |
 * | --- | --- |
 * | which games the branch displaces | `runRuleEngine()` twice, and the difference |
 * | where they could go instead | `proposeRelocations()` — **proposed, not solved** |
 * | applying that | `applyChangeRequest()`, maximum freeze around the displaced set |
 * | what has nowhere to go | `createResolveState()` + `applyMove(TIME_TBD)` + `unplacedFromResolveRun()` |
 *
 * The last row is the interesting one. The shelving is a **second, explicit
 * step after the re-solve**, not something the pipeline did, and it goes
 * through `applyMove()` — the one writer — so the games it shelves are
 * ledgered, judged against a freeze, and projected back into a schedule by
 * `resolvedScheduleOf()`, commitments and all. Doing it in the scenario layer
 * rather than inside the run is what keeps the report honest: the solver did
 * not decide these games were unplaceable, the branch did.
 *
 * @module scenario/run
 */

import { FREEZE_DISPOSITION } from '../freeze/reasonCodes.js';
import { freezeAllExcept } from '../freeze/plan.js';
import { runRuleEngine } from '../ruleEngine/engine.js';
import { registryConstraintIdsFor } from '../resolve/errors.js';
import { resolveObjectiveWeights } from '../resolve/objective.js';
import { applyChangeRequest, resolvedScheduleOf } from '../resolve/resolve.js';
import { buildSlotInventory } from '../resolve/inventory.js';
import {
  MOVE_KIND,
  applyMove,
  createResolveLedger,
  createResolveState,
  mayMove,
} from '../resolve/state.js';
import { CONSTRAINT_SEVERITY } from '../constraints/reasonCodes.js';
import { accountForFixtures, unplacedFromResolveRun } from '../reserve/unplaced.js';
import { makePublicationSnapshot } from '../publication/snapshot.js';
import { naiveDateTime } from '../reserve/publication.js';
import { PUBLICATION_TBD } from '../reserve/reasonCodes.js';

import { diffScenarios } from './diff.js';
import { withRecords } from './inputs.js';
import { proposeRelocations } from './relocation.js';
import {
  SCENARIO_REASON,
  createScenarioMeta,
  deriveScenarioStatus,
  makeScenarioFinding,
  mergeScenarioMeta,
} from './reasonCodes.js';
import { materialiseScenario } from './scenario.js';

/** The stage id the shelving step signs its writes with. */
export const SCENARIO_SHELVE_STAGE_ID = 'scenario-shelve-unplaceable';

/** How many example ids an aggregate finding carries. */
const EXAMPLE_LIMIT = 5;

/** The column vocabulary the recorded diff is snapshotted in. */
export const PROMOTION_DIFF_COLUMNS = Object.freeze([
  'bucket',
  'gameId',
  'label',
  'changedFields',
  'before',
  'after',
]);

/**
 * One diff row, in the promotion snapshot's vocabulary.
 *
 * Times go through `naiveDateTime()` — `reserve/publication.js`'s, the only
 * GAP-30-safe formatter in this repository — so a promoted record cannot carry
 * a wall-clock time reinterpreted in the host timezone.
 *
 * @param {import('../resolve/types.js').ScheduleChange} change
 * @returns {Record<string, string>}
 */
function diffRow(change) {
  const at = (slot) =>
    slot === null
      ? `${PUBLICATION_TBD.TIME} / ${PUBLICATION_TBD.LOCATION}`
      : `${naiveDateTime(slot.date, slot.startMinutes, PUBLICATION_TBD.TIME)} ${slot.surfaceId}`;
  return {
    gameId: change.gameId,
    label: change.label,
    changedFields: change.changedFields.join(', '),
    before: at(change.before),
    after: at(change.after),
  };
}

/**
 * The game a rule violation is about, or null.
 *
 * Read from the violation's own `entities`, which every rule fills in from the
 * row it examined. Not parsed out of `subjectId`, which is a rule-scoped key
 * whose spelling is the rule's business.
 *
 * @param {Object} violation
 * @returns {string|null}
 */
function gameIdOf(violation) {
  for (const entity of violation.entities ?? []) {
    if (entity.kind === 'game') return String(entity.id);
  }
  return null;
}

/**
 * Blocking violations by `${code}|${gameId}`, counted.
 *
 * @param {Object|null} verification
 * @returns {Map<string, number>}
 */
function blockingByGame(verification) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const violation of verification?.violations ?? []) {
    if (violation.severity !== CONSTRAINT_SEVERITY.BLOCKING) continue;
    const gameId = gameIdOf(violation);
    if (gameId === null) continue;
    const key = `${violation.code}|${gameId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * **Which games the branch displaces**, and which codes it introduced for each.
 *
 * Derived from two `runRuleEngine()` passes — the baseline's engines and the
 * branch's — and from the difference between them. Deliberately *not* from a
 * third opinion about legality: the rule engine is what the rest of the system
 * is judged by, and a scenario that used a private definition of "displaced"
 * could report a game as displaced that every other report calls fine.
 *
 * **Counts, not presence**, exactly as `newBlockingCodes()` in
 * `resolve/stages.js`: a game already breaking a code once and breaking it
 * twice under the branch has the same code *set* in both places.
 *
 * @param {Object} input
 * @param {import('../ruleEngine/types.js').Schedule} input.schedule
 * @param {Object} input.baselineVerification
 * @param {Object} input.scenarioVerification
 * @param {Object} input.registry - the branch's, for the constraint ids
 * @returns {import('./types.js').DisplacedGame[]}
 */
export function scenarioDisplacements(input) {
  const before = blockingByGame(input.baselineVerification);
  const after = blockingByGame(input.scenarioVerification);
  /** @type {Map<string, string[]>} */
  const grown = new Map();
  for (const [key, count] of after) {
    if (count <= (before.get(key) ?? 0)) continue;
    const separator = key.indexOf('|');
    const code = key.slice(0, separator);
    const gameId = key.slice(separator + 1);
    const bucket = grown.get(gameId) ?? [];
    bucket.push(code);
    grown.set(gameId, bucket);
  }

  const byId = new Map(input.schedule.games.map((game) => [String(game.id), game]));
  /** @type {import('./types.js').DisplacedGame[]} */
  const displaced = [];
  for (const [gameId, codes] of grown) {
    const game = byId.get(gameId);
    if (!game) continue;
    const sorted = [...new Set(codes)].sort();
    displaced.push({
      gameId,
      label: `${game.homeLabel} v ${game.awayLabel}`,
      date: game.date,
      venueId: game.venueId,
      surfaceId: game.surfaceId,
      startMinutes: game.startMinutes,
      format: game.format,
      codes: Object.freeze(sorted),
      constraintIds: Object.freeze(registryConstraintIdsFor(input.registry, sorted)),
    });
  }
  displaced.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinutes - b.startMinutes ||
      a.gameId.localeCompare(b.gameId)
  );
  return displaced;
}

/**
 * Shelve the games the branch leaves nowhere to go, through the one writer.
 *
 * Builds a real `ResolveState` over the schedule as it stands, freezes every
 * game the caller did **not** name — so `mayMove()` refuses anything else, and
 * a mistake here is a refusal rather than a silent extra shelving — and moves
 * each named game to TIME TBD with the cause the branch computed.
 *
 * @param {import('../ruleEngine/types.js').Schedule} schedule
 * @param {ReadonlyArray<import('./types.js').UnrelocatableGame>} entries
 * @param {{ name: string, registry: Object }} context
 * @returns {{ schedule: import('../ruleEngine/types.js').Schedule, run: Object, shelved: string[] }}
 */
export function shelveUnrelocatable(schedule, entries, context) {
  const named = new Set(entries.map((entry) => entry.gameId));
  /** @type {Record<string, string>} */
  const dispositions = {};
  for (const game of schedule.games) {
    dispositions[String(game.id)] = named.has(String(game.id))
      ? FREEZE_DISPOSITION.THAWED
      : FREEZE_DISPOSITION.FROZEN;
  }

  const ledger = createResolveLedger();
  let state = createResolveState({
    games: schedule.games,
    dispositions,
    inventory: buildSlotInventory(schedule.games),
    ledger,
  });

  /** @type {string[]} */
  const shelved = [];
  for (const entry of entries) {
    if (!state.games[entry.gameId]) continue;
    if (
      !mayMove(state, entry.gameId, SCENARIO_SHELVE_STAGE_ID, 'the branch leaves it nowhere to go')
    ) {
      continue;
    }
    state = applyMove(
      state,
      {
        gameId: entry.gameId,
        kind: MOVE_KIND.TIME_TBD,
        to: null,
        reason: entry.reason,
        // The cause is the **branch's own**, first hand: the blocking codes the
        // override introduced for this game and the registry constraints that
        // claim them. `unplacedFromResolveRun()` reads it from the ledger, which
        // is exactly where its own header says to look.
        cause: Object.freeze({
          kind: 'constraint',
          codes: [...entry.codes].sort().join(', '),
          constraintId: entry.constraintIds[0] ?? null,
          constraintIds: Object.freeze([...entry.constraintIds]),
          counterpartGameIds: Object.freeze([]),
          bindingKinds: Object.freeze([]),
          slackMinutes: null,
        }),
      },
      SCENARIO_SHELVE_STAGE_ID
    );
    shelved.push(entry.gameId);
  }

  return {
    schedule: resolvedScheduleOf(schedule, state),
    // The `{ name, state, moves, unplaced }` shape `unplacedFromResolveRun()`
    // reads, produced by the same `createResolveState()` / `applyMove()` writer
    // a resolve run uses. Not a forged state: the one path into TIME TBD in this
    // repository, driven from outside the pipeline.
    run: {
      name: context.name,
      state,
      moves: [...ledger.moves],
      unplaced: [...state.unplaced],
      report: null,
    },
    shelved,
  };
}

/**
 * Derive a scenario's answer.
 *
 * @param {import('./types.js').SeasonInputs} inputs
 * @param {import('./types.js').ScheduleScenario} scenario
 * @param {Object} options
 * @param {Object} options.baselineEngines - the baseline's own engines, for the "what did the branch break" comparison
 * @param {Object|null} [options.baselineVerification] - a `runRuleEngine()` over the baseline; derived when absent
 * @param {Object} options.relocationPolicy - see `RelocationPolicySchema`
 * @param {{ slots: number, label: string, source: string }} options.requirement
 * @param {boolean} [options.relocations] - false runs the negative control
 * @param {ReadonlyArray<import('./types.js').ScheduleScenario>} [options.ancestry]
 * @param {Record<string, number>} [options.objectiveWeights]
 * @returns {import('./types.js').ScenarioResult}
 */
export function runScenario(inputs, scenario, options) {
  const materialised = materialiseScenario(inputs, scenario, { ancestry: options.ancestry });
  const meta = mergeScenarioMeta(createScenarioMeta(), materialised.meta);
  /** @type {import('./types.js').ScenarioFinding[]} */
  const findings = [...materialised.findings];

  const baselineSchedule = inputs.schedule;
  const baselineVerification =
    options.baselineVerification ??
    runRuleEngine(baselineSchedule, {
      registry: options.baselineEngines.registry,
      resources: options.baselineEngines.resources,
    });
  const branchVerification = runRuleEngine(baselineSchedule, {
    registry: materialised.engines.registry,
    resources: materialised.engines.resources,
  });
  meta.gamesExamined = baselineSchedule.games.length;

  const displaced = scenarioDisplacements({
    schedule: baselineSchedule,
    baselineVerification,
    scenarioVerification: branchVerification,
    registry: materialised.engines.registry,
  });
  meta.gamesDisplaced = displaced.length;

  if (displaced.length > 0) {
    const codes = [...new Set(displaced.flatMap((game) => game.codes))].sort();
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_GAME_DISPLACED,
        `the branch leaves ${displaced.length} game(s) standing where its own engines refuse them (${codes.join(', ')}) across ${[...new Set(displaced.map((g) => g.venueId))].sort().join(', ')}`,
        {
          scenarioId: scenario.id,
          displaced: displaced.length,
          codes,
          venueIds: [...new Set(displaced.map((game) => game.venueId))].sort(),
          formats: [...new Set(displaced.map((game) => game.format))].sort(),
          dates: [...new Set(displaced.map((game) => game.date))].sort(),
          exampleGameIds: displaced.slice(0, EXAMPLE_LIMIT).map((game) => game.gameId),
        }
      )
    );
  }

  const displacedIds = new Set(displaced.map((game) => game.gameId));
  const gamesById = Object.fromEntries(
    baselineSchedule.games.map((game) => [String(game.id), game])
  );
  const survivors = baselineSchedule.games.filter((game) => !displacedIds.has(String(game.id)));

  /** @type {import('./types.js').RelocationPlan} */
  let relocations;
  if (options.relocations === false) {
    // **The negative control.** Same branch, same displaced set, no search: every
    // displaced game is carried as TIME TBD naming the code the branch
    // introduced, and no replacement venue appears anywhere in the report. That
    // is what proves the replacements in the positive run came from a search.
    relocations = {
      policy: options.relocationPolicy.policy ?? 'nearest-kickoff',
      surfaceIds: Object.freeze([]),
      proposals: [],
      unrelocatable: displaced.map((game) => ({
        gameId: game.gameId,
        label: game.label,
        reason: `the scenario withdraws the ground it stood on (${game.codes.join(', ')}) and the relocation proposer was switched off for this run; kept visible as TIME TBD rather than dropped (incident 10)`,
        codes: Object.freeze([...game.codes]),
        constraintIds: Object.freeze([...game.constraintIds]),
        candidatesConsidered: 0,
      })),
      capacity: null,
      findings: [
        makeScenarioFinding(
          SCENARIO_REASON.SCENARIO_RELOCATIONS_DISABLED,
          `the relocation proposer was switched off for this run, so all ${displaced.length} displaced game(s) are carried as TIME TBD and no replacement ground is named. This is the negative control for the search, not a lesser answer`,
          { scenarioId: scenario.id, displaced: displaced.length }
        ),
      ],
      status: '',
      meta: createScenarioMeta(),
    };
    relocations.status = deriveScenarioStatus(relocations.findings);
    relocations.meta.relocationsUnavailable = displaced.length;
  } else {
    relocations = proposeRelocations(materialised.engines, {
      displaced,
      survivors,
      gamesById,
      policy: options.relocationPolicy,
      requirement: options.requirement,
    });
  }
  mergeScenarioMeta(meta, relocations.meta);
  findings.push(...relocations.findings);

  /* -- apply the proposals through the re-solver ---------------------------- */

  const changes = relocations.proposals.map((proposal) => ({
    gameId: proposal.gameId,
    date: proposal.to.date,
    surfaceId: proposal.to.surfaceId,
    startMinutes: proposal.to.startMinutes,
    reason: `proposeRelocations() under the "${proposal.policy}" policy: ${proposal.grade} replacement for the withdrawn ground`,
  }));

  const run =
    changes.length === 0
      ? null
      : applyChangeRequest({
          schedule: baselineSchedule,
          changes,
          engines: materialised.engines,
          // Maximum freeze around exactly the displaced set: nothing the branch
          // did not displace may move, so the diff cannot quietly grow.
          freeze: freezeAllExcept(
            displaced.map((game) => ({ gameId: game.gameId })),
            {
              name: `scenario "${scenario.id}"`,
              reason: 'displaced by the branch overrides',
            }
          ),
          // The proposer verified each slot against everything standing on the
          // date. `holdChanges` makes those slots facts rather than preferences,
          // so `local-search` cannot quietly drift a game off a slot the report
          // says it was proposed onto.
          holdChanges: true,
          onUnsatisfiable: 'report',
          objectiveWeights: options.objectiveWeights,
          name: `scenario "${scenario.name}"`,
        });

  const relocated = run === null ? baselineSchedule : run.schedule;
  const shelving = shelveUnrelocatable(relocated, relocations.unrelocatable, {
    name: `scenario "${scenario.name}"`,
    registry: materialised.engines.registry,
  });
  const schedule = shelving.schedule;

  const unplaced = unplacedFromResolveRun(shelving.run, { source: `scenario "${scenario.id}"` });
  const accounting = accountForFixtures({
    // From the **baseline**, never from the result: a fixture the branch dropped
    // is exactly the record missing from the result's own output.
    expectedFixtureIds: baselineSchedule.games.map((game) => String(game.id)),
    placedFixtureIds: schedule.games.map((game) => String(game.id)),
    unplaced,
    expectedSource: inputs.label,
  });

  const verification = runRuleEngine(schedule, {
    registry: materialised.engines.registry,
    resources: materialised.engines.resources,
  });

  /* -- vacuity ------------------------------------------------------------- */

  const nothingMoved =
    displaced.length === 0 &&
    relocations.proposals.length === 0 &&
    unplaced.length === 0 &&
    verification.violations.length === baselineVerification.violations.length;
  if (nothingMoved) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_OVERRIDE_VACUOUS,
        `scenario "${scenario.id}" displaced no game, proposed no relocation and changed no violation count, so every question asked of it is answered by the baseline; an override that models ground the schedule never uses reports "nothing changed" for a reason that has nothing to do with the season`,
        {
          scenarioId: scenario.id,
          overridesDeclared: materialised.meta.overridesDeclared,
          overridesApplied: materialised.meta.overridesApplied,
          violations: verification.violations.length,
        }
      )
    );
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    fingerprint: materialised.fingerprint,
    schedule,
    baselineSchedule,
    materialised,
    displaced,
    relocations,
    run,
    unplaced,
    accounting,
    verification,
    findings,
    status: deriveScenarioStatus(findings),
    meta,
  };
}

/**
 * **The memo.** A lazily-evaluated, fingerprinted cache of scenario results.
 *
 * Nothing is stored on a scenario, and the one thing that *is* cached is
 * checked: a cached run whose fingerprint no longer matches its inputs and
 * overrides is re-derived, and a caller who reads one past the check is told
 * `SCENARIO_RESULT_STALE` at blocking rather than served a schedule that no
 * longer exists.
 */
export class ScenarioMemo {
  constructor() {
    /** @type {Map<string, import('./types.js').ScenarioResult>} */
    this.byScenarioId = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Derive a scenario's result, reusing a cached one only if it is still valid.
   *
   * @param {import('./types.js').SeasonInputs} inputs
   * @param {import('./types.js').ScheduleScenario} scenario
   * @param {Object} options - as {@link runScenario}
   * @returns {import('./types.js').ScenarioResult}
   */
  resolve(inputs, scenario, options) {
    const cached = this.byScenarioId.get(scenario.id);
    if (cached !== undefined && this.check(inputs, scenario, options.ancestry ?? []).length === 0) {
      this.hits += 1;
      return cached;
    }
    this.misses += 1;
    const result = runScenario(inputs, scenario, options);
    this.byScenarioId.set(scenario.id, result);
    return result;
  }

  /**
   * Is the cached result for this scenario still the answer to this question?
   *
   * **Exported behaviour rather than an internal branch**, for the reason
   * `parityPartitionFindings()` is exported: a check nobody can make fail is
   * not a check. A test edits one base record and watches this fire.
   *
   * @param {import('./types.js').SeasonInputs} inputs
   * @param {import('./types.js').ScheduleScenario} scenario
   * @param {ReadonlyArray<import('./types.js').ScheduleScenario>} [ancestry]
   * @returns {import('./types.js').ScenarioFinding[]}
   */
  check(inputs, scenario, ancestry = []) {
    const cached = this.byScenarioId.get(scenario.id);
    if (cached === undefined) return [];
    const current = materialiseScenario(inputs, scenario, { ancestry }).fingerprint;
    if (current === cached.fingerprint) return [];
    return [
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_RESULT_STALE,
        `the cached result for scenario "${scenario.id}" was derived at fingerprint ${cached.fingerprint} and its inputs and overrides now digest to ${current}; it describes a schedule that no longer exists and must be re-derived`,
        {
          scenarioId: scenario.id,
          cachedFingerprint: cached.fingerprint,
          currentFingerprint: current,
        }
      ),
    ];
  }
}

/**
 * **Promote a scenario to primary, with the diff recorded.**
 *
 * In memory, and it returns a record. It maintains no second registry and
 * writes no SQL. Where it wants an immutable record of what was promoted it
 * reuses `publication/snapshot.js`'s snapshot rather than building a second
 * one — which is *"do not build a parallel version"* applied to itself.
 *
 * The new primary is `withRecords()` over the branch's **effective** arrays, so
 * every set the branch did not touch is still the same object the old baseline
 * held: promotion preserves the sharing rather than forking it.
 *
 * @param {Object} input
 * @param {import('./types.js').ScenarioResult} input.result
 * @param {import('./types.js').ScenarioDiff} input.diff - the recorded diff; it travels on the promotion
 * @param {string} input.promotionId
 * @param {string} input.promotedAt - naive `YYYY-MM-DDTHH:MM:SS`, an input
 * @param {string} input.promotedBy
 * @param {string} input.rationale
 * @param {ReadonlyArray<string>} [input.acceptFindingCodes]
 * @returns {import('./types.js').ScenarioPromotion}
 */
export function promoteScenario(input) {
  const { result, diff } = input;
  const meta = createScenarioMeta();
  /** @type {import('./types.js').ScenarioFinding[]} */
  const findings = [];
  const accepted = new Set(input.acceptFindingCodes ?? []);

  const blocking = [...result.findings, ...diff.findings].filter(
    (finding) => finding.severity === CONSTRAINT_SEVERITY.BLOCKING && !accepted.has(finding.code)
  );
  if (blocking.length > 0) {
    findings.push(
      makeScenarioFinding(
        SCENARIO_REASON.SCENARIO_PROMOTION_REFUSED,
        `scenario "${result.scenarioId}" carries ${blocking.length} blocking finding(s) the caller did not accept (${[...new Set(blocking.map((f) => f.code))].sort().join(', ')}); promoting it would make a branch primary over an objection nobody read`,
        {
          scenarioId: result.scenarioId,
          codes: [...new Set(blocking.map((finding) => finding.code))].sort(),
          blocking: blocking.length,
        }
      )
    );
    throw Object.assign(
      new Error(
        `scenario: refusing to promote "${result.scenarioId}" — ${blocking.length} blocking finding(s) were not accepted by code: ${[...new Set(blocking.map((f) => f.code))].sort().join(', ')}`
      ),
      { name: 'ScenarioPromotionRefused', findings }
    );
  }

  // **The recorded diff, frozen.** `makePublicationSnapshot()` takes a column
  // vocabulary and rows of strings, so the diff records as an artifact with the
  // digest, the actor and the supplied timestamp the repository already has —
  // rather than a second immutable-record type built here. What is snapshotted
  // is the *diff*, not the schedule: the schedule is re-derivable from the
  // inputs and the overrides, and the diff is the thing a promotion is a
  // decision about.
  const rows = [
    ...diff.games.changed.map((change) => ({ bucket: 'changed', ...diffRow(change) })),
    ...diff.games.added.map((change) => ({ bucket: 'added', ...diffRow(change) })),
    ...diff.games.removed.map((change) => ({ bucket: 'removed', ...diffRow(change) })),
  ];
  if (rows.length === 0) {
    throw new Error(
      `scenario: refusing to promote "${result.scenarioId}" — its recorded diff moves, adds and removes no game at all, so the promotion would record a decision about nothing`
    );
  }
  const snapshot = makePublicationSnapshot({
    snapshotId: input.promotionId,
    label: `promoted scenario "${result.name}"`,
    channel: 'scenario promotion',
    publishedAt: input.promotedAt,
    publishedBy: input.promotedBy,
    columns: PROMOTION_DIFF_COLUMNS,
    rows,
    notes: input.rationale,
  });

  const primary = withRecords(result.materialised.inputs, result.materialised.records, {
    id: input.promotionId,
    label: `${result.materialised.inputs.label} + scenario "${result.name}"`,
    schedule: result.schedule,
  });
  meta.scenariosPromoted = 1;

  findings.push(
    makeScenarioFinding(
      SCENARIO_REASON.SCENARIO_PROMOTED,
      `scenario "${result.scenarioId}" is now primary as "${primary.id}", promoted by ${input.promotedBy} at ${input.promotedAt}: ${diff.games.changed.length} game(s) moved, ${diff.games.removed.length} carried as TIME TBD, ${diff.constraints.newlyViolated.length} constraint code(s) newly violated. The diff travels on this record`,
      {
        scenarioId: result.scenarioId,
        promotionId: input.promotionId,
        baselineId: result.materialised.inputs.id,
        fingerprint: result.fingerprint,
        gamesChanged: diff.games.changed.length,
        gamesRemoved: diff.games.removed.length,
        gamesAdded: diff.games.added.length,
        newlyViolated: diff.constraints.newlyViolated.join(', '),
        digest: snapshot.snapshot.digest,
        promotedBy: input.promotedBy,
        promotedAt: input.promotedAt,
      }
    )
  );

  return /** @type {import('./types.js').ScenarioPromotion} */ (
    Object.freeze({
      promotionId: input.promotionId,
      scenarioId: result.scenarioId,
      baselineId: result.materialised.inputs.id,
      fingerprint: result.fingerprint,
      promotedAt: input.promotedAt,
      promotedBy: input.promotedBy,
      rationale: input.rationale,
      primary,
      diff,
      snapshot: snapshot.snapshot,
      acceptedFindingCodes: Object.freeze([...accepted].sort()),
      durability: snapshot.snapshot.durability,
      findings,
      status: deriveScenarioStatus(findings),
      meta,
    })
  );
}

/**
 * The diff of a scenario result against its own baseline, with the branch's
 * engines on the right and the baseline's on the left.
 *
 * A convenience over {@link import('./diff.js').diffScenarios} and nothing more:
 * it supplies the two labels, the two verifications and the objective's weights
 * so a caller cannot accidentally compare a measured side against an unmeasured
 * one.
 *
 * @param {import('./types.js').ScenarioResult} result
 * @param {Object} options
 * @param {Object} options.baselineEngines
 * @param {Object} options.baselineVerification
 * @param {ReadonlyArray<Object>} [options.capacitySubjects]
 * @param {Record<string, number>} [options.objectiveWeights]
 * @returns {import('./types.js').ScenarioDiff}
 */
export function diffAgainstBaselineScenario(result, options) {
  return diffScenarios({
    subject: `scenario "${result.name}" against ${result.materialised.inputs.label}`,
    left: {
      label: result.materialised.inputs.label,
      schedule: result.baselineSchedule,
      verification: options.baselineVerification,
      engines: options.baselineEngines,
    },
    right: {
      label: `scenario "${result.name}"`,
      schedule: result.schedule,
      verification: result.verification,
      engines: result.materialised.engines,
    },
    capacitySubjects: options.capacitySubjects ?? [],
    weights: resolveObjectiveWeights(options.objectiveWeights),
  });
}
