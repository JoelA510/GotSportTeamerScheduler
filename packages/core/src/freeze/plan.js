/**
 * Freeze plans: what is held, what is free to move, and the one place that
 * question is answered.
 *
 * ## Maximum freeze is the default, by construction rather than by convention
 *
 * {@link freezeAllExcept} and {@link freezeForChanges} are the two ways a plan
 * is normally built, and both produce `defaultDisposition: 'frozen'`. A change
 * request that supplies no plan at all gets
 * `freezeForChanges(changes)` — a plan that thaws **exactly the games the
 * request names** and nothing else. "Touch only what you must" is therefore not
 * a policy the solver tries to follow; it is the shape of the only plan it was
 * given.
 *
 * The one function that can produce a thawed default lives in `resolve/` and is
 * called `reoptimiseWholeSeason()`. Nothing here can produce one without the
 * acknowledgement {@link import('./schemas.js').GlobalReoptimisationSchema}
 * demands, and any plan carrying one is stamped
 * `FREEZE_GLOBAL_REOPTIMISATION` at **blocking**, so a global re-solve can
 * never come back with a clean report.
 *
 * ## Freeze applies to games. Commitments are inputs.
 *
 * A change request cannot edit a commitment: a coach's evening obligation, an
 * external club's fixture window, a field reservation. Those enter the solver
 * as facts (incident 5 is what happens when one of them arrives *after* the
 * solve) and there is no disposition to give them — they are held by
 * definition, and no plan needs to say so.
 *
 * @module freeze/plan
 */

import {
  FREEZE_DISPOSITION,
  FREEZE_REASON,
  FREEZE_RULE_KIND,
  createFreezeMeta,
  deriveFreezeStatus,
  makeFreezeFinding,
  mergeFreezeMeta,
} from './reasonCodes.js';
import { FreezePlanInputSchema } from './schemas.js';
import {
  freezeDimensions,
  freezeSpecificity,
  freezeTieBreak,
  judgeFreezeMatch,
  normaliseFreezeContext,
} from './scope.js';

/** How many game ids an aggregated finding names before it says "example". */
const EXAMPLE_LIMIT = 5;

/**
 * The key {@link judgeFreezeAll} aggregates a per-game finding under: its code,
 * plus **whichever rules it names**.
 *
 * `ruleId` alone is not enough. `FREEZE_AMBIGUOUS_DISPOSITION` names `ruleIds`
 * (plural, because an ambiguity is by definition about a pair), so keying on
 * the singular collapses two independently contradictory rule pairs into one
 * finding that names only the first and counts both. An operator reading that
 * would narrow one pair, re-run, and be told about the other for the first
 * time — the fix that looked complete and was not.
 *
 * @param {import('./types.js').FreezeFinding} finding
 * @returns {string}
 */
function aggregationKey(finding) {
  const details = finding.details;
  const ruleId = typeof details.ruleId === 'string' ? details.ruleId : '';
  const ruleIds = Array.isArray(details.ruleIds) ? [...details.ruleIds].sort().join(',') : '';
  // The separator is written as the `\u0000` escape rather than a raw byte,
  // for the reason `tests/sourceHygiene.test.js` stands guard over.
  return `${finding.code}\u0000${ruleId}\u0000${ruleIds}`;
}

/**
 * A stable, human-legible id for a rule that did not supply one.
 *
 * @param {string} kind
 * @param {import('./types.js').FreezeMatch} match
 * @param {number} index
 * @returns {string}
 */
function deriveRuleId(kind, match, index) {
  const parts = Object.entries(match)
    .filter(([, value]) => value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return `${kind}#${index}:${parts.join(',')}`;
}

/**
 * Build a freeze plan.
 *
 * @param {Object} [input] - see `FreezePlanInputSchema`
 * @returns {import('./types.js').FreezePlan}
 */
export function buildFreezePlan(input = {}) {
  const parsed = FreezePlanInputSchema.parse(input);
  /** @type {import('./types.js').FreezeFinding[]} */
  const findings = [];

  const rules = parsed.rules.map((rule, index) => ({
    id: rule.id ?? deriveRuleId(rule.kind, rule.match, index),
    kind: rule.kind,
    match: rule.match,
    reason: rule.reason,
  }));

  const seen = new Set();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new Error(
        `freeze: two rules claim the id "${rule.id}"; a plan whose rules cannot be told apart cannot be audited`
      );
    }
    seen.add(rule.id);
  }

  if (parsed.defaultDisposition === FREEZE_DISPOSITION.THAWED) {
    const acknowledgement = /** @type {import('./types.js').GlobalReoptimisation} */ (
      parsed.globalReoptimisation
    );
    findings.push(
      makeFreezeFinding(
        FREEZE_REASON.FREEZE_GLOBAL_REOPTIMISATION,
        `this plan defaults every game to thawed: "${acknowledgement.reason}". Every game in the season may move, and this report can never come back clean (incident 1: 366 of 679 games moved silently under exactly this default).`,
        {
          reason: acknowledgement.reason,
          requestedBy: acknowledgement.requestedBy,
          ruleCount: rules.length,
        }
      )
    );
  }

  // A thaw broader than a freeze in the same plan is a repeal wearing an
  // exception's clothes — the direct analogue of
  // `WAIVER_BROADER_THAN_CONSTRAINT`. When the plan carries no explicit freeze
  // rule the reference is the default, which is global (rank 0), and no thaw
  // can be broader than that; the check is silent then, correctly.
  const freezeRules = rules.filter((rule) => rule.kind === FREEZE_RULE_KIND.FREEZE);
  for (const thaw of rules.filter((rule) => rule.kind === FREEZE_RULE_KIND.THAW)) {
    const thawRank = freezeSpecificity(thaw.match);
    const thawTieBreak = freezeTieBreak(thaw.match);
    for (const frozen of freezeRules) {
      const freezeRank = freezeSpecificity(frozen.match);
      const freezeTieBreakRank = freezeTieBreak(frozen.match);
      if (thawRank === freezeRank && thawTieBreak === freezeTieBreakRank) {
        // The **residual** tie: equal on the shared scale and equal on the
        // freeze-local one too, so the two rules are genuinely the same width
        // and neither reading of the plan is more correct. Said once, here,
        // rather than as a blocking surprise on every game the two both reach.
        // See `FREEZE_THAW_TIES_FREEZE`.
        findings.push(
          makeFreezeFinding(
            FREEZE_REASON.FREEZE_THAW_TIES_FREEZE,
            `thaw "${thaw.id}" and freeze "${frozen.id}" both narrow to specificity ${thawRank} (${freezeDimensions(thaw.match).join(', ')} against ${freezeDimensions(frozen.match).join(', ')}) and neither names a narrower dimension than the other; any game both reach is held and reported ambiguous, because nothing orders them`,
            {
              thawRuleId: thaw.id,
              freezeRuleId: frozen.id,
              specificity: thawRank,
              tieBreak: thawTieBreak,
            }
          )
        );
        continue;
      }
      if (thawRank > freezeRank) continue;
      if (thawRank === freezeRank && thawTieBreak > freezeTieBreakRank) continue;
      findings.push(
        makeFreezeFinding(
          FREEZE_REASON.FREEZE_THAW_BROADER_THAN_FREEZE,
          `thaw "${thaw.id}" narrows on ${freezeDimensions(thaw.match).join(', ')} while the freeze "${frozen.id}" it carves out of narrows on ${freezeDimensions(frozen.match).join(', ')}; an exception broader than the rule it excepts is a repeal`,
          {
            thawRuleId: thaw.id,
            freezeRuleId: frozen.id,
            thawSpecificity: thawRank,
            freezeSpecificity: freezeRank,
          }
        )
      );
    }
  }

  return Object.freeze({
    name: parsed.name,
    defaultDisposition: parsed.defaultDisposition,
    rules: /** @type {import('./types.js').FreezeRule[]} */ (Object.freeze(rules)),
    globalReoptimisation: parsed.globalReoptimisation,
    findings: /** @type {import('./types.js').FreezeFinding[]} */ (Object.freeze(findings)),
    status: deriveFreezeStatus(findings),
  });
}

/**
 * The normal way to build a plan: freeze everything, then carve out the named
 * scopes.
 *
 * `freezeAllExcept([{ date: '2026-08-22', format: '9v9' }])` is the build
 * plan's own worked example, and it reads the way an operator says it.
 *
 * @param {ReadonlyArray<Object>} matches - raw freeze matches to thaw
 * @param {{ name?: string, reason?: string|null }} [options]
 * @returns {import('./types.js').FreezePlan}
 */
export function freezeAllExcept(matches, options = {}) {
  if (!Array.isArray(matches)) {
    throw new TypeError('freeze: freezeAllExcept() takes an array of matches');
  }
  return buildFreezePlan({
    name: options.name ?? 'freeze all except',
    defaultDisposition: FREEZE_DISPOSITION.FROZEN,
    rules: matches.map((match) => ({
      kind: FREEZE_RULE_KIND.THAW,
      match,
      reason: options.reason ?? null,
    })),
  });
}

/**
 * The scopes a change request touches: one `gameId` match per change, and
 * nothing wider.
 *
 * This is where "a change request touches only what it must" is decided. It is
 * deliberately the narrowest possible reading — not the dates the changes fall
 * on, not the venues they use — because every widening here is a set of games
 * an operator did not ask about and would not expect to move.
 *
 * @param {ReadonlyArray<{ gameId: string }>} changes
 * @returns {Array<{ gameId: string }>}
 */
export function scopesTouchedBy(changes) {
  if (!Array.isArray(changes)) {
    throw new TypeError('freeze: scopesTouchedBy() takes an array of changes');
  }
  const ids = [...new Set(changes.map((change) => change.gameId))].sort();
  return ids.map((gameId) => ({ gameId }));
}

/**
 * The plan a change request gets when the caller supplies none.
 *
 * @param {ReadonlyArray<{ gameId: string }>} changes
 * @returns {import('./types.js').FreezePlan}
 */
export function freezeForChanges(changes) {
  const scopes = scopesTouchedBy(changes);
  if (scopes.length === 0) {
    throw new Error(
      'freeze: a change request that names no game has nothing to thaw, and a plan that freezes everything would make the run vacuous (incident 4)'
    );
  }
  return freezeAllExcept(scopes, {
    name: 'maximum freeze (derived from the change request)',
    reason: 'named by the change request',
  });
}

/**
 * Judge one game against a plan.
 *
 * The resolution rule, in full:
 *
 * 1. Every rule is tested. A rule that names a dimension the game does not
 *    carry is **unjudged**: a `freeze` in that state still holds the game, a
 *    `thaw` in that state does not free it, and either way
 *    `FREEZE_SCOPE_UNJUDGED` is reported.
 * 2. Of the rules that matched, the **narrowest** wins — narrowness read on two
 *    levels, in order: the shared specificity rank
 *    ({@link import('./scope.js').freezeSpecificity}), then the freeze-local
 *    dimension ordering inside that rank
 *    ({@link import('./scope.js').freezeTieBreak}), which is what lets "freeze
 *    Pitch 1 except this one game" mean what it says.
 * 3. A `freeze` and a `thaw` that tie on **both** levels resolve **frozen** and
 *    emit `FREEZE_AMBIGUOUS_DISPOSITION` at `blocking`. The plan is genuinely
 *    contradictory — the two rules are the same width and name the same kind of
 *    thing; the run says so and holds the game.
 * 4. If nothing matched, the plan's default decides.
 *
 * @param {import('./types.js').FreezePlan} plan
 * @param {import('./types.js').FreezeContext} rawContext
 * @returns {import('./types.js').FreezeJudgement}
 */
export function judgeFreeze(plan, rawContext) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.rules)) {
    throw new TypeError(
      'freeze: judgeFreeze() needs a plan built by buildFreezePlan(); `null` is not "no freeze", it is a missing argument'
    );
  }
  const context = normaliseFreezeContext(rawContext);
  const meta = createFreezeMeta();
  /** @type {import('./types.js').FreezeFinding[]} */
  const findings = [];
  /** @type {string[]} */
  const matchedRuleIds = [];

  let judged = true;
  /** @type {{ ruleId: string, kind: string, reason: string|null, specificity: number, tieBreak: number, labelMatched: boolean }|null} */
  let winner = null;
  /** @type {string[]} */
  const tiedOpposites = [];

  for (const rule of plan.rules) {
    meta.rulesTested += 1;
    const verdict = judgeFreezeMatch(rule.match, context);
    meta.dimensionsTested += verdict.dimensionsTested;

    let applies = verdict.matches;
    if (!verdict.judged) {
      judged = false;
      meta.unjudgedDimensions += 1;
      findings.push(
        makeFreezeFinding(
          FREEZE_REASON.FREEZE_SCOPE_UNJUDGED,
          `${rule.kind} "${rule.id}" narrows on ${freezeDimensions(rule.match).join(', ')} and game "${rawContext.gameId}" carries no ${verdict.unjudgedDimension}; an unjudged freeze holds the game and an unjudged thaw does not free it`,
          {
            ruleId: rule.id,
            ruleKind: rule.kind,
            gameId: rawContext.gameId,
            dimension: verdict.unjudgedDimension,
          }
        )
      );
      // The inversion, in one line: an unjudged freeze applies; an unjudged
      // thaw does not. Both refuse to act on a question they could not answer.
      applies = rule.kind === FREEZE_RULE_KIND.FREEZE;
    }
    if (!applies) continue;

    matchedRuleIds.push(rule.id);
    const specificity = freezeSpecificity(rule.match);
    const tieBreak = freezeTieBreak(rule.match);
    // Narrowness on two levels, in order: the shared specificity scale first,
    // then the freeze-local dimension ordering inside one rank. The second is
    // what makes "freeze Pitch 1 except this one game" a narrowing rather than
    // a contradiction — `surface`, `team` and `game` all sit at rank 3 on the
    // shared scale, and that scale is not this module's to change.
    if (
      winner === null ||
      specificity > winner.specificity ||
      (specificity === winner.specificity && tieBreak > winner.tieBreak)
    ) {
      winner = {
        ruleId: rule.id,
        kind: rule.kind,
        reason: rule.reason,
        specificity,
        tieBreak,
        labelMatched: verdict.labelMatched,
      };
      tiedOpposites.length = 0;
      continue;
    }
    if (
      specificity === winner.specificity &&
      tieBreak === winner.tieBreak &&
      rule.kind !== winner.kind
    ) {
      tiedOpposites.push(rule.id);
    }
  }

  let disposition;
  let decidedByRuleId = null;
  let decidedByReason = null;
  let specificity = 0;

  if (winner === null) {
    disposition = plan.defaultDisposition;
    findings.push(
      makeFreezeFinding(
        FREEZE_REASON.FREEZE_DEFAULT_APPLIED,
        `no rule of "${plan.name}" reaches game "${rawContext.gameId}", so the plan's default (${plan.defaultDisposition}) decides`,
        {
          gameId: rawContext.gameId,
          defaultDisposition: plan.defaultDisposition,
          ruleCount: plan.rules.length,
        }
      )
    );
  } else {
    decidedByRuleId = winner.ruleId;
    // The operator's own words for why, carried to whoever is told the game
    // could not move. A reason recorded and never surfaced is a reason lost.
    decidedByReason = winner.reason;
    specificity = winner.specificity;
    disposition =
      winner.kind === FREEZE_RULE_KIND.THAW ? FREEZE_DISPOSITION.THAWED : FREEZE_DISPOSITION.FROZEN;

    if (tiedOpposites.length > 0) {
      meta.ambiguitiesReported += 1;
      // Frozen wins the tie. Not because freeze is more important than thaw in
      // general, but because a contradictory plan is an operator error and the
      // recoverable half of the error is "it did not move".
      disposition = FREEZE_DISPOSITION.FROZEN;
      findings.push(
        makeFreezeFinding(
          FREEZE_REASON.FREEZE_AMBIGUOUS_DISPOSITION,
          `game "${rawContext.gameId}" is matched by both a freeze and a thaw at specificity ${winner.specificity}, neither naming a narrower dimension than the other (${[winner.ruleId, ...tiedOpposites].join(', ')}); it is held, and the plan needs narrowing before this run can come back clean`,
          {
            gameId: rawContext.gameId,
            specificity: winner.specificity,
            tieBreak: winner.tieBreak,
            ruleIds: [winner.ruleId, ...tiedOpposites].sort(),
          }
        )
      );
    } else if (matchedRuleIds.length > 1) {
      findings.push(
        makeFreezeFinding(
          FREEZE_REASON.FREEZE_NARROWER_APPLIED,
          `${matchedRuleIds.length} rules reach game "${rawContext.gameId}"; the narrowest ("${winner.ruleId}", specificity ${winner.specificity}) decides it is ${disposition}`,
          {
            gameId: rawContext.gameId,
            ruleId: winner.ruleId,
            specificity: winner.specificity,
            matchedRuleIds: [...matchedRuleIds].sort(),
          }
        )
      );
    }

    if (winner.labelMatched) {
      findings.push(
        makeFreezeFinding(
          FREEZE_REASON.FREEZE_DIVISION_LABEL_MATCH,
          `rule "${winner.ruleId}" reached game "${rawContext.gameId}" by matching a division label; division labels are not a key (GAP-24)`,
          { gameId: rawContext.gameId, ruleId: winner.ruleId, divisionLabel: context.divisionLabel }
        )
      );
    }
  }

  meta.gamesJudged = 1;
  if (disposition === FREEZE_DISPOSITION.FROZEN) meta.frozenGames = 1;
  else meta.thawedGames = 1;

  return {
    gameId: rawContext.gameId,
    disposition,
    frozen: disposition === FREEZE_DISPOSITION.FROZEN,
    decidedByRuleId,
    decidedByReason,
    specificity,
    judged,
    matchedRuleIds,
    findings,
    meta,
  };
}

/**
 * Judge a whole set of games at once.
 *
 * The set-level `findings` list **aggregates** by code and rule rather than
 * repeating one provenance note per game: 679 copies of "the default decided"
 * is not information. Each aggregate carries `gameCount` and up to five
 * `exampleGameIds`, named so that nobody mistakes the short list for the whole
 * of it. Per-game findings are still on each judgement, untouched.
 *
 * @param {import('./types.js').FreezePlan} plan
 * @param {ReadonlyArray<import('./types.js').FreezeContext>} contexts
 * @returns {import('./types.js').FreezeJudgementSet}
 */
export function judgeFreezeAll(plan, contexts) {
  if (!Array.isArray(contexts)) {
    throw new TypeError('freeze: judgeFreezeAll() takes an array of game contexts');
  }
  const meta = createFreezeMeta();
  /** @type {Record<string, import('./types.js').FreezeJudgement>} */
  const byGameId = {};
  /** @type {string[]} */
  const frozenGameIds = [];
  /** @type {string[]} */
  const thawedGameIds = [];
  /** @type {Map<string, { finding: import('./types.js').FreezeFinding, gameIds: string[] }>} */
  const aggregated = new Map();
  /** @type {Map<string, number>} */
  const matchesByRuleId = new Map(plan.rules.map((rule) => [rule.id, 0]));

  for (const context of contexts) {
    const judgement = judgeFreeze(plan, context);
    if (byGameId[judgement.gameId]) {
      throw new Error(
        `freeze: game "${judgement.gameId}" was judged twice; a judgement set keyed by a duplicate id would silently lose one of them`
      );
    }
    byGameId[judgement.gameId] = judgement;
    if (judgement.frozen) frozenGameIds.push(judgement.gameId);
    else thawedGameIds.push(judgement.gameId);

    mergeFreezeMeta(meta, judgement.meta);

    for (const ruleId of judgement.matchedRuleIds) {
      matchesByRuleId.set(ruleId, (matchesByRuleId.get(ruleId) ?? 0) + 1);
    }

    for (const finding of judgement.findings) {
      const key = aggregationKey(finding);
      const entry = aggregated.get(key);
      if (entry) {
        entry.gameIds.push(judgement.gameId);
        continue;
      }
      aggregated.set(key, { finding, gameIds: [judgement.gameId] });
    }
  }

  /** @type {import('./types.js').FreezeFinding[]} */
  const findings = [...plan.findings];
  for (const { finding, gameIds } of aggregated.values()) {
    // The aggregate speaks for many games, so it must not keep the one game's
    // key it was seeded from: a consumer filtering set-level findings by
    // `details.gameId` would silently get one row out of six hundred. The whole
    // set travels as `gameCount`, and the sample is named `exampleGameIds` so
    // nobody mistakes the short list for the complete one.
    const details = { ...finding.details };
    delete details.gameId;
    findings.push({
      ...finding,
      message:
        gameIds.length === 1
          ? finding.message
          : `${finding.message} — and ${gameIds.length - 1} other game(s); see gameCount and exampleGameIds`,
      details: {
        ...details,
        gameCount: gameIds.length,
        exampleGameIds: gameIds.slice(0, EXAMPLE_LIMIT).sort(),
      },
    });
  }

  for (const [ruleId, count] of matchesByRuleId) {
    if (count > 0) {
      meta.rulesThatMatchedSomething += 1;
      continue;
    }
    meta.rulesThatMatchedNothing += 1;
    const rule = /** @type {import('./types.js').FreezeRule} */ (
      plan.rules.find((candidate) => candidate.id === ruleId)
    );
    findings.push(
      makeFreezeFinding(
        FREEZE_REASON.FREEZE_RULE_MATCHED_NOTHING,
        `${rule.kind} "${ruleId}" reached none of the ${contexts.length} games judged; whatever the operator meant to ${rule.kind}, this rule did not do it`,
        { ruleId, ruleKind: rule.kind, gamesJudged: contexts.length }
      )
    );
  }

  frozenGameIds.sort();
  thawedGameIds.sort();

  return {
    byGameId,
    frozenGameIds,
    thawedGameIds,
    findings,
    status: deriveFreezeStatus(findings),
    meta,
  };
}
